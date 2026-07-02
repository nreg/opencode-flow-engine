import { sharedValidator } from '@opencode-sflow/core';

export interface BuiltinMcpServer {
  name: string;
  description: string;
  call(method: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export function createValidatorMcpServer(): BuiltinMcpServer {
  return {
    name: 'spec-validator',
    description: 'Validate spec artifacts (proposals, specs, contracts, delta specs, implementations)',
    async call(method: string, params: Record<string, unknown>) {
      switch (method) {
        case 'validate-proposal': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: sharedValidator.validateChangeContent('proposal', content) };
        }
        case 'validate-spec': {
          const name = (params.name as string) || 'unnamed';
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: sharedValidator.validateSpecContent(name, content) };
        }
        case 'validate-delta-spec': {
          const content = params.content as string;
          const changeName = (params.changeName as string) || 'unnamed';
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: sharedValidator.validateDeltaSpec(content, changeName) };
        }
        case 'validate-tasks': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: sharedValidator.validateTasks(content) };
        }
        case 'validate-contract': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: sharedValidator.validateExecutionContract(content) };
        }
        case 'validate-design': {
          const content = params.content as string;
          if (!content) return { success: false, error: 'Missing content parameter' };
          return { success: true, data: sharedValidator.validateDesign(content) };
        }
        case 'validate-implementation': {
          const diffSummary = params.diffSummary as string;
          const specContent = params.specContent as string;
          const designContent = (params.designContent as string) || '';
          if (!diffSummary || !specContent) return { success: false, error: 'Missing diffSummary or specContent parameter' };
          return { success: true, data: sharedValidator.validateImplementation(diffSummary, specContent, designContent) };
        }
        case 'detect-sync-conflicts': {
          const deltaSpecs = params.deltaSpecs as Array<{ changeName: string; content: string }>;
          if (!deltaSpecs || !Array.isArray(deltaSpecs)) return { success: false, error: 'Missing deltaSpecs parameter' };
          return { success: true, data: sharedValidator.detectSyncConflicts(deltaSpecs) };
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
