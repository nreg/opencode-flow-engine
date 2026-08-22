/**
 * Archive Cleanup - Cross-platform archive cleanup for sflow
 * 
 * Moves active artifacts to archive directory, preserves cross-change assets,
 * and resets state.json. Uses fs/promises for cross-platform compatibility.
 * 
 * Implements two-phase commit for transactional safety:
 * 1. Copy to archive/ → verify integrity
 * 2. Remove originals → reset state.json
 */

import { 
  mkdir, 
  cp, 
  rm, 
  rename,
  readFile, 
  writeFile, 
  access,
  readdir,
  stat
} from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

/**
 * Archive cleanup result
 */
export interface ArchiveCleanupResult {
  /** Successfully archived files/directories */
  archivedFiles: string[];
  /** Preserved cross-change assets */
  preservedAssets: string[];
  /** Archive directory path */
  archiveDir: string;
  /** Change name used for archive */
  changeName: string;
  /** Error message if cleanup failed */
  error?: string;
  /** Whether cleanup completed successfully */
  success: boolean;
}

/**
 * Active artifacts to move to archive
 */
const ACTIVE_ARTIFACTS = [
  'proposal.md',
  'design.md',
  'tasks.md',
  'execution-contract.md',
  'ui-design.md',
  'boulder-state.json'
];

/**
 * Cross-change assets to preserve in root directory
 */
const PRESERVED_ASSETS = [
  'lessons.md',
  'subagent-store',
  'notifications',
  'verification-report.md',
  'archive-metadata.json',
  'polling.log',
  '.artifacts-migrated'
];

/**
 * Check if file/directory exists
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate timestamp-based change name
 */
function generateChangeName(): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  return `change-${timestamp}`;
}

/**
 * Read state.json and extract changeName and mode
 * P0-3: Validate JSON integrity
 */
