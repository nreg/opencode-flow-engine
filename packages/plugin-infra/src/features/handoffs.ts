/**
 * Standard Handoff Formatting for SFlow Workflow
 * 
 * Provides consistent user-facing handoff messages across all execution skills.
 * Based on spec-superflow's release-archivist Standard User-Facing Handoff format.
 */

/**
 * Supported handoff scenarios
 */
export type HandoffScenario =
  | 'normal'              // Normal workflow progression
  | 'blocked'             // Blocked by missing evidence or failure
  | 'approval-wait'       // Waiting for user approval (DP gates)
  | 'closing-in-progress' // Release verification or archive in progress
  | 'terminal';           // Successfully reached closing or abandoned

/**
 * Context for handoff message
 */
export interface HandoffContext {
  /** Current workflow stage or state */
  currentStage: string;
  
  /** Completed work or blocking fact */
  completedWork: string;
  
  /** Next workflow stage or skill */
  nextStage: string;
  
  /** Condition required to enter next stage */
  entryCondition: string;
}

/**
 * Format a standard handoff message for user-facing output.
 * 
 * All handoffs follow a four-section format:
 * - Current stage: where we are now
 * - Completed / blocker: what's done or what's blocking
 * - Next stage: where we're going next
 * - Entry condition: what must be true to proceed
 * 
 * @param scenario - The handoff scenario type
 * @param context - Contextual information for the handoff
 * @returns Formatted handoff message string
 */
export function formatStandardHandoff(
  scenario: HandoffScenario,
  context: HandoffContext
): string {
  const sections: string[] = [];
  
  // Add scenario type marker
  sections.push(`[Handoff: ${scenario}]`);
  sections.push('');
  
  switch (scenario) {
    case 'normal':
      sections.push(`- Current stage: \`${context.currentStage}\`.`);
      sections.push(`- Completed / blocker: \`${context.completedWork}\`.`);
      sections.push(`- Next stage: \`${context.nextStage}\`.`);
      sections.push(`- Entry condition: \`${context.entryCondition}\`.`);
      break;
      
    case 'blocked':
      sections.push(`- Current stage: \`${context.currentStage}\`.`);
      sections.push(`- Completed / blocker: \`${context.completedWork}\`.`);
      sections.push(`- Next stage: \`${context.nextStage}\`.`);
      sections.push(`- Entry condition: \`${context.entryCondition}\`.`);
      break;
      
    case 'approval-wait':
      sections.push(`- Current stage: \`${context.currentStage}\`.`);
      sections.push(`- Completed / blocker: \`${context.completedWork}\`.`);
      sections.push(`- Next stage: \`${context.nextStage}\`.`);
      sections.push(`- Entry condition: \`${context.entryCondition}\`.`);
      break;
      
    case 'closing-in-progress':
      sections.push(`- Current stage: \`${context.currentStage}\`; release verification or archive work is still running.`);
      sections.push(`- Completed / blocker: \`${context.completedWork}\`.`);
      sections.push(`- Next stage: complete the remaining release or archive step, then transition to \`closing\` (not \`none\`).`);
      sections.push(`- Entry condition: all release and archive work is complete and the transition succeeds.`);
      break;
      
    case 'terminal':
      sections.push(`- Current stage: successfully persisted \`closing\` or \`abandoned\`.`);
      sections.push(`- Completed / blocker: \`${context.completedWork}\`.`);
      sections.push(`- Next stage: \`none\`.`);
      sections.push(`- Entry condition: no further transition exists.`);
      break;
  }
  
  return sections.join('\n');
}
