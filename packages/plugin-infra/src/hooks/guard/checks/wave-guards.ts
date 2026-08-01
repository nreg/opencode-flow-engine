/**
 * Wave-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, directoryExists, readJsonFile } from "@opencode-flow-engine/shared";
import { readExecutionPlan as readExecutionPlanFeature } from "../../../features/execution-plan.js";
import type { Wave } from "../../../features/execution-plan-types.js";
import { getStateFilePath } from "../../../features/state-manager.js";

/**
 * Topological sort using Kahn's algorithm (BFS-based).
 * Returns sorted wave IDs or throws if a cycle is detected.
 */
function topologicalSort(waves: Wave[]): string[] {
  if (waves.length === 0) return [];

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const wave of waves) {
    inDegree.set(wave.id, 0);
    adjacency.set(wave.id, []);
  }

  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      if (adjacency.has(depId)) {
        adjacency.get(depId)!.push(wave.id);
        inDegree.set(wave.id, (inDegree.get(wave.id) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== waves.length) {
    throw new Error('Circular wave dependencies detected. Wave dependency graph must be acyclic.');
  }

  return sorted;
}

/**
 * WD-1/WD-2/WD-3: Check wave dependencies in execution plan.
 * Validates: circular dependencies, missing wave references, empty waves.
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
export async function checkWaveDependencies(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Read execution plan — skip if none exists (backward compatible)
  const plan = await readExecutionPlanFeature(changeDir);
  if (!plan) return { success: true };

  const waves = plan.waves;
  if (!waves || waves.length === 0) return { success: true };

  // Check for empty waves
  for (const wave of waves) {
    if (!wave.tasks || wave.tasks.length === 0) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Wave dependency check: wave "${wave.id}" is empty (no tasks). Every wave must have at least one task.`,
      };
    }
  }

  // Check for missing wave references in depends_on
  const waveIds = new Set(waves.map(w => w.id));
  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      if (!waveIds.has(depId)) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Wave dependency check: wave "${wave.id}" depends on non-existent wave "${depId}". All depends_on references must exist in the execution plan.`,
        };
      }
    }
  }

  // Check for circular dependencies using topological sort
  try {
    topologicalSort(waves);
  } catch (err) {
    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Wave dependency check: ${(err instanceof Error ? err.message : String(err))}`,
    };
  }

  return { success: true };
}

/**
 * RR-2/RR-4/RR-5: Check review receipt integrity.
 * Validates: receipt existence, required fields, symlink detection, commit hash validity.
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
export async function checkReceiptIntegrity(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Read execution plan — skip if none exists (backward compatible)
  const plan = await readExecutionPlanFeature(changeDir);
  if (!plan) return { success: true };

  const waves = plan.waves;
  if (!waves || waves.length === 0) return { success: true };

  const REQUIRED_RECEIPT_FIELDS = ['status', 'base', 'head', 'report'] as const;

  for (const wave of waves) {
    const receiptPath = `${changeDir}/.flow-engine/sflow/reviews/${wave.id}.json`;
    const receiptExists = await fileExists(receiptPath);

    if (!receiptExists) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Receipt integrity check: missing receipt for wave "${wave.id}". Expected at ${receiptPath}.`,
      };
    }

    // RR-5: Symlink detection using fs.realpathSync
    try {
      const fs = await import('fs');
      const realPath = fs.realpathSync(receiptPath);
      const expectedPath = receiptPath.replace(/\\/g, '/');
      const resolvedReal = realPath.replace(/\\/g, '/');
      if (resolvedReal !== expectedPath) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Receipt integrity check: symlinked receipt detected for wave "${wave.id}". Receipt path "${expectedPath}" resolves to "${resolvedReal}". Symlinked receipts are not allowed.`,
        };
      }
    } catch {
      // realpathSync may fail on some systems — skip symlink check
    }

    const receipt = await readJsonFile<Record<string, unknown>>(receiptPath);
    if (!receipt) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Receipt integrity check: cannot read receipt for wave "${wave.id}".`,
      };
    }

    // RR-2: Validate required fields
    for (const field of REQUIRED_RECEIPT_FIELDS) {
      if (!(field in receipt) || receipt[field] === undefined || receipt[field] === null) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt is missing required field "${field}".`,
        };
      }
      // Check for empty string values on base/head
      if ((field === 'base' || field === 'head') && receipt[field] === '') {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt has empty "${field}" commit hash.`,
        };
      }
    }

    // RR-4: Commit hash revalidation via git rev-parse --verify
    try {
      const { execSync } = await import('child_process');
      // First check if this is a git repo
      try {
        execSync('git rev-parse --git-dir', {
          cwd: changeDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch {
        // Not a git repo — skip commit validation gracefully
        continue;
      }

      const baseHash = String(receipt.base);
      const headHash = String(receipt.head);

      if (baseHash) {
        try {
          execSync(`git rev-parse --verify "${baseHash}"`, {
            cwd: changeDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch {
          return {
            success: false,
            block: true,
            blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt has invalid base commit hash "${baseHash}". Hash not found in git history.`,
          };
        }
      }

      if (headHash) {
        try {
          execSync(`git rev-parse --verify "${headHash}"`, {
            cwd: changeDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch {
          return {
            success: false,
            block: true,
            blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt has invalid head commit hash "${headHash}". Hash not found in git history.`,
          };
        }
      }

      // Ancestor validation: base must be an ancestor of head
      if (baseHash && headHash) {
        try {
          execSync(`git merge-base --is-ancestor "${baseHash}" "${headHash}"`, {
            cwd: changeDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch {
          return {
            success: false,
            block: true,
            blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt base commit "${baseHash}" is not an ancestor of head commit "${headHash}". base must be reachable from head's history.`,
          };
        }
      }
    } catch {
      // Non-git repo or git not available — skip commit validation gracefully
    }
  }

  return { success: true };
}

/**
 * CG-1/CG-3/CG-4/CG-7: Check closing gate — all review receipts must have status=pass
 * and test results must be verified before transitioning to closing state.
 * - If no execution-plan.json exists → skip (backward compatible, CG-4)
 * - Read all review receipts from .flow-engine/sflow/reviews/
 * - Check that ALL receipts have status='pass'
 * - If verification-report.md exists, check test results for pass
 * - If any receipt has status='fail' or is missing → block transition to closing
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
export async function checkClosingGate(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Read execution plan — skip if none exists (backward compatible, CG-4)
  const plan = await readExecutionPlanFeature(changeDir);
  if (!plan) return { success: true };

  const waves = plan.waves;
  if (!waves || waves.length === 0) return { success: true };

  for (const wave of waves) {
    const receiptPath = `${changeDir}/.flow-engine/sflow/reviews/${wave.id}.json`;
    const receiptExists = await fileExists(receiptPath);

    if (!receiptExists) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Closing gate: missing receipt for wave "${wave.id}". All waves must have review receipts before closing.`,
      };
    }

    const receipt = await readJsonFile<{ status?: string }>(receiptPath);
    if (!receipt) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Closing gate: cannot read receipt for wave "${wave.id}".`,
      };
    }

    if (receipt.status !== 'pass') {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Closing gate: wave "${wave.id}" receipt has status "${receipt.status || 'unknown'}". All receipts must have status "pass" before closing.`,
      };
    }
  }

  // CG-7: Check verification-report.md for test results if it exists
  const verificationReportPath = `${changeDir}/.flow-engine/sflow/archive/*/verification-report.md`;
  // Also check the change archive directory for verification reports
  let testPassed = true;
  let testEvidenceFound = false;

  try {
    const { readFile: fsReadFile } = await import('node:fs/promises');
    const verificationPaths = [
      `${changeDir}/verification-report.md`,
      `${changeDir}/archive/verification-report.md`,
    ];
    // Also check change-level archive directories
    const { readdir } = await import('node:fs/promises');
    const archiveDir = `${changeDir}/archive`;
    const archiveExists = await fileExists(archiveDir);
    if (archiveExists) {
      try {
        const changeDirs = await readdir(archiveDir);
        for (const changeDirName of changeDirs) {
          verificationPaths.push(`${archiveDir}/${changeDirName}/verification-report.md`);
        }
      } catch {
        // ignore
      }
    }

    for (const vp of verificationPaths) {
      const reportExists = await fileExists(vp);
      if (!reportExists) continue;
      testEvidenceFound = true;
      try {
        const reportContent = await fsReadFile(vp, 'utf8');
        // Check for test failure indicators
        if (
          /\b(failed|FAILED|failure|errors)\b/.test(reportContent) &&
          /tests?\s+(failed|FAILED)/i.test(reportContent)
        ) {
          testPassed = false;
          return {
            success: false,
            block: true,
            blockReason: `[SFLOW] Closing gate: verification report at ${vp} shows test failures. All tests must pass before closing.`,
          };
        }
        // Check for explicit pass evidence
        const passMatch = reportContent.match(/(\d+)\/(\d+)\s+(passed|passing)/i);
        if (passMatch && passMatch[1] !== undefined && passMatch[2] !== undefined) {
          const passed = parseInt(passMatch[1], 10);
          const total = parseInt(passMatch[2], 10);
          if (passed < total) {
            testPassed = false;
            return {
              success: false,
              block: true,
              blockReason: `[SFLOW] Closing gate: verification report at ${vp} shows ${passed}/${total} tests passed. All tests must pass before closing.`,
            };
          }
        }
      } catch {
        // If we can't read the report, don't block — it may be a format issue
      }
    }
  } catch {
    // File system errors are non-blocking
  }

  if (testEvidenceFound && !testPassed) {
    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Closing gate: test results from verification reports indicate failures. All tests must pass before closing.`,
    };
  }

  return { success: true };
}

