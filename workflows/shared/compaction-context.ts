/**
 * Compaction Context — preserves workflow state across session compaction.
 *
 * When OpenCode compacts a session (to save tokens), it fires the
 * "experimental.session.compacting" event. This module generates a
 * context prompt that tells the agent what state it was in.
 */

export interface CompactionState {
  state: string;
  updatedAt?: string;
  dp0?: string;
  dp1?: string;
  dp2?: string;
  dp3?: string;
  dp4?: string;
  dp5?: string;
}

export interface TaskProgress {
  completedTasks?: number;
  totalTasks?: number;
  currentBatch?: string;
  currentTask?: string;
}

/**
 * Generate a compaction context prompt for the given workflow state.
 */
export function createCompactionContext(
  workflowName: string,
  state: CompactionState,
  progress?: TaskProgress
): string {
  const lines: string[] = [
    `[${workflowName}] Session compacted — preserving workflow state.`,
    '',
    `Current State: ${state.state}`,
    `Last Updated: ${state.updatedAt ?? 'unknown'}`,
    '',
  ];

  if (progress) {
    lines.push(`Progress: ${progress.completedTasks ?? 0}/${progress.totalTasks ?? 0} tasks completed`);
    if (progress.currentBatch) lines.push(`Current Batch: ${progress.currentBatch}`);
    if (progress.currentTask) lines.push(`Current Task: ${progress.currentTask}`);
    lines.push('');
  }

  const dps = ['dp0', 'dp1', 'dp2', 'dp3', 'dp4', 'dp5'] as const;
  const hasDp = dps.some(dp => state[dp as keyof CompactionState]);
  if (hasDp) {
    lines.push('Decision Points:');
    for (const dp of dps) {
      const val = state[dp as keyof CompactionState];
      if (val) lines.push(`- ${dp.toUpperCase()}: ${val}`);
    }
    lines.push('');
  }

  lines.push(
    'Preserve the current workflow state, decision points, and task progress across compaction. After compaction, continue from the next concrete unfinished step. Before completing, audit real artifacts and command outputs.'
  );

  return lines.join('\n');
}
