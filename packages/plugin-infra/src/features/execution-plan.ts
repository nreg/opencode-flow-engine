/**
 * Execution plan feature module for sFlow
 *
 * Provides functions for creating, reading, validating, revising,
 * and recommending execution plans for the SFlow workflow.
 *
 * Stored in .sflow/execution-plan.json
 */
import type { ExecutionPlan, ExecutionMode, PlanSource, Wave, DP4Result, ReviewReceipt } from './execution-plan-types.js';
import { ensureDir, readJsonFile, writeJsonFile, stateFileMutex } from '@opencode-flow-engine/shared';
import { EXECUTION_MODE_THRESHOLDS } from '@opencode-flow-engine/core';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXECUTION_PLAN_FILE = '.sflow/execution-plan.json';
const STATE_FILE = '.sflow/state.json';

/** Valid execution modes for validation */
const VALID_MODES: ExecutionMode[] = ['inline', 'batch-inline', 'sdd'];

/**
 * Mode downgrade hierarchy: sdd > batch-inline > inline
 * Downgrade means moving to a "lower" mode in this order.
 */
const MODE_RANK: Record<ExecutionMode, number> = {
  inline: 0,
  'batch-inline': 1,
  sdd: 2,
};

// ─── Task 2.4: computeContentHash ─────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hex digest of an execution plan.
 * Uses canonical JSON (sorted keys) to ensure same input → same output
 * regardless of key insertion order.
 */
