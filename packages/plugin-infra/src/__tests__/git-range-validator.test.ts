/**
 * GitRangeValidator tests — Process-level cache for Git range validation
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers:
 * - Full SHA cache hit on second call
 * - Non-full SHA bypasses cache
 * - Failed verification cached as null
 * - Cache eviction does not break correctness
 * - Ancestor validation caching
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { GitRangeValidator } from '../hooks/guard/checks/git-range-validator.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const FULL_SHA_1 = 'a'.repeat(40); // 'aaa...40chars'
const FULL_SHA_2 = 'b'.repeat(40); // 'bbb...40chars'
const PARTIAL_SHA = 'abc123'; // Not a full 40-char SHA
const BRANCH_NAME = 'main'; // Mutable revision

function createMockRunGit(mockResults: Map<string, { stdout: string; code: number }>) {
  return async (args: string[], cwd: string): Promise<{ stdout: string; code: number }> => {
    const key = args.join(' ');
    const result = mockResults.get(key);
    if (result) return result;
    // Default: command not found
    return { stdout: '', code: 128 };
  };
}

// ─── GitRangeValidator Tests ───────────────────────────────────────────────────

describe('GitRangeValidator', () => {
  let validator: GitRangeValidator;
  let gitCallCount: number;
  let mockRunGit: (args: string[], cwd: string) => Promise<{ stdout: string; code: number }>;

  beforeEach(() => {
    gitCallCount = 0;
    // Create a mock runGit that tracks call count
    mockRunGit = async (args: string[], cwd: string) => {
      gitCallCount++;
      const key = args.join(' ');
      
      // Default success responses
      if (key.startsWith('rev-parse --verify')) {
        return { stdout: args[2] || '', code: 0 }; // Return the SHA itself
      }
      if (key.startsWith('merge-base --is-ancestor')) {
        return { stdout: '', code: 0 }; // Success (is ancestor)
      }
      if (key === 'rev-parse --git-dir') {
        return { stdout: '.git', code: 0 }; // Git repo detected
      }
      
      return { stdout: '', code: 0 };
    };
    
    validator = new GitRangeValidator('/test/repo', mockRunGit);
  });

  // ─── Scenario: Full SHA Cache Hit on Second Call ───────────────────────────

  it('should cache full SHA verification result and avoid re-invoking Git', async () => {
    // First call — should invoke Git
    const result1 = await validator.verify(FULL_SHA_1);
    expect(result1).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(1);

    // Second call — should hit cache
    const result2 = await validator.verify(FULL_SHA_1);
    expect(result2).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(1); // No additional Git call
  });

  it('should cache full SHA ancestor validation and avoid re-invoking Git', async () => {
    // First call — should invoke Git
    const result1 = await validator.isAncestor(FULL_SHA_1, FULL_SHA_2);
    expect(result1).toBe(true);
    const firstCallCount = gitCallCount;
    expect(firstCallCount).toBeGreaterThan(0);

    // Second call — should hit cache
    gitCallCount = 0; // Reset counter
    const result2 = await validator.isAncestor(FULL_SHA_1, FULL_SHA_2);
    expect(result2).toBe(true);
    expect(gitCallCount).toBe(0); // No additional Git call
  });

  // ─── Scenario: Non-Full SHA Bypasses Cache ───────────────────────────────────

  it('should bypass cache for non-full SHA (partial SHA)', async () => {
    // First call
    const result1 = await validator.verify(PARTIAL_SHA);
    expect(result1).toBe(PARTIAL_SHA);
    expect(gitCallCount).toBe(1);

    // Second call — should NOT hit cache, re-invoke Git
    const result2 = await validator.verify(PARTIAL_SHA);
    expect(result2).toBe(PARTIAL_SHA);
    expect(gitCallCount).toBe(2); // Additional Git call
  });

  it('should bypass cache for non-full SHA (branch name)', async () => {
    // First call
    const result1 = await validator.verify(BRANCH_NAME);
    expect(result1).toBe(BRANCH_NAME);
    expect(gitCallCount).toBe(1);

    // Second call — should NOT hit cache, re-invoke Git
    const result2 = await validator.verify(BRANCH_NAME);
    expect(result2).toBe(BRANCH_NAME);
    expect(gitCallCount).toBe(2); // Additional Git call
  });

  it('should bypass cache for ancestor validation with non-full SHA', async () => {
    // First call with partial SHA
    const result1 = await validator.isAncestor(PARTIAL_SHA, FULL_SHA_2);
    expect(result1).toBe(true);
    const firstCallCount = gitCallCount;

    // Second call — should NOT hit cache
    gitCallCount = 0;
    const result2 = await validator.isAncestor(PARTIAL_SHA, FULL_SHA_2);
    expect(result2).toBe(true);
    expect(gitCallCount).toBeGreaterThan(0); // Re-invoked Git
  });

  // ─── Scenario: Failed Verification Cached as Null ───────────────────────────

  it('should cache failed verification as null and avoid re-invoking Git', async () => {
    // Create a validator with a mock that returns failure for invalid SHA
    const invalidSha = '0'.repeat(40); // '000...40chars'
    const failMockRunGit = async (args: string[], cwd: string) => {
      gitCallCount++;
      const key = args.join(' ');
      
      if (key.startsWith('rev-parse --verify')) {
        return { stdout: '', code: 128 }; // Failure
      }
      return { stdout: '', code: 0 };
    };
    
    const failValidator = new GitRangeValidator('/test/repo', failMockRunGit);

    // First call — should fail and cache null
    const result1 = await failValidator.verify(invalidSha);
    expect(result1).toBe(null);
    expect(gitCallCount).toBe(1);

    // Second call — should return cached null without Git call
    const result2 = await failValidator.verify(invalidSha);
    expect(result2).toBe(null);
    expect(gitCallCount).toBe(1); // No additional Git call
  });

  it('should cache failed ancestor validation as false', async () => {
    // Create a validator with a mock that returns failure for ancestor check
    const failMockRunGit = async (args: string[], cwd: string) => {
      gitCallCount++;
      const key = args.join(' ');
      
      if (key.startsWith('merge-base --is-ancestor')) {
        return { stdout: '', code: 1 }; // Failure (not ancestor)
      }
      if (key.startsWith('rev-parse --verify')) {
        return { stdout: args[2] || '', code: 0 }; // Success
      }
      return { stdout: '', code: 0 };
    };
    
    const failValidator = new GitRangeValidator('/test/repo', failMockRunGit);

    // First call — should fail and cache false
    const result1 = await failValidator.isAncestor(FULL_SHA_1, FULL_SHA_2);
    expect(result1).toBe(false);
    const firstCallCount = gitCallCount;

    // Second call — should return cached false without Git call
    gitCallCount = 0;
    const result2 = await failValidator.isAncestor(FULL_SHA_1, FULL_SHA_2);
    expect(result2).toBe(false);
    expect(gitCallCount).toBe(0); // No additional Git call
  });

  // ─── Scenario: Cache Eviction Does Not Break Correctness ────────────────────

  it('should re-invoke Git after cache eviction and return correct result', async () => {
    // First call — cache the result
    const result1 = await validator.verify(FULL_SHA_1);
    expect(result1).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(1);

    // Clear the cache (simulating eviction)
    validator.clearCache();

    // Second call — should re-invoke Git
    const result2 = await validator.verify(FULL_SHA_1);
    expect(result2).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(2); // Additional Git call
  });

  // ─── Additional: Multiple Different Full SHAs ───────────────────────────────

  it('should cache multiple different full SHAs independently', async () => {
    // First SHA
    const result1 = await validator.verify(FULL_SHA_1);
    expect(result1).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(1);

    // Second SHA — different key, should invoke Git
    const result2 = await validator.verify(FULL_SHA_2);
    expect(result2).toBe(FULL_SHA_2);
    expect(gitCallCount).toBe(2);

    // First SHA again — should hit cache
    const result3 = await validator.verify(FULL_SHA_1);
    expect(result3).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(2); // No additional Git call

    // Second SHA again — should hit cache
    const result4 = await validator.verify(FULL_SHA_2);
    expect(result4).toBe(FULL_SHA_2);
    expect(gitCallCount).toBe(2); // No additional Git call
  });

  // ─── Additional: Mixed Full and Non-Full SHAs ───────────────────────────────

  it('should handle mixed full and non-full SHA calls correctly', async () => {
    // Full SHA — should cache
    const result1 = await validator.verify(FULL_SHA_1);
    expect(result1).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(1);

    // Non-full SHA — should NOT cache
    const result2 = await validator.verify(PARTIAL_SHA);
    expect(result2).toBe(PARTIAL_SHA);
    expect(gitCallCount).toBe(2);

    // Full SHA again — should hit cache
    const result3 = await validator.verify(FULL_SHA_1);
    expect(result3).toBe(FULL_SHA_1);
    expect(gitCallCount).toBe(2); // No additional Git call

    // Non-full SHA again — should NOT hit cache
    const result4 = await validator.verify(PARTIAL_SHA);
    expect(result4).toBe(PARTIAL_SHA);
    expect(gitCallCount).toBe(3); // Additional Git call
  });
});
