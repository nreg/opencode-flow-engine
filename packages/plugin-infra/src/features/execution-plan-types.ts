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

/** Repair state status for circuit breaker */
export type RepairStatus = 'repairing' | 'adjudication-required' | 'resolved';

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
 * Stored in .flow-engine/sflow/reviews/<wave-id>.json (root level, legacy/compat)
 * and .flow-engine/sflow/plans/<identity>/reviews/<wave-id>.json (plan-scoped, authoritative)
 *
 * T2.9: 双写机制 - root 为兼容镜像，plan-scoped 为权威副本
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
  /** Plan hash (T2.9: plan-scoped SDD 记录) */
  plan_hash?: string;
  /** Plan revision (T2.9: plan-scoped SDD 记录) */
  plan_revision?: number;
  /** Optional repair state (T2.5-T2.7: circuit breaker) */
  repair_state?: RepairState;
}

/**
 * Review evidence for a failed review.
 * Captures the essential information from a failed review for audit trail.
 */
export interface ReviewEvidence {
  /** Git commit hash of the review base */
  base: string;
  /** Git commit hash of the review head */
  head: string;
  /** Review report content or path */
  report: string;
  /** ISO 8601 timestamp of when the review was recorded */
  recorded_at: string;
}

/**
 * Repair state for a wave's circuit breaker.
 * Stored in .flow-engine/sflow/plans/<plan_identity>/repair-state/<wave_id>.json
 * Tracks consecutive repair failures and enforces adjudication when threshold is reached.
 */
export interface RepairState {
  /** Plan hash that this repair state belongs to */
  plan_hash: string;
  /** Plan revision number */
  plan_revision: number;
  /** Wave ID that this repair state tracks */
  wave_id: string;
  /** Current repair status */
  status: RepairStatus;
  /** Number of consecutive failures */
  failure_count: number;
  /** Maximum failures before adjudication is required (configurable, default 5) */
  max_failures: number;
  /** Git commit hash of the previous review head (for continuity check) */
  previous_head: string | null;
  /** Previous review report path (for continuity check) */
  previous_report: string | null;
  /** Array of all failure evidences for audit trail */
  failures: ReviewEvidence[];
  /** ISO 8601 timestamp of when the state was last updated */
  updated_at: string;
  /** Resolution evidence (when status is 'resolved') */
  resolution?: ReviewEvidence;
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
