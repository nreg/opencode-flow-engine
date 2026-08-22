/**
 * Artifact path helpers for dual-path compatibility.
 * Centralizes logic for resolving, reading, and checking artifact paths.
 */
import { fileExists, readFile, listFiles, directoryExists } from "@opencode-flow-engine/shared";

/**
 * Canonical set of artifact file names.
 * Shared across the codebase to ensure consistency.
 */
export const ARTIFACT_NAMES = new Set([
  'proposal.md',
  'design.md',
  'tasks.md',
  'execution-contract.md',
  'ui-design.md',
]);

/**
 * Resolve artifact path with dual-path compatibility.
 * Priority: .flow-engine/sflow/<artifact> (new) → <changeDir>/<artifact> (legacy)
 */
export async function resolveArtifactPath(changeDir: string, artifactName: string): Promise<string> {
  const newPath = `${changeDir}/.flow-engine/sflow/${artifactName}`;
  const legacyPath = `${changeDir}/${artifactName}`;
  
  if (await fileExists(newPath)) {
    return newPath;
  }
  
  return legacyPath;
}

/**
 * Read artifact content with dual-path compatibility.
 * Tries new path first, falls back to legacy path.
 */
export async function readArtifactContent(changeDir: string, artifactName: string): Promise<string | null> {
  const newPath = `${changeDir}/.flow-engine/sflow/${artifactName}`;
  const legacyPath = `${changeDir}/${artifactName}`;
  
  const newContent = await readFile(newPath).catch(() => null);
  if (newContent) return newContent;
  
  return readFile(legacyPath).catch(() => null);
}

/**
 * Check if artifact exists in new path (.flow-engine/sflow/).
 */
export async function isArtifactNewPath(changeDir: string, artifactName: string): Promise<boolean> {
  const newPath = `${changeDir}/.flow-engine/sflow/${artifactName}`;
  return fileExists(newPath);
}

/**
 * Check if artifact exists in either new or legacy path.
 */
export async function artifactExists(changeDir: string, artifactName: string): Promise<boolean> {
  const newPath = `${changeDir}/.flow-engine/sflow/${artifactName}`;
  const legacyPath = `${changeDir}/${artifactName}`;
  
  return (await fileExists(newPath)) || (await fileExists(legacyPath));
}

/**
 * Resolve specs directory path.
 * Only returns new path: .flow-engine/sflow/specs (change-specific delta specs).
 * Does NOT fallback to project root specs/ (which is the main spec library).
 */
export async function resolveSpecsDir(changeDir: string): Promise<string> {
  const newPath = `${changeDir}/.flow-engine/sflow/specs`;
  return newPath;
}

/**
 * List spec files from change directory.
 * Only detects delta specs in .flow-engine/sflow/specs/ (change-specific).
 * Does NOT fallback to project root specs/ (which is the main spec library).
 * Returns empty array if directory does not exist or read fails.
 */
export async function listSpecFiles(changeDir: string): Promise<string[]> {
  const newPath = `${changeDir}/.flow-engine/sflow/specs`;
  
  return listFiles(newPath, '.md').catch(() => []);
}

/**
 * Read spec content.
 * Only reads from new path: .flow-engine/sflow/specs/<specName> (change-specific delta specs).
 * Does NOT fallback to project root specs/ (which is the main spec library).
 * Returns null if file does not exist.
 */
export async function readSpecContent(changeDir: string, specName: string): Promise<string | null> {
  const newPath = `${changeDir}/.flow-engine/sflow/specs/${specName}`;
  return readFile(newPath).catch(() => null);
}

/**
 * Check if directory artifact exists with dual-path compatibility.
 * For specs/ directory, checks if it exists and contains .md files.
 * Priority: .flow-engine/sflow/specs (new) → specs (legacy)
 */
export async function directoryArtifactExists(changeDir: string, artifactName: string): Promise<boolean> {
  // Normalize artifact name (remove trailing slash)
  const normalizedArtifact = artifactName.replace(/\/$/, '');
  
  if (normalizedArtifact === 'specs') {
    const files = await listSpecFiles(changeDir);
    return files.length > 0;
  }
  
  // For other directory artifacts, check both paths
  const newPath = `${changeDir}/.flow-engine/sflow/${normalizedArtifact}`;
  const legacyPath = `${changeDir}/${normalizedArtifact}`;
  
  const newExists = await directoryExists(newPath);
  if (newExists) return true;
  
  return directoryExists(legacyPath);
}