/**
 * CG-6: Check if specs have been merged before closing (Issue #28, P1-1).
 * 
 * P1-1 更新：优先使用 Publication Receipt 验证，spec_merged 作为降级兼容。
 * 
 * 验证优先级：
 * 1. 检查 .flow-engine/sflow/spec-publication/ 目录是否存在收据
 * 2. 如果存在收据，验证其完整性和一致性
 * 3. 如果不存在收据但 state.json 中 spec_merged=true，发出 WARNING 但放行（降级兼容）
 * 4. 如果既无收据也无 spec_merged，阻断 closing
 * 
 * 向后兼容：
 * - 旧项目可能只有 spec_merged=true，无 publication receipt
 * - 给予过渡期，仅警告不阻断
 * 
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
export async function checkSpecsMerged(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Check if delta-specs directory exists
  const deltaSpecsPath = `${changeDir}/specs/delta`;
  const deltaSpecsExists = await directoryExists(deltaSpecsPath);
  if (!deltaSpecsExists) return { success: true };

  // Check if delta-specs directory has any .md files
  let mdFiles: string[] = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(deltaSpecsPath);
    mdFiles = files.filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) return { success: true }; // Empty delta-specs dir, skip
  } catch {
    return { success: true }; // Can't read dir, skip
  }

  // P1-1: 优先检查 Publication Receipt
  const { hasPublicationReceipts, listPublicationReceipts, readPublicationReceipt, validatePublicationReceipt } = await import('../../../features/spec-publication.js');
  
  const hasReceipts = await hasPublicationReceipts(changeDir);
  if (hasReceipts) {
    // 存在收据目录，验证收据完整性
    const receiptCapabilities = await listPublicationReceipts(changeDir);
    
    // 读取所有收据并验证
    for (const capability of receiptCapabilities) {
      const receipt = await readPublicationReceipt(changeDir, capability);
      if (!receipt) {
        console.warn(`[P1-1] Publication receipt damaged for capability: ${capability}`);
        continue;
      }
      
      // 构造 spec 文件列表（简化：假设每个 delta spec 对应一个 capability）
      const specFiles = mdFiles.map(f => `${deltaSpecsPath}/${f}`);
      
      // 验证收据
      const validation = await validatePublicationReceipt(changeDir, changeDir, receipt, specFiles);
      if (!validation.pass) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Specs publication check: publication receipt validation failed. ${validation.reason} Re-run spec merge to update receipt.`,
        };
      }
    }
    
    // 所有收据验证通过
    return { success: true };
  }

  // P1-1: 降级兼容 - 检查旧的 spec_merged flag
  const stateData = await readJsonFile<{ spec_merged?: boolean }>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (stateData?.spec_merged === true) {
    // 旧项目过渡期：仅有 spec_merged=true，无 publication receipt
    // 发出 WARNING 但放行
    return {
      success: true,
      warnings: [
        `[SFLOW] Specs merged check: using legacy spec_merged=true flag. Consider migrating to publication receipts for stronger verification.`,
      ],
    };
  }

  // 既无收据也无 spec_merged，阻断 closing
  return {
    success: false,
    block: true,
    blockReason: `[SFLOW] Specs merged check: delta-specs exist in specs/delta/ but no publication receipt found and spec_merged is not true. Merge delta specs before closing.`,
  };
}
