/**
 * MCP Manager - Manages MCP server lifecycle for skills
 * Based on oh-my-openagent's skill-mcp-manager pattern
 */

import type { McpServer } from './skill-loader.js';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { sleep as crossSleep, spawnProcess, isBun } from '@opencode-flow-engine/shared';

/**
 * Allowed executable names for MCP server commands.
 * Only known-safe runtimes and package runners are allowed.
 * Relative paths must start with ./ and resolve to an existing file.
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
    const isAllowedCommand = ALLOWED_MCP_COMMANDS.has(cmdName);
    const isExplicitRelativePath = config.command.startsWith('./') || config.command.startsWith('.\\');
    if (!isAllowedCommand && !isExplicitRelativePath) {
      const instance: McpServerInstance = {
        name,
        command: config.command,
        args: config.args,
        env: config.env,
        state: 'error',
        error: `Command "${cmdName}" not in allowed list and is not a relative path (./...). Allowed: ${[...ALLOWED_MCP_COMMANDS].join(', ')}`,
      };
      this.servers.set(serverKey, instance);
      return instance;
    }

    // For relative paths, verify the resolved path exists as a file
    if (isExplicitRelativePath) {
      try {
        const { access } = await import('fs/promises');
        const { resolve } = await import('path');
        const resolvedPath = resolve(config.command);
        await access(resolvedPath);
      } catch {
        const instance: McpServerInstance = {
          name,
          command: config.command,
          args: config.args,
          env: config.env,
          state: 'error',
          error: `Relative command path does not exist or is not accessible: "${config.command}"`,
        };
        this.servers.set(serverKey, instance);
        return instance;
      }
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
      const procHandle = await spawnProcess(config.command, config.args || [], config.env);

      instance.pid = procHandle.pid;

      const exitedRef = { value: false };
      this.processes.set(serverKey, { proc: procHandle as unknown as import('bun').Subprocess, exited: false });

      // Read initial stdout/stderr to detect startup errors
      const stdoutReader = procHandle.stdout;
      const stderrReader = procHandle.stderr;
      const startupOutput: string[] = [];
      const startupErrors: string[] = [];

      const timeout = options?.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT;
      const deadline = Date.now() + timeout;

      // Check process health during startup window
      while (Date.now() < deadline) {
        if (exitedRef.value) {
          instance.state = 'error';
          instance.error = `Process exited immediately during startup`;
          this.processes.delete(serverKey);
          return instance;
        }

        // Read available stdout/stderr without blocking
        if (stdoutReader) {
          const stdoutResult = await Promise.race([
            stdoutReader.read().catch(() => ({ done: true, value: undefined })),
            crossSleep(50).then(() => ({ done: false, value: undefined })),
          ]);
          if (stdoutResult.value) {
            startupOutput.push(new TextDecoder().decode(stdoutResult.value));
          }
        }

        if (stderrReader) {
          const stderrResult = await Promise.race([
            stderrReader.read().catch(() => ({ done: true, value: undefined })),
            crossSleep(50).then(() => ({ done: false, value: undefined })),
          ]);
          if (stderrResult.value) {
            startupErrors.push(new TextDecoder().decode(stderrResult.value));
          }
        }

        // Check if process is still alive
        if (!exitedRef.value) {
          break;
        }
      }

      // Release readers after startup check
      stdoutReader?.releaseLock();
      stderrReader?.releaseLock();

      if (exitedRef.value) {
        instance.state = 'error';
        instance.error = `Process exited during startup`;
        this.processes.delete(serverKey);
        return instance;
      }

      instance.state = 'running';

      // Monitor process for unexpected exit
      procHandle.exited.then((exitCode) => {
        exitedRef.value = true;
        if (instance.state === 'running') {
          instance.state = 'error';
          instance.error = `Process exited unexpectedly with code ${exitCode}`;
        }
      }).catch(() => {
        exitedRef.value = true;
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
          crossSleep(timeout).then(() => 'timeout' as const),
        ]);

        if (result === 'timeout') {
          // Force kill
          proc.kill(9); // SIGKILL on Unix, TerminateProcess on Windows
          await crossSleep(100);
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

/**
 * Load project-level MCP configurations from .sflow/mcp.json
 * This is Tier 2 in the three-tier MCP system:
 * - Tier 1: Built-in (validation tools)
 * - Tier 2: Project-level (.sflow/mcp.json)
 * - Tier 3: Skill-embedded (from SKILL.md frontmatter)
 */
export async function loadProjectMcpConfig(projectDir?: string): Promise<Record<string, unknown>> {
  const dir = projectDir || process.cwd();
  const configPath = join(dir, '.sflow', 'mcp.json');

  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}
