/**
 * Artifact path helpers for dual-path compatibility.
 * Centralizes logic for resolving, reading, and checking artifact paths.
 */
import { fileExists, readFile } from "@opencode-flow-engine/shared";

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
