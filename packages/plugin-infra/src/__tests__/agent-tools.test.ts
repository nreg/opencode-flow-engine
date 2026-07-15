import { describe, it, expect } from 'bun:test';
import { getAgentTools } from '../agents/agent-tools.js';

describe('getAgentTools — OMO injection for IFlow agents', () => {
  it('should inject OMO tools into sFlow when hasOmoPlugin=true', () => {
    const tools = getAgentTools('sFlow', true);
    expect(tools.call_omo_agent).toBe(true);
    expect(tools.task).toBe(true);
  });

  it('should inject OMO tools into iFlow when hasOmoPlugin=true', () => {
    const tools = getAgentTools('iFlow', true);
    expect(tools.call_omo_agent).toBe(true);
    expect(tools.task).toBe(true);
  });

  it('should NOT inject OMO tools into build-executor when hasOmoPlugin=true', () => {
    const tools = getAgentTools('build-executor', true);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should NOT inject OMO tools into iflow-plan-executor when hasOmoPlugin=true', () => {
    const tools = getAgentTools('iflow-plan-executor', true);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should NOT inject OMO tools into iflow-discuss-planner when hasOmoPlugin=true', () => {
    const tools = getAgentTools('iflow-discuss-planner', true);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should NOT inject OMO tools into iflow-verifier when hasOmoPlugin=true', () => {
    const tools = getAgentTools('iflow-verifier', true);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should NOT inject OMO tools into iflow-researcher when hasOmoPlugin=true', () => {
    const tools = getAgentTools('iflow-researcher', true);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should NOT inject OMO tools into iflow-shipper when hasOmoPlugin=true', () => {
    const tools = getAgentTools('iflow-shipper', true);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should NOT inject OMO tools when hasOmoPlugin=false', () => {
    const tools = getAgentTools('iFlow', false);
    expect(tools.call_omo_agent).toBeFalsy();
    expect(tools.task).toBeFalsy();
  });

  it('should preserve base tools when injecting OMO into iFlow', () => {
    const tools = getAgentTools('iFlow', true);
    expect(tools.write).toBe(true);
    expect(tools.edit).toBe(true);
    expect(tools.bash).toBe(true);
    expect(tools.call_flow_agent).toBe(true);
  });

  it('should preserve base tools when hasOmoPlugin=false for iflow-plan-executor', () => {
    const tools = getAgentTools('iflow-plan-executor', false);
    expect(tools.write).toBe(true);
    expect(tools.edit).toBe(true);
    expect(tools.bash).toBe(true);
    expect(tools.call_flow_agent).toBeUndefined();
  });
});