export async function computeContentHash(plan: ExecutionPlan): Promise<string> {
  // Create a canonical representation with sorted keys
  // Exclude the hash field itself from the hash computation
  const { hash: _hash, ...planWithoutHash } = plan;
  const canonical = canonicalJsonStringify(planWithoutHash);

  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministic JSON stringify with sorted keys.
 * Recursively sorts object keys to produce a canonical representation.
 */
function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify((obj as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

// ─── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validate execution plan structure.
 * Checks for: valid mode, duplicate task IDs, circular wave dependencies,
 * missing wave references in depends_on.
 */
export function validatePlanStructure(waves: Wave[], mode: ExecutionMode): void {
  // Validate mode
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid execution mode: "${mode}". Must be one of: ${VALID_MODES.join(', ')}`);
  }

  // Check for duplicate task IDs across waves
  const taskIds = new Set<string>();
  for (const wave of waves) {
    for (const taskId of wave.tasks) {
      if (taskIds.has(taskId)) {
        throw new Error(`Duplicate task ID "${taskId}" found across waves. Each task ID must be unique.`);
      }
      taskIds.add(taskId);
    }
  }

  // Check for missing wave references in depends_on
  const waveIds = new Set(waves.map(w => w.id));
  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      if (!waveIds.has(depId)) {
        throw new Error(`Wave "${wave.id}" depends on non-existent wave "${depId}". All depends_on references must exist.`);
      }
    }
  }

  // Check for circular dependencies using topological sort
  detectCircularDependencies(waves);
}

/**
 * Detect circular dependencies in wave graph using Kahn's algorithm.
 * Throws if a cycle is detected.
 */
function detectCircularDependencies(waves: Wave[]): void {
  if (waves.length === 0) return;

  const waveMap = new Map(waves.map(w => [w.id, w]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const wave of waves) {
    inDegree.set(wave.id, 0);
    adjacency.set(wave.id, []);
  }

  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      adjacency.get(depId)!.push(wave.id);
      inDegree.set(wave.id, (inDegree.get(wave.id) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (processed !== waves.length) {
    throw new Error('Circular wave dependencies detected. Wave dependency graph must be acyclic.');
  }
}

// ─── Task 2.1: createExecutionPlan ────────────────────────────────────────────

/**
 * Parameters for creating an execution plan.
 */
export interface CreateExecutionPlanParams {
  mode: ExecutionMode;
  source: PlanSource;
  rationale: string;
  waves: Wave[];
  revision?: number;
}

/**
 * Create an execution plan and write it to .sflow/execution-plan.json.
 *
 * Steps:
 * 1. Validate plan structure (mode, duplicate tasks, circular deps)
 * 2. Read state.json for artifacts_hash and contract_hash
 * 3. Compute content hash using SHA-256
 * 4. Write the plan to disk
 * 5. Update state.json with execution_plan_hash
 */
export async function createExecutionPlan(
  changeDir: string,
  params: CreateExecutionPlanParams,
): Promise<ExecutionPlan> {
  // 1. Validate plan structure
  validatePlanStructure(params.waves, params.mode);

  // 2. Read state.json for hashes
  const statePath = changeDir + '/' + STATE_FILE;
  const state = await readJsonFile<Record<string, unknown>>(statePath);
  if (!state) {
    throw new Error('Cannot create execution plan: state.json not found at ' + statePath);
  }

  const artifacts_hash = (state.artifacts_hash as string) || '';
  const contract_hash = (state.contract_hash as string) || '';

  // 3. Build the plan object
  const revision = params.revision ?? 1;
  const plan: ExecutionPlan = {
    mode: params.mode,
    source: params.source,
    rationale: params.rationale,
    waves: params.waves,
    hash: '', // placeholder, computed below
    artifacts_hash,
    contract_hash,
    revision,
  };

  // 4. Compute content hash
  plan.hash = await computeContentHash(plan);

  // 5. Write the plan to disk
  const planPath = changeDir + '/' + EXECUTION_PLAN_FILE;
  await ensureDir(changeDir + '/.sflow');
  await writeJsonFile(planPath, plan);

  // 6. Update state.json with execution_plan_hash
  await stateFileMutex.runExclusive(async () => {
    const currentState = await readJsonFile<Record<string, unknown>>(statePath);
    if (currentState) {
      currentState.execution_plan_hash = plan.hash;
      currentState.updatedAt = new Date().toISOString();
      await writeJsonFile(statePath, currentState);
    }
  });

  return plan;
}

// ─── Task 2.2: readExecutionPlan ──────────────────────────────────────────────

/**
 * Read and parse the execution plan from .sflow/execution-plan.json.
 * Returns null if the file does not exist.
 */
export async function readExecutionPlan(changeDir: string): Promise<ExecutionPlan | null> {
  const planPath = changeDir + '/' + EXECUTION_PLAN_FILE;
  return readJsonFile<ExecutionPlan>(planPath);
}

// ─── Task 2.2: validatePlanHashes ─────────────────────────────────────────────

/**
 * Result of hash validation.
 */
export interface HashValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that the plan's hashes match the current state.json values.
 * Compares artifacts_hash and contract_hash.
 */
export async function validatePlanHashes(
  plan: ExecutionPlan,
  changeDir: string,
): Promise<HashValidationResult> {
  const statePath = changeDir + '/' + STATE_FILE;
  const state = await readJsonFile<Record<string, unknown>>(statePath);

  if (!state) {
    return { valid: false, reason: 'state.json not found' };
  }

  const currentArtifactsHash = (state.artifacts_hash as string) || '';
  const currentContractHash = (state.contract_hash as string) || '';

  if (plan.artifacts_hash !== currentArtifactsHash) {
    return {
      valid: false,
      reason: `artifacts_hash mismatch: plan has "${plan.artifacts_hash}" but state.json has "${currentArtifactsHash}"`,
    };
  }

  if (plan.contract_hash !== currentContractHash) {
    return {
      valid: false,
      reason: `contract_hash mismatch: plan has "${plan.contract_hash}" but state.json has "${currentContractHash}"`,
    };
  }

  return { valid: true };
}

// ─── Task 2.3: reviseExecutionPlan ────────────────────────────────────────────

/**
 * Parameters for revising an execution plan.
 */
export interface ReviseExecutionPlanParams {
  mode: ExecutionMode;
  source: PlanSource;
  rationale: string;
  waves: Wave[];
}

/**
 * Revise an existing execution plan.
 *
 * - Increments revision number
 * - Rejects mode downgrade (sdd → inline, sdd → batch-inline, batch-inline → inline)
 * - Allows mode upgrade (inline → sdd, inline → batch-inline, batch-inline → sdd)
 * - Validates the new plan structure
 * - Updates state.json with new execution_plan_hash
 */
export async function reviseExecutionPlan(
  changeDir: string,
  params: ReviseExecutionPlanParams,
): Promise<ExecutionPlan> {
  // Read existing plan
  const existingPlan = await readExecutionPlan(changeDir);
  if (!existingPlan) {
    throw new Error('No execution plan exists to revise. Create one first with createExecutionPlan.');
  }

  // Check for mode downgrade
  const currentRank = MODE_RANK[existingPlan.mode];
  const newRank = MODE_RANK[params.mode];

  if (newRank < currentRank) {
    throw new Error(
      `Mode downgrade not allowed: cannot change from "${existingPlan.mode}" to "${params.mode}". ` +
      `Downgrading execution mode compromises the integrity of the execution plan. ` +
      `Upgrade is allowed (e.g. inline → sdd), but downgrade is not.`
    );
  }

  // Validate the new plan structure
  validatePlanStructure(params.waves, params.mode);

  // Read state.json for current hashes
  const statePath = changeDir + '/' + STATE_FILE;
  const state = await readJsonFile<Record<string, unknown>>(statePath);
  if (!state) {
    throw new Error('Cannot revise execution plan: state.json not found');
  }

  const artifacts_hash = (state.artifacts_hash as string) || '';
  const contract_hash = (state.contract_hash as string) || '';

  // Build revised plan with incremented revision
  const revisedPlan: ExecutionPlan = {
    mode: params.mode,
    source: params.source,
    rationale: params.rationale,
    waves: params.waves,
    hash: '',
    artifacts_hash,
    contract_hash,
    revision: existingPlan.revision + 1,
  };

  // Compute new content hash
  revisedPlan.hash = await computeContentHash(revisedPlan);

  // Write revised plan to disk
  const planPath = changeDir + '/' + EXECUTION_PLAN_FILE;
  await writeJsonFile(planPath, revisedPlan);

  // Update state.json with new execution_plan_hash
  await stateFileMutex.runExclusive(async () => {
    const currentState = await readJsonFile<Record<string, unknown>>(statePath);
    if (currentState) {
      currentState.execution_plan_hash = revisedPlan.hash;
      currentState.updatedAt = new Date().toISOString();
      await writeJsonFile(statePath, currentState);
    }
  });

  return revisedPlan;
}

// ─── Task 2.5: recommendExecutionMode ─────────────────────────────────────────

/**
 * Dependency detection keywords in tasks.md content.
 * These keywords indicate cross-task or cross-module dependencies.
 */
const DEPENDENCY_KEYWORDS = [
  'depends on',
  'depends upon',
  'requires',
  'cross-module',
  'cross module',
  'must complete before',
  'must be done before',
  'prerequisite',
  'after',
  'follows',
];

/**
 * Recommend an execution mode based on tasks.md content analysis.
 *
 * Logic:
 * - 1-2 tasks, no dependencies → inline
 * - 3-5 tasks, no dependencies → batch-inline
 * - 6+ tasks OR has dependencies → sdd
 *
 * @param tasksMdContent - The content of the tasks.md file
 * @returns DP4Result with the recommended mode and rationale
 */
export function recommendExecutionMode(tasksMdContent: string): DP4Result {
  // Count tasks: lines starting with "- [ ]" (unchecked task items)
  const taskLines = tasksMdContent.split('\n').filter(line => /^\s*-\s*\[\s*\]/.test(line));
  const taskCount = taskLines.length;

  // Detect dependencies by scanning for keywords
  const lowerContent = tasksMdContent.toLowerCase();
  const hasDependencies = DEPENDENCY_KEYWORDS.some(kw => lowerContent.includes(kw));

  // Determine mode based on thresholds and dependencies
  let mode: ExecutionMode;
  let rationale: string;

  if (hasDependencies) {
    mode = 'sdd';
    rationale = `Tasks have cross-wave dependencies detected: sdd mode recommended for structured execution with dependency management.`;
  } else if (taskCount <= EXECUTION_MODE_THRESHOLDS.inline.maxTasks) {
    mode = 'inline';
    rationale = `${taskCount} task(s) with no dependencies: inline mode recommended for simple, direct execution.`;
  } else if (taskCount <= EXECUTION_MODE_THRESHOLDS['batch-inline'].maxTasks) {
    mode = 'batch-inline';
    rationale = `${taskCount} tasks with no dependencies: batch-inline mode recommended for grouped execution.`;
  } else {
    mode = 'sdd';
    rationale = `${taskCount} tasks: sdd mode recommended for complex execution with multiple waves and review gates.`;
  }

  return {
    mode,
    taskCount,
    hasDependencies,
    rationale,
  };
}

// ─── Task 9.1: recordReviewReceipt ────────────────────────────────────────────

const REVIEWS_DIR = '.sflow/reviews';

/**
 * Record a review receipt for a wave.
 *
 * Validates that the waveId exists in the current execution plan,
 * then writes the receipt to .sflow/reviews/<wave-id>.json.
 * Overwrites any existing receipt for the same wave (re-review).
 *
 * @param changeDir - The project/change directory
 * @param waveId - The wave ID to record the receipt for
 * @param receipt - The receipt data (status, base, head, report)
 * @returns The full ReviewReceipt with recorded_at timestamp
 */
export async function recordReviewReceipt(
  changeDir: string,
  waveId: string,
  receipt: Omit<ReviewReceipt, 'recorded_at'>,
): Promise<ReviewReceipt> {
  const plan = await readExecutionPlan(changeDir);
  if (!plan) {
    throw new Error('No execution plan found. Create an execution plan first before recording review receipts.');
  }

  const waveExists = plan.waves.some(w => w.id === waveId);
  if (!waveExists) {
    throw new Error(`Wave "${waveId}" not found in execution plan. Available waves: ${plan.waves.map(w => w.id).join(', ')}`);
  }

  const reviewsDir = changeDir + '/' + REVIEWS_DIR;
  await ensureDir(reviewsDir);

  const fullReceipt: ReviewReceipt = {
    status: receipt.status,
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    recorded_at: new Date().toISOString(),
  };

  const receiptPath = reviewsDir + '/' + waveId + '.json';
  await writeJsonFile(receiptPath, fullReceipt);

  return fullReceipt;
}
