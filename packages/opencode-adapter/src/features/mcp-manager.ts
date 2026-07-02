/**
 * MCP Manager - Manages MCP server lifecycle for skills
 * Based on oh-my-openagent's skill-mcp-manager pattern
 */

import type { McpServer } from './skill-loader.js';

/**
 * Allowed executable names for MCP server commands.
 * Blocks arbitrary command injection from config files.
 */
const ALLOWED_MCP_COMMANDS = new Set([
  'node', 'bun', 'deno', 'python', 'python3',
  'npx', 'uvx',
]);

/**
 * MCP server state
 */
export type McpServerState = 'stopped' | 'starting' | 'running' | 'error';

/**
 * MCP server instance
 */
export interface McpServerInstance {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  state: McpServerState;
  pid?: number;
  error?: string;
}

const DEFAULT_STARTUP_TIMEOUT = 5000;
const DEFAULT_SHUTDOWN_TIMEOUT = 5000;

/**
 * MCP Manager class
 */
export class McpManager {
  private servers: Map<string, McpServerInstance> = new Map();
  private sessionServers: Map<string, Map<string, McpServerInstance>> = new Map();
  private processes: Map<string, { proc: import('bun').Subprocess; exited: boolean }> = new Map();

  /**
   * Start an MCP server
   */
  async startServer(
    name: string,
    config: McpServer,
    sessionId?: string,
    options?: { startupTimeout?: number }
  ): Promise<McpServerInstance> {
    const serverKey = sessionId ? `${sessionId}:${name}` : name;

    const existing = this.servers.get(serverKey);
    if (existing?.state === 'running') {
      return existing;
    }

    // Validate command against allowlist
    const cmdName = config.command.split(/[/\\]/).pop() || config.command;
    if (!ALLOWED_MCP_COMMANDS.has(cmdName) && !cmdName.startsWith('.')) {
      const instance: McpServerInstance = {
        name,
        command: config.command,
        args: config.args,
        env: config.env,
        state: 'error',
        error: `Command "${cmdName}" not in allowed list and is not a relative path`,
      };
      this.servers.set(serverKey, instance);
      return instance;
    }

    const instance: McpServerInstance = {
      name,
      command: config.command,
      args: config.args,
      env: config.env,
      state: 'starting',
    };

    this.servers.set(serverKey, instance);

    if (sessionId) {
      if (!this.sessionServers.has(sessionId)) {
        this.sessionServers.set(sessionId, new Map());
      }
      this.sessionServers.get(sessionId)!.set(name, instance);
    }

    try {
      const proc = Bun.spawn([config.command, ...(config.args || [])], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      instance.pid = proc.pid;

      const processHandle = { proc, exited: false };
      this.processes.set(serverKey, processHandle);

      const timeout = options?.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT;
      const deadline = Date.now() + timeout;

      // Check process health
      while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
          instance.state = 'error';
          instance.error = `Process exited immediately with code ${proc.exitCode}`;
          this.processes.delete(serverKey);
          return instance;
        }

        // Give the process a moment to settle
        await Bun.sleep(50);
        if (proc.exitCode === null) {
          break;
        }
      }

      if (proc.exitCode !== null) {
        instance.state = 'error';
        instance.error = `Process exited with code ${proc.exitCode}`;
        this.processes.delete(serverKey);
        return instance;
      }

      instance.state = 'running';

      // Monitor process for unexpected exit
      proc.exited.then((exitCode) => {
        processHandle.exited = true;
        if (instance.state === 'running') {
          instance.state = 'error';
          instance.error = `Process exited unexpectedly with code ${exitCode}`;
        }
      }).catch(() => {
        processHandle.exited = true;
      });
    } catch (error) {
      instance.state = 'error';
      instance.error = error instanceof Error ? error.message : String(error);
      this.processes.delete(serverKey);
    }

    return instance;
  }

  /**
   * Stop an MCP server
   */
  async stopServer(
    name: string,
    sessionId?: string,
    options?: { shutdownTimeout?: number }
  ): Promise<boolean> {
    const serverKey = sessionId ? `${sessionId}:${name}` : name;
    const instance = this.servers.get(serverKey);

    if (!instance || instance.state === 'stopped') {
      return false;
    }

    const processEntry = this.processes.get(serverKey);
    if (!processEntry) {
      instance.state = 'stopped';
      instance.pid = undefined;
      if (sessionId) {
        this.sessionServers.get(sessionId)?.delete(name);
      }
      return true;
    }

    try {
      const { proc, exited } = processEntry;

      if (!exited) {
        proc.kill(); // SIGTERM on Unix, TerminateProcess on Windows

        const timeout = options?.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
        const result = await Promise.race([
          proc.exited,
          Bun.sleep(timeout).then(() => 'timeout' as const),
        ]);

        if (result === 'timeout') {
          // Force kill
          proc.kill(9); // SIGKILL on Unix, TerminateProcess on Windows
          await Bun.sleep(100);
        }
      }

      instance.state = 'stopped';
      instance.pid = undefined;

      this.processes.delete(serverKey);

      if (sessionId) {
        this.sessionServers.get(sessionId)?.delete(name);
      }

      return true;
    } catch (error) {
      instance.state = 'error';
      instance.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Stop all servers for a session
   */
  async stopSessionServers(sessionId: string): Promise<void> {
    const sessionServers = this.sessionServers.get(sessionId);
    if (!sessionServers) {
      return;
    }

    for (const [name] of sessionServers) {
      await this.stopServer(name, sessionId);
    }

    this.sessionServers.delete(sessionId);
  }

  /**
   * Get server status
   */
  getServerStatus(name: string, sessionId?: string): McpServerInstance | undefined {
    const serverKey = sessionId ? `${sessionId}:${name}` : name;
    return this.servers.get(serverKey);
  }

  /**
   * Get all servers for a session
   */
  getSessionServers(sessionId: string): McpServerInstance[] {
    const sessionServers = this.sessionServers.get(sessionId);
    if (!sessionServers) {
      return [];
    }
    return Array.from(sessionServers.values());
  }

  /**
   * Get all running servers
   */
  getRunningServers(): McpServerInstance[] {
    return Array.from(this.servers.values()).filter(s => s.state === 'running');
  }

  /**
   * Check if server is running
   */
  isServerRunning(name: string, sessionId?: string): boolean {
    const status = this.getServerStatus(name, sessionId);
    return status?.state === 'running';
  }

  /**
   * Get server count
   */
  getServerCount(): { total: number; running: number; stopped: number; error: number } {
    const servers = Array.from(this.servers.values());
    return {
      total: servers.length,
      running: servers.filter(s => s.state === 'running').length,
      stopped: servers.filter(s => s.state === 'stopped').length,
      error: servers.filter(s => s.state === 'error').length,
    };
  }
}

/**
 * Create an MCP manager instance
 */
export function createMcpManager(): McpManager {
  return new McpManager();
}
