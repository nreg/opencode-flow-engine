import { describe, it, expect } from 'bun:test';
import { createSFlowAgent, buildWaveOrchestrationConstraints } from './spec-flow.js';
import type { SFlowConfig } from '../../../packages/plugin-infra/src/agents/config-loader.js';

describe('SFlow Agent - Routing Logic (Batch 3)', () => {
  const agent = createSFlowAgent('test-model');
  const instructions = String(agent.instructions);

  describe('Model Tier Rules (Wave 5)', () => {
    it('should contain <Model_Tier_Rules> block in instructions', () => {
      expect(instructions).toContain('<Model_Tier_Rules>');
      expect(instructions).toContain('</Model_Tier_Rules>');
    });

    it('should include all 6 tiers in the tier rules table', () => {
      // Verify all 6 tiers are mentioned in the rules
      expect(instructions).toContain('free');
      expect(instructions).toContain('quick');
      expect(instructions).toContain('standard');
      expect(instructions).toContain('deep');
      expect(instructions).toContain('ultra');
      expect(instructions).toContain('review');
    });

    it('should NOT contain legacy tier names (mechanical, strong)', () => {
      expect(instructions).not.toContain('mechanical');
      expect(instructions).not.toContain('strong');
    });

    it('should have a markdown table with scenario-to-tier mappings', () => {
      // Check for table structure with | separators
      const tablePattern = /\|.*场景.*\|.*model_type.*\|/;
      expect(instructions).toMatch(tablePattern);
    });

    it('should explain call_flow_agent supports optional model_type parameter', () => {
      expect(instructions).toContain('call_flow_agent');
      expect(instructions).toContain('model_type');
      expect(instructions).toMatch(/可选.*model_type|model_type.*可选/);
    });

    it('should map single-line fixes to free tier', () => {
      expect(instructions).toMatch(/单行.*free|free.*单行/);
    });

    it('should map mechanical execution to quick tier', () => {
      expect(instructions).toMatch(/机械.*quick|quick.*机械/);
    });

    it('should map code execution to deep tier', () => {
      expect(instructions).toMatch(/代码执行.*deep|deep.*代码执行/);
    });

    it('should map review tasks to review tier', () => {
      expect(instructions).toMatch(/审查.*review|review.*审查/);
    });
  });

  describe('Workflow State Table', () => {
    it('should have ui-design (frontend only) as state #3 with ui-director subagent', () => {
      // Row 3 should be: | 3 | ui-design (frontend only) | ui-director | ui-design.md | UI tokens validated |
      expect(instructions).toContain('ui-design (frontend only)');
      expect(instructions).toContain('| 3 |');
      // Verify the row contains ui-director as the subagent
      const row3Match = instructions.match(/\|\s*3\s*\|\s*ui-design\s*\(frontend only\)\s*\|\s*ui-director\s*\|/);
      expect(row3Match).not.toBeNull();
    });

    it('should have bridging as state #4 (shifted from #3)', () => {
      // Row 4 should be: | 4 | bridging | contract-builder | execution-contract.md | contract validated |
      const row4Match = instructions.match(/\|\s*4\s*\|\s*bridging\s*\|\s*contract-builder\s*\|/);
      expect(row4Match).not.toBeNull();
    });

    it('should have ui-design.md as artifact for state #3', () => {
      expect(instructions).toContain('ui-design.md');
      const row3Match = instructions.match(/\|\s*3\s*\|[^|]*\|[^|]*\|\s*ui-design\.md\s*\|/);
      expect(row3Match).not.toBeNull();
    });

    it('should have UI tokens validated as gate for state #3', () => {
      const row3Match = instructions.match(/\|\s*3\s*\|[^|]*\|[^|]*\|[^|]*\|\s*UI tokens validated\s*\|/);
      expect(row3Match).not.toBeNull();
    });

    it('should preserve non-frontend routing (states 1,2,5-9 unchanged)', () => {
      // State 1: exploring -> need-explorer
      expect(instructions).toMatch(/\|\s*1\s*\|\s*exploring\s*\|\s*need-explorer\s*\|/);
      // State 2: specifying -> spec-writer
      expect(instructions).toMatch(/\|\s*2\s*\|\s*specifying\s*\|\s*spec-writer\s*\|/);
      // State 5: approved-for-build
      expect(instructions).toMatch(/\|\s*5\s*\|\s*approved-for-build\s*\|/);
      // State 6: executing -> build-executor
      expect(instructions).toMatch(/\|\s*6\s*\|\s*executing\s*\|\s*build-executor\s*\|/);
    });
  });

  describe('Subagent Guide Table', () => {
    it('should include ui-director row in Subagent Guide', () => {
      expect(instructions).toContain('ui-director');
      // Should be in the Subagent Guide table
      const uiDirectorRow = instructions.match(/\|\s*ui-director\s*\|[^|]*\|[^|]*\|/);
      expect(uiDirectorRow).not.toBeNull();
    });

    it('should describe ui-director as for frontend projects after specifying', () => {
      expect(instructions).toContain('Frontend project after specifying');
    });

    it('should describe ui-director role as UI aesthetic decision-making', () => {
      expect(instructions).toContain('UI aesthetic decision-making');
    });

    it('should note ui-director is between specifying and bridging', () => {
      expect(instructions).toContain('between specifying and bridging');
    });
  });

  describe('Delegation Mechanism', () => {
    it('should include frontend project routing explanation after specifying', () => {
      // Should explain that frontend projects route to ui-director after specifying
      expect(instructions).toMatch(/frontend.*specifying.*ui-director|ui-director.*frontend.*specifying/i);
    });

    it('should explain ui-design.md is required before bridging for frontend projects', () => {
      expect(instructions).toMatch(/ui-design\.md.*bridging|bridging.*ui-design\.md/);
    });

    it('should explain non-frontend projects skip ui-design and go directly to bridging', () => {
      expect(instructions).toMatch(/non-frontend|skip.*ui-design|directly.*bridging/i);
    });
  });
});

