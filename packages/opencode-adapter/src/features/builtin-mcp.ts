import { Validator } from '@opencode-sflow/core';

export interface BuiltinMcpServer {
  name: string;
  description: string;
  call(method: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export function createValidatorMcpServer(): BuiltinMcpServer {
  const validator = new Validator();
  return {
    name: 'spec-validator',
    description: 'Validate spec artifacts (proposals, specs, contracts)',
    async call(method: string, params: Record<string, unknown>) {
      switch (method) {
        case 'validate-proposal': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: validator.validateProposal(content) };
        }
        case 'validate-spec': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: validator.validateSpec(content) };
        }
        case 'validate-delta-spec': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: validator.validateDeltaSpec(content) };
        }
        case 'validate-tasks': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: validator.validateTasks(content) };
        }
        case 'validate-contract': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: validator.validateExecutionContract(content) };
        }
        default:
          return { success: false, error: `Unknown method: ${method}` };
      }
    },
  };
}

export class BuiltinMcpRegistry {
  private servers = new Map<string, BuiltinMcpServer>();

  constructor() {
    const validatorMcp = createValidatorMcpServer();
    this.servers.set(validatorMcp.name, validatorMcp);
  }

  get(name: string): BuiltinMcpServer | undefined {
    return this.servers.get(name);
  }

  register(server: BuiltinMcpServer): void {
    this.servers.set(server.name, server);
  }

  getAll(): BuiltinMcpServer[] {
    return Array.from(this.servers.values());
  }

  call(name: string, method: string, params: Record<string, unknown>) {
    const server = this.servers.get(name);
    if (!server) return { success: false, error: `Built-in MCP server not found: ${name}` };
    return server.call(method, params);
  }
}
