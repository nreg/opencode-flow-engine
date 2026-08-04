/**
 * GitRangeValidator — Process-level cache for Git range validation operations.
 *
 * Caches git rev-parse --verify and git merge-base --is-ancestor results
 * to reduce redundant Git subprocess invocations while preserving correctness
 * for mutable revisions.
 *
 * Cache Strategy:
 * - Only cache results for full 40-character SHA-1 hex strings
 * - Mutable revisions (branch names, tags, partial SHAs) bypass cache
 * - Failed lookups are cached as null to avoid repeated Git calls
 * - Cache is bounded by process lifetime (no eviction policy needed for process-level cache)
 *
 * @see specs/git-validation-cache.md
 */

/**
 * Regex to match a full 40-character SHA-1 hex string.
 * Only full SHAs are cached to avoid stale references.
 */
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Result type for git command execution.
 */
export interface GitCommandResult {
  stdout: string;
  code: number;
}

/**
 * Default implementation of runGit using child_process.execSync.
 */
async function defaultRunGit(args: string[], cwd: string): Promise<GitCommandResult> {
  const { execSync } = await import('child_process');
  try {
    const stdout = execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), code: 0 };
  } catch (err: any) {
    // Git command failed — return error code
    return { stdout: '', code: err?.status ?? 128 };
  }
}

/**
 * GitRangeValidator provides cached Git range validation operations.
 *
 * Example:
 * ```ts
 * const validator = new GitRangeValidator('/path/to/repo');
 * const sha = await validator.verify('abc123...'); // Resolve to full SHA
 * const isAncestor = await validator.isAncestor('base-sha', 'head-sha'); // Check ancestry
 * ```
 */
export class GitRangeValidator {
  private readonly gitRoot: string;
  private readonly runGit: (args: string[], cwd: string) => Promise<GitCommandResult>;

  /**
   * Cache for resolved revisions: `${root}\0${revision}` → full SHA or null (failed)
   * Only populated for full 40-char SHAs.
   */
  private readonly revisionCache = new Map<string, string | null>();

  /**
   * Cache for ancestor checks: `${root}\0${base}\0${head}` → boolean
   * Only populated when both base and head are full 40-char SHAs.
   */
  private readonly ancestorCache = new Map<string, boolean>();

  /**
   * Create a new GitRangeValidator.
   *
   * @param gitRoot - The root directory of the Git repository
   * @param runGit - Optional custom Git runner (for testing)
   */
  constructor(
    gitRoot: string,
    runGit?: (args: string[], cwd: string) => Promise<GitCommandResult>
  ) {
    this.gitRoot = gitRoot;
    this.runGit = runGit ?? defaultRunGit;
  }

  /**
   * Verify a revision exists in the Git repository.
   * Returns the full SHA if valid, null if not found.
   *
   * Cache Behavior:
   * - Full 40-char SHA: cached (hit on subsequent calls)
   * - Partial SHA / branch name: NOT cached (re-resolve on every call)
   *
   * @param revision - The revision to verify (SHA, branch, tag, etc.)
   * @returns Full SHA if valid, null if not found
   */
  async verify(revision: string): Promise<string | null> {
    // Check if this is a full 40-char SHA
    const isFullSha = FULL_COMMIT_SHA.test(revision);

    // Try cache first (only for full SHAs)
    if (isFullSha) {
      const cacheKey = `${this.gitRoot}\0${revision}`;
      const cached = this.revisionCache.get(cacheKey);
      if (cached !== undefined) {
        return cached; // Cache hit (may be null for failed lookup)
      }
    }

    // Execute git rev-parse --verify
    const result = await this.runGit(['rev-parse', '--verify', revision], this.gitRoot);

    if (result.code !== 0) {
      // Verification failed — cache null for full SHAs
      if (isFullSha) {
        const cacheKey = `${this.gitRoot}\0${revision}`;
        this.revisionCache.set(cacheKey, null);
      }
      return null;
    }

    // Verification succeeded
    const fullSha = result.stdout.trim();

    // Cache for full SHAs
    if (isFullSha) {
      const cacheKey = `${this.gitRoot}\0${revision}`;
      this.revisionCache.set(cacheKey, fullSha);
    }

    return fullSha;
  }

  /**
   * Check if `base` is an ancestor of `head`.
   * Returns true if base is reachable from head's history, false otherwise.
   *
   * Cache Behavior:
   * - Both base and head are full 40-char SHAs: cached (hit on subsequent calls)
   * - Either is partial SHA / branch name: NOT cached (re-check on every call)
   *
   * @param base - The base commit
   * @param head - The head commit
   * @returns true if base is an ancestor of head, false otherwise
   */
  async isAncestor(base: string, head: string): Promise<boolean> {
    // Check if both are full 40-char SHAs
    const baseIsFullSha = FULL_COMMIT_SHA.test(base);
    const headIsFullSha = FULL_COMMIT_SHA.test(head);
    const bothFullSha = baseIsFullSha && headIsFullSha;

    // Try cache first (only when both are full SHAs)
    if (bothFullSha) {
      const cacheKey = `${this.gitRoot}\0${base}\0${head}`;
      const cached = this.ancestorCache.get(cacheKey);
      if (cached !== undefined) {
        return cached; // Cache hit
      }
    }

    // Execute git merge-base --is-ancestor
    const result = await this.runGit(
      ['merge-base', '--is-ancestor', base, head],
      this.gitRoot
    );

    const isAncestor = result.code === 0;

    // Cache for full SHAs
    if (bothFullSha) {
      const cacheKey = `${this.gitRoot}\0${base}\0${head}`;
      this.ancestorCache.set(cacheKey, isAncestor);
    }

    return isAncestor;
  }

  /**
   * Clear all caches (for testing or manual eviction).
   */
  clearCache(): void {
    this.revisionCache.clear();
    this.ancestorCache.clear();
  }
}