describe('Wave 2 - Dynamic Prompt Assembly', () => {
  describe('buildWaveOrchestrationConstraints', () => {
    it('should include Constraint 1 (Single Wave) when reviewGate is false', () => {
      const constraints = buildWaveOrchestrationConstraints(false);
      expect(constraints).toContain('Single Wave per build-executor Call');
      expect(constraints).toContain('FORBIDDEN');
      expect(constraints).toContain('Packing multiple Waves');
    });

    it('should include Constraint 6 (Contract Wave Structure) when reviewGate is false', () => {
      const constraints = buildWaveOrchestrationConstraints(false);
      expect(constraints).toContain('Execution Contract Wave Structure');
      expect(constraints).toContain('Wave 1 (Batch 1)');
      expect(constraints).toContain('You MUST execute Waves in the order defined by the contract');
    });

    it('should NOT include Review Gate constraints when reviewGate is false', () => {
      const constraints = buildWaveOrchestrationConstraints(false);
      expect(constraints).not.toContain('Review Gate Between Waves');
      expect(constraints).not.toContain('Cross-Wave Review Responsibility');
      expect(constraints).not.toContain('Wave Completion Tracking');
      expect(constraints).not.toContain('Gate Failure Recovery');
    });

    it('should include all constraints when reviewGate is true', () => {
      const constraints = buildWaveOrchestrationConstraints(true);
      // Constraint 1
      expect(constraints).toContain('Single Wave per build-executor Call');
      // Constraint 2
      expect(constraints).toContain('Review Gate Between Waves');
      expect(constraints).toContain('After each Wave completes, you **MUST** check the Review Gate');
      // Constraint 3
      expect(constraints).toContain('Cross-Wave Review Responsibility');
      expect(constraints).toContain('code-reviewer');
      // Constraint 4
      expect(constraints).toContain('Wave Completion Tracking');
      expect(constraints).toContain('waveStatus');
      // Constraint 5
      expect(constraints).toContain('Gate Failure Recovery');
      expect(constraints).toContain('max retries reached');
      // Constraint 6
      expect(constraints).toContain('Execution Contract Wave Structure');
    });

    it('should return a non-empty string', () => {
      const constraintsFalse = buildWaveOrchestrationConstraints(false);
      const constraintsTrue = buildWaveOrchestrationConstraints(true);
      expect(constraintsFalse.length).toBeGreaterThan(0);
      expect(constraintsTrue.length).toBeGreaterThan(0);
    });

    it('should have more content when reviewGate is true than false', () => {
      const constraintsFalse = buildWaveOrchestrationConstraints(false);
      const constraintsTrue = buildWaveOrchestrationConstraints(true);
      expect(constraintsTrue.length).toBeGreaterThan(constraintsFalse.length);
    });
  });

  describe('createSFlowAgent with config', () => {
    it('should include Review Gate constraints when config.features.reviewGate is true', () => {
      const config: SFlowConfig = {
        features: {
          reviewGate: true,
        },
      };
      const agent = createSFlowAgent('test-model', { config });
      const instructions = String(agent.instructions);
      expect(instructions).toContain('Review Gate Between Waves');
      expect(instructions).toContain('Cross-Wave Review Responsibility');
      expect(instructions).toContain('Wave Completion Tracking');
      expect(instructions).toContain('Gate Failure Recovery');
    });

    it('should NOT include Review Gate constraints when config.features.reviewGate is false', () => {
      const config: SFlowConfig = {
        features: {
          reviewGate: false,
        },
      };
      const agent = createSFlowAgent('test-model', { config });
      const instructions = String(agent.instructions);
      expect(instructions).not.toContain('Review Gate Between Waves');
      expect(instructions).not.toContain('Cross-Wave Review Responsibility');
      expect(instructions).not.toContain('Wave Completion Tracking');
      expect(instructions).not.toContain('Gate Failure Recovery');
    });

    it('should NOT include Review Gate constraints when config is undefined', () => {
      const agent = createSFlowAgent('test-model');
      const instructions = String(agent.instructions);
      expect(instructions).not.toContain('Review Gate Between Waves');
      expect(instructions).not.toContain('Cross-Wave Review Responsibility');
    });

    it('should NOT include Review Gate constraints when config.features is undefined', () => {
      const config: SFlowConfig = {};
      const agent = createSFlowAgent('test-model', { config });
      const instructions = String(agent.instructions);
      expect(instructions).not.toContain('Review Gate Between Waves');
    });

    it('should always include Constraint 1 and Constraint 6 regardless of reviewGate', () => {
      const configWithReview: SFlowConfig = { features: { reviewGate: true } };
      const configWithoutReview: SFlowConfig = { features: { reviewGate: false } };
      
      const agentWithReview = createSFlowAgent('test-model', { config: configWithReview });
      const agentWithoutReview = createSFlowAgent('test-model', { config: configWithoutReview });
      
      const instructionsWithReview = String(agentWithReview.instructions);
      const instructionsWithoutReview = String(agentWithoutReview.instructions);
      
      // Both should have Constraint 1
      expect(instructionsWithReview).toContain('Single Wave per build-executor Call');
      expect(instructionsWithoutReview).toContain('Single Wave per build-executor Call');
      
      // Both should have Constraint 6
      expect(instructionsWithReview).toContain('Execution Contract Wave Structure');
      expect(instructionsWithoutReview).toContain('Execution Contract Wave Structure');
    });
  });
});
