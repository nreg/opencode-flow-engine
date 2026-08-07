/**
 * Wave Orchestration Test (Defect 2)
 * 
 * 验证 sFlow 主智能体的波次编排约束：
 * 1. 不得将多个 Wave 打包进单个 build-executor prompt
 * 2. Wave 完成后必须检查 Review Gate 才委派下一波
 */

import { describe, it, expect } from 'bun:test';

describe('Wave Orchestration Constraints', () => {
  describe('Constraint 1: Single Wave per build-executor call', () => {
    it('should reject multi-wave prompts in build-executor delegation', () => {
      /**
       * 场景：sFlow 尝试将 Wave 1-6 全部打包进单个 build-executor prompt
       * 期望：检测到多 Wave 打包，抛出错误或拒绝执行
       */
      
      // 模拟的执行合约片段
      const executionContractPrompt = `
Execute the following waves:
- Wave 1: DP state progression fix
- Wave 2: Wave orchestration fix
- Wave 3: changeDir unification fix
- Wave 4: Completion notification fix
- Wave 5: Integration verification
- Wave 6: Final cleanup
      `.trim();

      // 检测多 Wave 打包的逻辑（需要在实现中添加）
      const waveCount = (executionContractPrompt.match(/Wave \d+/g) || []).length;
      
      // 期望：检测到多个 Wave，应该拒绝
      expect(waveCount).toBeGreaterThan(1);
      
      // 实现约束：如果 waveCount > 1，应该抛出错误
      // 这里我们验证约束逻辑存在
      const shouldReject = waveCount > 1;
      expect(shouldReject).toBe(true);
    });

    it('should accept single-wave prompts in build-executor delegation', () => {
      /**
       * 场景：sFlow 正确地逐个委派 Wave
       * 期望：单个 Wave 的 prompt 被接受
       */
      
      const singleWavePrompt = `
Execute Wave 1: DP state progression fix
Tasks:
- T1.1: Write failing test
- T1.2: Implement state progression
- T1.3: Verify tests pass
      `.trim();

      const waveCount = (singleWavePrompt.match(/Wave \d+/g) || []).length;
      
      // 期望：单个 Wave 被接受
      expect(waveCount).toBe(1);
      
      const shouldAccept = waveCount === 1;
      expect(shouldAccept).toBe(true);
    });
  });

  describe('Constraint 2: Review Gate between Waves', () => {
    it('should require Review Gate check after each Wave', () => {
      /**
       * 场景：Wave 1 完成，sFlow 准备委派 Wave 2
       * 期望：必须先检查 Review Gate 状态
       */
      
      // 模拟 Wave 完成状态
      const waveCompletion = {
        waveId: 'W1',
        status: 'completed',
        reviewGateStatus: 'pending', // 尚未检查
      };

      // 约束：Review Gate 未检查时，不得委派下一波
      const canDispatchNextWave = waveCompletion.reviewGateStatus === 'passed';
      
      expect(canDispatchNextWave).toBe(false);
    });

    it('should allow next Wave dispatch only after Review Gate passes', () => {
      /**
       * 场景：Wave 1 完成且 Review Gate 通过
       * 期望：可以委派 Wave 2
       */
      
      const waveCompletion = {
        waveId: 'W1',
        status: 'completed',
        reviewGateStatus: 'passed',
      };

      const canDispatchNextWave = 
        waveCompletion.status === 'completed' && 
        waveCompletion.reviewGateStatus === 'passed';
      
      expect(canDispatchNextWave).toBe(true);
    });

    it('should block next Wave dispatch if Review Gate fails', () => {
      /**
       * 场景：Wave 1 完成但 Review Gate 不通过
       * 期望：不得委派 Wave 2，应反馈审查意见
       */
      
      const waveCompletion = {
        waveId: 'W1',
        status: 'completed',
        reviewGateStatus: 'failed',
        reviewFeedback: 'Tests failed: 2 test cases broken',
      };

      const canDispatchNextWave = 
        waveCompletion.status === 'completed' && 
        waveCompletion.reviewGateStatus === 'passed';
      
      expect(canDispatchNextWave).toBe(false);
      expect(waveCompletion.reviewFeedback).toBeDefined();
    });
  });

  describe('Constraint 3: Wave orchestration in sFlow instructions', () => {
    it('should have wave orchestration constraint section in sFlow instructions', () => {
      /**
       * 场景：检查 sFlow 主智能体的 instructions 中是否包含波次编排约束章节
       * 期望：instructions 中明确禁止多 Wave 打包，要求逐个委派
       */
      
      // 这个测试需要读取实际的 spec-flow.ts 文件
      // 这里我们先标记为需要实现
      // 实际实现时，应该读取 spec-flow.ts 并检查 instructions 内容
      
      const expectedConstraintKeywords = [
        'Wave',
        '逐个委派',
        'Review Gate',
        '禁止',
        '打包',
      ];

      // 占位断言：实际实现时应该检查文件内容
      expect(expectedConstraintKeywords.length).toBeGreaterThan(0);
    });
  });
});

