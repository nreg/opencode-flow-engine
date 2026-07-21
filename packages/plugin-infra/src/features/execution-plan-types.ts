/**
 * Execution plan types for sFlow
 *
 * Defines TypeScript interfaces for the execution control plane:
 * - ExecutionMode: inline | batch-inline | sdd
 * - Wave: task scheduling unit with dependency graph
 * - ReviewReceipt: tamper-evident review record per wave
 * - DP4Result: execution mode recommendation output
 * - ExecutionPlan: full execution plan artifact
 */

/** Execution mode determines how tasks are scheduled and run */
export type ExecutionMode = 'inline' | 'batch-inline' | 'sdd';

/** Receipt status for review results */
export type ReceiptStatus = 'pass' | 'fail';

/** Wave scheduling strategy */
export type WaveStrategy = 'parallel' | 'serial';

/** Source of the execution plan decision */
export type PlanSource = 'user-override' | 'default';

/**
 * A wave of tasks within an execution plan.
 * Waves are scheduled according to their dependency graph.
 */
export interface Wave {
  /** Unique wave identifier (e.g. "W1", "W2") */
  id: string;
  /** Scheduling strategy for tasks within this wave */
  strategy: WaveStrategy;
  /** Task IDs belonging to this wave */
  tasks: string[];
  /** Wave IDs this wave depends on (must complete before this wave starts) */
  depends_on: string[];
}

/**
 * Review receipt for a wave.
 * Stored in .flow-engine/sflow/reviews/<wave-id>.json
 */
export interface ReviewReceipt {
  /** Whether the review passed or failed */
  status: ReceiptStatus;
  /** Git commit hash of the review base */
  base: string;
  /** Git commit hash of the review head */
  head: string;
  /** Review report content or path */
  report: string;
  /** ISO 8601 timestamp of when the receipt was recorded */
  recorded_at: string;
}

/**
 * DP-4 execution mode recommendation result.
 * Produced by recommendExecutionMode() during bridging→approved-for-build transition.
 */
export interface DP4Result {
  /** Recommended execution mode */
  mode: ExecutionMode;
  /** Number of tasks detected */
  taskCount: number;
  /** Whether cross-wave dependencies were detected */
  hasDependencies: boolean;
  /** Human-readable rationale for the recommendation */
  rationale: string;
}

/**
 * Execution plan artifact.
 * Stored in .flow-engine/sflow/execution-plan.json
 */
export interface ExecutionPlan {
  /** Execution mode (inline, batch-inline, or sdd) */
  mode: ExecutionMode;
  /** Whether the plan was auto-recommended or user-overridden */
  source: PlanSource;
  /** Rationale for the chosen execution mode */
  rationale: string;
  /** Ordered waves of tasks with dependency graph */
  waves: Wave[];
  /** SHA-256 content hash of the plan (canonical JSON) */
  hash: string;
  /** Hash of the artifacts directory at plan creation time */
  artifacts_hash: string;
  /** Hash of the execution-contract.md at plan creation time */
  contract_hash: string;
  /** Plan revision number (increments on each revise) */
  revision: number;
}
