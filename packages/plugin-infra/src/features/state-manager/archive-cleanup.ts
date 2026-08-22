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
 */
async function readStateJson(sflowDir: string): Promise<{ changeName: string; mode: string } | null> {
  const statePath = join(sflowDir, 'state.json');
  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content);
    return {
      changeName: state.changeName || '',
      mode: state.mode || 'full'
    };
  } catch {
    return null;
  }
}

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
  const sflowDir = join(changeDir, '.flow-engine', 'sflow');
  const archiveBaseDir = join(sflowDir, 'archive');
  
  const archivedFiles: string[] = [];
  const preservedAssets: string[] = [];
  
  try {
    // Step 1: Determine change name
    let changeName = changeNameOverride || '';
    let originalMode = 'full';
    
    if (!changeName) {
      const state = await readStateJson(sflowDir);
      if (state) {
        changeName = state.changeName || generateChangeName();
        originalMode = state.mode;
      } else {
        changeName = generateChangeName();
      }
    }
    
    let archiveDir = join(archiveBaseDir, changeName);

    // Step 2: Create archive directory (handle existing directory)
    let suffix = 0;
    while (await exists(archiveDir)) {
      suffix++;
      archiveDir = join(archiveBaseDir, `${changeName}-${suffix}`);
    }
    await mkdir(archiveDir, { recursive: true });
    
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
          } else {
            // It's a file
            const content = await readFile(srcPath);
            await writeFile(dstPath, content);
          }
          copiedFiles.push(artifact);
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
        copiedFiles.push('specs/');
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
    }
    
    // Reset state.json (preserve original mode)
    const initialState = {
      state: 'exploring',
      changeName: '',
      mode: originalMode, // P1-4: Preserve original mode
      batches_completed: 0,
      afk: false,
      afkTier: 0,
      last_transition: new Date().toISOString()
    };
    
    await writeFile(statePath, JSON.stringify(initialState, null, 2), 'utf-8');
    archivedFiles.push('state.json (reset)');
    
    // Verify preserved assets
    for (const asset of PRESERVED_ASSETS) {
      const assetPath = join(sflowDir, asset);
      if (await exists(assetPath)) {
        preservedAssets.push(asset);
      }
    }
    
    return {
      archivedFiles,
      preservedAssets,
      archiveDir,
      changeName,
      success: true
    };
    
  } catch (err) {
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
