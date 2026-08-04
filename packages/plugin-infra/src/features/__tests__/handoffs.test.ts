import { describe, it, expect } from 'bun:test';
import { formatStandardHandoff, HandoffScenario, HandoffContext } from '../handoffs';

describe('formatStandardHandoff', () => {
  describe('normal scenario', () => {
    it('should format normal handoff with all four sections', () => {
      const context: HandoffContext = {
        currentStage: 'specifying',
        completedWork: 'Generated proposal.md and spec.md',
        nextStage: 'bridging',
        entryCondition: 'User approves the specification artifacts',
      };

      const result = formatStandardHandoff('normal', context);

      expect(result).toContain('Current stage: `specifying`.');
      expect(result).toContain('Completed / blocker: `Generated proposal.md and spec.md`.');
      expect(result).toContain('Next stage: `bridging`.');
      expect(result).toContain('Entry condition: `User approves the specification artifacts`.');
    });

    it('should include scenario type in output', () => {
      const context: HandoffContext = {
        currentStage: 'executing',
        completedWork: 'Task batch 1 completed',
        nextStage: 'executing (batch 2)',
        entryCondition: 'Tests pass for batch 1',
      };

      const result = formatStandardHandoff('normal', context);
      expect(result).toContain('[Handoff: normal]');
    });
  });

  describe('blocked scenario', () => {
    it('should format blocked handoff with blocker detail', () => {
      const context: HandoffContext = {
        currentStage: 'executing',
        completedWork: 'Tests failed: 3 failures in auth module',
        nextStage: 'debugging',
        entryCondition: 'Fix the 3 test failures in auth module',
      };

      const result = formatStandardHandoff('blocked', context);

      expect(result).toContain('Current stage: `executing`.');
      expect(result).toContain('Completed / blocker: `Tests failed: 3 failures in auth module`.');
      expect(result).toContain('Next stage: `debugging`.');
      expect(result).toContain('Entry condition: `Fix the 3 test failures in auth module`.');
      expect(result).toContain('[Handoff: blocked]');
    });
  });

  describe('approval-wait scenario', () => {
    it('should format approval-wait handoff with decision detail', () => {
      const context: HandoffContext = {
        currentStage: 'bridging',
        completedWork: 'Execution contract ready for DP-3 approval',
        nextStage: 'approved-for-build',
        entryCondition: 'User approves execution contract (DP-3)',
      };

      const result = formatStandardHandoff('approval-wait', context);

      expect(result).toContain('Current stage: `bridging`.');
      expect(result).toContain('Completed / blocker: `Execution contract ready for DP-3 approval`.');
      expect(result).toContain('Next stage: `approved-for-build`.');
      expect(result).toContain('Entry condition: `User approves execution contract (DP-3)`.');
      expect(result).toContain('[Handoff: approval-wait]');
    });
  });

  describe('closing-in-progress scenario', () => {
    it('should format closing-in-progress handoff', () => {
      const context: HandoffContext = {
        currentStage: 'executing',
        completedWork: 'Verification complete, archiving artifacts',
        nextStage: 'closing',
        entryCondition: 'All release and archive work complete, transition succeeds',
      };

      const result = formatStandardHandoff('closing-in-progress', context);

      expect(result).toContain('Current stage: `executing`; release verification or archive work is still running.');
      expect(result).toContain('Completed / blocker: `Verification complete, archiving artifacts`.');
      expect(result).toContain('Next stage: complete the remaining release or archive step, then transition to `closing` (not `none`).');
      expect(result).toContain('Entry condition: all release and archive work is complete and the transition succeeds.');
      expect(result).toContain('[Handoff: closing-in-progress]');
    });
  });

  describe('terminal scenario', () => {
    it('should format successful terminal handoff with next stage = none', () => {
      const context: HandoffContext = {
        currentStage: 'closing',
        completedWork: 'Successfully archived all artifacts',
        nextStage: 'none',
        entryCondition: 'No further transition exists',
      };

      const result = formatStandardHandoff('terminal', context);

      expect(result).toContain('Current stage: successfully persisted `closing` or `abandoned`.');
      expect(result).toContain('Completed / blocker: `Successfully archived all artifacts`.');
      expect(result).toContain('Next stage: `none`.');
      expect(result).toContain('Entry condition: no further transition exists.');
      expect(result).toContain('[Handoff: terminal]');
    });

    it('should handle abandoned terminal state', () => {
      const context: HandoffContext = {
        currentStage: 'abandoned',
        completedWork: 'Workflow abandoned by user',
        nextStage: 'none',
        entryCondition: 'No further transition exists',
      };

      const result = formatStandardHandoff('terminal', context);

      expect(result).toContain('Current stage: successfully persisted `closing` or `abandoned`.');
      expect(result).toContain('Next stage: `none`.');
    });
  });

  describe('type safety', () => {
    it('should enforce valid scenario types', () => {
      const validScenarios: HandoffScenario[] = ['normal', 'blocked', 'approval-wait', 'closing-in-progress', 'terminal'];
      
      validScenarios.forEach(scenario => {
        const context: HandoffContext = {
          currentStage: 'test',
          completedWork: 'test',
          nextStage: 'test',
          entryCondition: 'test',
        };
        
        expect(() => formatStandardHandoff(scenario, context)).not.toThrow();
      });
    });

    it('should require all context fields', () => {
      const context: HandoffContext = {
        currentStage: 'specifying',
        completedWork: 'Work done',
        nextStage: 'bridging',
        entryCondition: 'Approval needed',
      };

      const result = formatStandardHandoff('normal', context);
      
      expect(result).toContain('Current stage');
      expect(result).toContain('Completed / blocker');
      expect(result).toContain('Next stage');
      expect(result).toContain('Entry condition');
    });
  });
});
