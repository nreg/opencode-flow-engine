import { describe, it, expect } from 'bun:test';
import { getAgentTools } from '../agents/agent-tools.js';

describe('getAgentTools', () => {
  it('should return base tools for sFlow', () => {
    const tools = getAgentTools('sFlow');
    expect(tools.write).toBe(true);
    expect(tools.edit).toBe(true);
    expect(tools.bash).toBe(true);
    expect(tools.call_flow_agent).toBe(true);
  });

  it('should return base tools for build-executor', () => {
    const tools = getAgentTools('build-executor');
    expect(tools.write).toBe(true);
    expect(tools.edit).toBe(true);
    expect(tools.bash).toBe(true);
    expect(tools.call_flow_agent).toBeUndefined();
  });

  it('should not inject call_omo_agent into any agent', () => {
    const tools = getAgentTools('sFlow');
    expect(tools.call_omo_agent).toBeUndefined();
    expect(tools.task).toBeUndefined();
  });

  it('should return common tools for unknown agent', () => {
    const tools = getAgentTools('unknown-agent');
    expect(tools.read).toBe(true);
    expect(tools.glob).toBe(true);
    expect(tools.grep).toBe(true);
  });
});