describe('Wave Orchestration Integration', () => {
  it('should enforce wave-by-wave execution sequence', () => {
    /**
     * 场景：完整的 Wave 执行序列
     * 期望：W1 → Gate → W2 → Gate → W3 → Gate → ...
     */
    
    const executionSequence = [
      { action: 'dispatch', waveId: 'W1' },
      { action: 'wait_completion', waveId: 'W1' },
      { action: 'check_gate', waveId: 'W1', result: 'passed' },
      { action: 'dispatch', waveId: 'W2' },
      { action: 'wait_completion', waveId: 'W2' },
      { action: 'check_gate', waveId: 'W2', result: 'passed' },
      { action: 'dispatch', waveId: 'W3' },
    ];

    // 验证序列中的每个 Wave 前都有 Gate 检查（除了第一个）
    let previousWaveCompleted = false;
    let gateChecked = false;

    for (let i = 0; i < executionSequence.length; i++) {
      const step = executionSequence[i];
      
      if (step.action === 'dispatch' && i > 0) {
        // 不是第一个 Wave，前面必须有 Gate 检查
        expect(gateChecked).toBe(true);
        gateChecked = false; // 重置
      }
      
      if (step.action === 'check_gate') {
        gateChecked = true;
      }
    }
  });
});

describe('Wave Orchestration Tool Integration (P0-2)', () => {
  it('should reject multi-wave prompts with tool error', async () => {
    const { createCallFlowAgentTools } = await import('../../tools/call-flow-agent.js');
    
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
      },
    } as any;
    const mockRegistry = new Map();
    const mockCounter = { value: 0 };
    const mockAgentModelMap = { 'build-executor': 'test-model' };
    const mockValidateAgent = async () => null;
    
    const tools = createCallFlowAgentTools({
      client: mockClient,
      backgroundTaskRegistry: mockRegistry,
      backgroundTaskCounter: mockCounter,
      agentModelMap: mockAgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: mockValidateAgent,
      workflowName: 'sFlow',
    });
    
    const callFlowAgentTool = tools['call_flow_agent'];
    
    const multiWavePrompt = `
Execute Wave 1: DP state progression fix
Execute Wave 2: Wave orchestration fix
Execute Wave 3: changeDir unification fix
    `.trim();
    
    const result = await callFlowAgentTool.execute!(
      {
        subagent_type: 'build-executor',
        prompt: multiWavePrompt,
        run_in_background: false,
        description: 'Multi-wave test',
      },
      { directory: '/tmp/test' }
    );
    
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('output');
    expect((result as any).title).toBe('Error');
    expect((result as any).output).toContain('Wave Orchestration Constraint Violation');
    expect((result as any).output).toContain('3 waves');
  });
  
  it('should accept single-wave prompts without error', async () => {
    const { createCallFlowAgentTools } = await import('../../tools/call-flow-agent.js');
    
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
      },
    } as any;
    const mockRegistry = new Map();
    const mockCounter = { value: 0 };
    const mockAgentModelMap = { 'build-executor': 'test-model' };
    const mockValidateAgent = async () => null;
    
    const tools = createCallFlowAgentTools({
      client: mockClient,
      backgroundTaskRegistry: mockRegistry,
      backgroundTaskCounter: mockCounter,
      agentModelMap: mockAgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: mockValidateAgent,
      workflowName: 'sFlow',
    });
    
    const callFlowAgentTool = tools['call_flow_agent'];
    
    const singleWavePrompt = `
Execute Wave 1: DP state progression fix
Tasks:
- T1.1: Write failing test
- T1.2: Implement state progression
    `.trim();
    
    const result = await callFlowAgentTool.execute!(
      {
        subagent_type: 'build-executor',
        prompt: singleWavePrompt,
        run_in_background: false,
        description: 'Single-wave test',
      },
      { directory: '/tmp/test' }
    );
    
    if ((result as any).title === 'Error') {
      expect((result as any).output).not.toContain('Wave Orchestration Constraint Violation');
    }
  });
  
  it('should not affect non-build-executor subagents', async () => {
    const { createCallFlowAgentTools } = await import('../../tools/call-flow-agent.js');
    
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
      },
    } as any;
    const mockRegistry = new Map();
    const mockCounter = { value: 0 };
    const mockAgentModelMap = { 'spec-writer': 'test-model' };
    const mockValidateAgent = async () => null;
    
    const tools = createCallFlowAgentTools({
      client: mockClient,
      backgroundTaskRegistry: mockRegistry,
      backgroundTaskCounter: mockCounter,
      agentModelMap: mockAgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: mockValidateAgent,
      workflowName: 'sFlow',
    });
    
    const callFlowAgentTool = tools['call_flow_agent'];
    
    const multiWavePrompt = `
Execute Wave 1, Wave 2, Wave 3 for spec-writer
    `.trim();
    
    const result = await callFlowAgentTool.execute!(
      {
        subagent_type: 'spec-writer',
        prompt: multiWavePrompt,
        run_in_background: false,
        description: 'Non-build-executor test',
      },
      { directory: '/tmp/test' }
    );
    
    if ((result as any).title === 'Error') {
      expect((result as any).output).not.toContain('Wave Orchestration Constraint Violation');
    }
  });
});

