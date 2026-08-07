/**
 * Unified changeDir resolution utility
 * 
 * Provides a single source of truth for resolving the project/change directory
 * across all tools and features. Eliminates path splitting issues where
 * different tools use different resolution strategies.
 * 
 * Priority: explicitChangeDir > contextDirectory > cwd
 * 
 * @param explicitChangeDir - Explicitly provided changeDir (highest priority)
 * @param contextDirectory - Directory from tool context (second priority)
 * @returns Resolved absolute or relative path to the project directory
 * @throws Error if no path can be resolved
 */

export function resolveChangeDir(
  explicitChangeDir?: string,
  contextDirectory?: string,
): string {
  // Priority 1: Explicit parameter (non-empty string)
  if (explicitChangeDir && explicitChangeDir.trim().length > 0) {
    return explicitChangeDir;
  }

  // Priority 2: Context directory (non-empty string)
  if (contextDirectory && contextDirectory.trim().length > 0) {
    return contextDirectory;
  }

  // Priority 3: Fallback to cwd
  let cwdError: Error | null = null;
  try {
    const cwd = process.cwd();
    if (cwd && cwd.trim().length > 0) {
      return cwd;
    }
  } catch (err) {
    cwdError = err instanceof Error ? err : new Error(String(err));
  }

  const errorReason = cwdError ? ` (cwd error: ${cwdError.message})` : '';
  
  let callerInfo = '';
  try {
    const stack = new Error().stack;
    if (stack) {
      const lines = stack.split('\n');
      const callerLine = lines.find((line, index) => {
        if (index === 0) return false;
        return !line.includes('resolveChangeDir') && line.trim().length > 0;
      });
      if (callerLine) {
        const match = callerLine.match(/at\s+(.+?)\s+\(/);
        if (match) {
          callerInfo = ` (called by ${match[1]})`;
        }
      }
    }
  } catch {
    // Stack trace extraction failed, continue without caller info
  }
  
  throw new Error(
    `Unable to resolve changeDir: no explicit path, no context directory, and cwd unavailable${errorReason}${callerInfo}`,
  );
}