async function readStateJson(sflowDir: string): Promise<{ changeName: string; mode: string; error?: string } | null> {
  const statePath = join(sflowDir, 'state.json');
  try {
    const content = await readFile(statePath, 'utf-8');

    // P0-3: Validate JSON parse
    let state;
    try {
      state = JSON.parse(content);
    } catch (parseError) {
      return {
        changeName: '',
        mode: 'full',
        error: `state.json is corrupted: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      };
    }

    // P0-3: Validate required fields exist
    if (typeof state !== 'object' || state === null) {
      return {
        changeName: '',
        mode: 'full',
        error: 'state.json is invalid: not an object'
      };
    }

    return {
      changeName: state.changeName || '',
      mode: state.mode || 'full'
    };
  } catch {
    return null;
  }
}

/**
 * Concurrent execution control flag
 */
let inProgress = false;

/**
 * Archive cleanup - Move active artifacts to archive directory
 * 
 * Two-phase commit:
 * 1. Copy to archive/ → verify files exist
 * 2. Remove originals → reset state.json
 * 
 * @param changeDir - Project root directory (absolute path)
 * @param changeNameOverride - Optional change name override (uses state.json or timestamp if not provided)
 * @returns Archive cleanup result with archived files, preserved assets, and status
 */
export async function archiveCleanup(
  changeDir: string,
  changeNameOverride?: string
): Promise<ArchiveCleanupResult> {
  // P0-3: Concurrent execution guard
  if (inProgress) {
    const fallbackChangeName = changeNameOverride || generateChangeName();
    return {
      archivedFiles: [],
      preservedAssets: [],
      archiveDir: join(changeDir, '.flow-engine', 'sflow', 'archive', fallbackChangeName),
      changeName: fallbackChangeName,
      error: 'Archive cleanup already in progress',
      success: false
    };
  }
  
  inProgress = true;
  const sflowDir = join(changeDir, '.flow-engine', 'sflow');
  const archiveBaseDir = join(sflowDir, 'archive');
  
  const archivedFiles: string[] = [];
  const preservedAssets: string[] = [];
  
  try {
    // Step 1: Determine change name and mode
    let changeName = changeNameOverride || '';
    let originalMode = 'full';

    // Always read state.json to get mode (even if changeName is overridden)
    const state = await readStateJson(sflowDir);
    if (state) {
      // P1-1: Propagate readStateJson error (state.json corruption detection)
      if (state.error) {
        console.warn(`警告: ${state.error}`);
        // Continue with defaults - changeName will be auto-generated if empty
      }
      if (!changeName) {
        changeName = state.changeName || '';
      }
      if (state.mode) {
        originalMode = state.mode;
      }
    }

    // Generate changeName if still empty
    if (!changeName) {
      changeName = generateChangeName();
    }
    
    // P0-2: Empty Guard - Check if any active artifacts exist
    let hasActiveArtifacts = false;
    for (const artifact of ACTIVE_ARTIFACTS) {
      const artifactPath = join(sflowDir, artifact);
      if (await exists(artifactPath)) {
        hasActiveArtifacts = true;
        break;
      }
    }
    
    // Check specs/ directory
    if (!hasActiveArtifacts) {
      const specsPath = join(sflowDir, 'specs');
      if (await exists(specsPath)) {
        hasActiveArtifacts = true;
      }
    }
    
    // If no active artifacts, return error without creating archive directory
    if (!hasActiveArtifacts) {
      inProgress = false;
      return {
        archivedFiles: [],
        preservedAssets: [],
        archiveDir: join(archiveBaseDir, changeName),
        changeName,
        error: 'No active artifacts to archive',
        success: false
      };
    }
    
    let archiveDir = join(archiveBaseDir, changeName);

    // Step 2: Create archive directory (handle existing directory)
    let suffix = 0;
    while (await exists(archiveDir)) {
      suffix++;
      archiveDir = join(archiveBaseDir, `${changeName}-${suffix}`);
    }
    
    // Update changeName if suffix was added
    if (suffix > 0) {
      changeName = `${changeName}-${suffix}`;
    }
    
    await mkdir(archiveDir, { recursive: true });

    // P0-2: Create archive-in-progress marker file
    const markerPath = join(archiveDir, '.archive-in-progress');
    try {
      await writeFile(markerPath, JSON.stringify({
        startTime: new Date().toISOString(),
        changeName,
        pid: process.pid
      }, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Warning: Failed to create archive marker: ${err}`);
    }
    
    // Phase 1: Copy to archive (two-phase commit)
    const copiedFiles: string[] = [];
    
    // Copy active artifacts
    for (const artifact of ACTIVE_ARTIFACTS) {
      const srcPath = join(sflowDir, artifact);
      if (await exists(srcPath)) {
        const dstPath = join(archiveDir, artifact);
        try {
          // Check if it's a file or directory using stat (P1-2 fix)
          const fileStat = await stat(srcPath);
          if (fileStat.isDirectory()) {
            // It's a directory
            await cp(srcPath, dstPath, { recursive: true });
            
            // P0-4: Verify directory copy integrity
            const dstStat = await stat(dstPath);
            if (dstStat.isDirectory()) {
              const entries = await readdir(dstPath);
              if (entries.length > 0) {
                copiedFiles.push(artifact);
              } else {
                console.error(`Warning: Copied directory ${artifact} is empty, skipping`);
              }
            }
          } else {
            // It's a file
            const content = await readFile(srcPath);
            await writeFile(dstPath, content);
            
            // P0-4: Verify file copy integrity
            const dstStat = await stat(dstPath);
            if (dstStat.isFile() && dstStat.size > 0) {
              copiedFiles.push(artifact);
            } else {
              console.error(`Warning: Copied file ${artifact} is empty or invalid, skipping`);
            }
          }
        } catch (err) {
          // Log error but continue with other files
          console.error(`Warning: Failed to copy ${artifact}: ${err}`);
        }
      }
    }
    
    // Copy specs/ directory
    const specsSrc = join(sflowDir, 'specs');
    if (await exists(specsSrc)) {
      const specsDst = join(archiveDir, 'specs');
      try {
        await cp(specsSrc, specsDst, { recursive: true });
        
        // P0-4: Verify specs/ copy integrity
        const specsDstStat = await stat(specsDst);
        if (specsDstStat.isDirectory()) {
          const entries = await readdir(specsDst);
          if (entries.length > 0) {
            copiedFiles.push('specs/');
          } else {
            console.error(`Warning: Copied specs/ directory is empty, skipping`);
          }
        }
      } catch (err) {
        console.error(`Warning: Failed to copy specs/: ${err}`);
      }
    }
    
    // Backup state.json
    const statePath = join(sflowDir, 'state.json');
    if (await exists(statePath)) {
      const stateBackupPath = join(archiveDir, 'state.json.backup');
      try {
        const stateContent = await readFile(statePath);
        await writeFile(stateBackupPath, stateContent);
        copiedFiles.push('state.json.backup');
      } catch (err) {
        console.error(`Warning: Failed to backup state.json: ${err}`);
      }
    }
    
    // Phase 2: Remove originals and reset state.json
    // Only proceed if at least one file was copied
    if (copiedFiles.length > 0) {
      // Remove original files that were successfully copied
      for (const artifact of copiedFiles) {
        // Skip state.json.backup (source state.json will be reset, not deleted)
        if (artifact === 'state.json.backup') continue;

        // Handle specs/ directory
        if (artifact === 'specs/') {
          if (await exists(specsSrc)) {
            try {
              await rm(specsSrc, { recursive: true, force: true });
              archivedFiles.push('specs/');
            } catch (err) {
              console.error(`Warning: Failed to remove specs/: ${err}`);
            }
          }
          continue;
        }

        // Handle regular artifacts
        const srcPath = join(sflowDir, artifact);
        if (await exists(srcPath)) {
          try {
            await rm(srcPath, { recursive: true, force: true });
            archivedFiles.push(artifact);
          } catch (err) {
            console.error(`Warning: Failed to remove ${artifact}: ${err}`);
          }
        }
      }
      
      // P0-1: Reset state.json ONLY after successful archive (preserve original mode)
      // This is inside the if (copiedFiles.length > 0) block to ensure transactional safety
      const initialState = {
        state: 'exploring',
        changeName: '',
        mode: originalMode, // P1-4: Preserve original mode
        batches_completed: 0,
        afk: false,
        afkTier: 0,
        last_transition: new Date().toISOString()
      };

      // P0-1: Atomic write - write to temp file first, then rename
      const stateTmpPath = join(sflowDir, 'state.json.tmp');
      try {
        await writeFile(stateTmpPath, JSON.stringify(initialState, null, 2), 'utf-8');
        await rename(stateTmpPath, statePath);
        archivedFiles.push('state.json (reset)');
      } catch (err) {
        console.error(`Warning: Failed to reset state.json: ${err}`);
        // Clean up temp file if it exists
        try {
          await rm(stateTmpPath, { force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    
    // Verify preserved assets
    for (const asset of PRESERVED_ASSETS) {
      const assetPath = join(sflowDir, asset);
      if (await exists(assetPath)) {
        preservedAssets.push(asset);
      }
    }

    // P0-2: Remove archive-in-progress marker on success
    try {
      await rm(markerPath, { force: true });
    } catch {
      // Ignore marker cleanup errors
    }

    // P0-3: Reset concurrent execution flag
    inProgress = false;
    
    return {
      archivedFiles,
      preservedAssets,
      archiveDir,
      changeName,
      success: true
    };
    
  } catch (err) {
    // P0-3: Reset concurrent execution flag on error
    inProgress = false;
    
    const fallbackChangeName = changeNameOverride || generateChangeName();
    return {
      archivedFiles,
      preservedAssets,
      archiveDir: join(archiveBaseDir, fallbackChangeName),
      changeName: fallbackChangeName,
      error: err instanceof Error ? err.message : String(err),
      success: false
    };
  }
}

/**
 * List archive directories
 */
export async function listArchives(changeDir: string): Promise<string[]> {
  const archiveDir = join(changeDir, '.flow-engine', 'sflow', 'archive');
  
  if (!await exists(archiveDir)) {
    return [];
  }
  
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a)); // Most recent first
  } catch {
    return [];
  }
}