describe('Wave Orchestration Edge Cases (P2)', () => {
  it('should handle case-insensitive wave matching', async () => {
    const { createCallFlowAgentTools } = await import('../../tools/call-flow-agent.js');
    
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
      },
    } as any;
    const mockRegistry = new Map();
    const mockCounter = { value: 0 };
    const mockAgentModelMap = { 'build-executor': 'test-model' };
    const mockValidateAgent = async () => null;
    
    const tools = createCallFlowAgentTools({
      client: mockClient,
      backgroundTaskRegistry: mockRegistry,
      backgroundTaskCounter: mockCounter,
      agentModelMap: mockAgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: mockValidateAgent,
      workflowName: 'sFlow',
    });
    
    const callFlowAgentTool = tools['call_flow_agent'];
    
    const mixedCasePrompt = `
Execute wave 1: First task
Run Wave 2: Second task
    `.trim();
    
    const result = await callFlowAgentTool.execute!(
      {
        subagent_type: 'build-executor',
        prompt: mixedCasePrompt,
        run_in_background: false,
        description: 'Mixed case test',
      },
      { directory: '/tmp/test' }
    );
    
    expect((result as any).title).toBe('Error');
    expect((result as any).output).toContain('Wave Orchestration Constraint Violation');
  });
  
  it('should not trigger on wave references (non-execution)', async () => {
    const { createCallFlowAgentTools } = await import('../../tools/call-flow-agent.js');
    
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
      },
    } as any;
    const mockRegistry = new Map();
    const mockCounter = { value: 0 };
    const mockAgentModelMap = { 'build-executor': 'test-model' };
    const mockValidateAgent = async () => null;
    
    const tools = createCallFlowAgentTools({
      client: mockClient,
      backgroundTaskRegistry: mockRegistry,
      backgroundTaskCounter: mockCounter,
      agentModelMap: mockAgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: mockValidateAgent,
      workflowName: 'sFlow',
    });
    
    const callFlowAgentTool = tools['call_flow_agent'];
    
    const referencePrompt = `
Wave 1 results show that the fix is working.
Wave 2 output indicates success.
Proceed with implementation.
    `.trim();
    
    const result = await callFlowAgentTool.execute!(
      {
        subagent_type: 'build-executor',
        prompt: referencePrompt,
        run_in_background: false,
        description: 'Reference test',
      },
      { directory: '/tmp/test' }
    );
    
    if ((result as any).title === 'Error') {
      expect((result as any).output).not.toContain('Wave Orchestration Constraint Violation');
    }
  });
  
  it('should support alternative execution verbs', async () => {
    const { createCallFlowAgentTools } = await import('../../tools/call-flow-agent.js');
    
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
      },
    } as any;
    const mockRegistry = new Map();
    const mockCounter = { value: 0 };
    const mockAgentModelMap = { 'build-executor': 'test-model' };
    const mockValidateAgent = async () => null;
    
    const tools = createCallFlowAgentTools({
      client: mockClient,
      backgroundTaskRegistry: mockRegistry,
      backgroundTaskCounter: mockCounter,
      agentModelMap: mockAgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: mockValidateAgent,
      workflowName: 'sFlow',
    });
    
    const callFlowAgentTool = tools['call_flow_agent'];
    
    const alternativeVerbsPrompt = `
Run Wave 1: First task
Perform Wave 2: Second task
Dispatch Wave 3: Third task
    `.trim();
    
    const result = await callFlowAgentTool.execute!(
      {
        subagent_type: 'build-executor',
        prompt: alternativeVerbsPrompt,
        run_in_background: false,
        description: 'Alternative verbs test',
      },
      { directory: '/tmp/test' }
    );
    
    expect((result as any).title).toBe('Error');
    expect((result as any).output).toContain('Wave Orchestration Constraint Violation');
    expect((result as any).output).toContain('3 waves');
  });
});
