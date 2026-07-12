import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { McpManager, createMcpManager } from './mcp-manager.js';
import type { McpServer } from './skill-loader.js';

const KEEP_ALIVE = '-e';
const KEEP_ALIVE_CODE = 'setInterval(()=>{},60000)';

describe('MCP Manager', () => {
  let manager: McpManager;

  beforeEach(() => {
    manager = createMcpManager();
  });

  afterAll(async () => {
    // Cleanup all running processes
    const running = manager.getRunningServers();
    for (const server of running) {
      await manager.stopServer(server.name);
    }
  });

  describe('startServer', () => {
    it('should start an MCP server', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
        env: { TEST_VAR: 'value' },
      };

      const instance = await manager.startServer('test-server', config);

      expect(instance).toBeDefined();
      expect(instance.name).toBe('test-server');
      expect(instance.command).toBe('node');
      expect(instance.args).toEqual([KEEP_ALIVE, KEEP_ALIVE_CODE]);
      expect(instance.env).toEqual({ TEST_VAR: 'value' });
      expect(instance.state).toBe('running');
      expect(instance.pid).toBeDefined();
      expect(instance.pid).toBeGreaterThan(0);

      await manager.stopServer('test-server');
    });

    it('should not restart already running server', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
      };

      const instance1 = await manager.startServer('test-server', config);
      const instance2 = await manager.startServer('test-server', config);

      expect(instance1).toBe(instance2);

      await manager.stopServer('test-server');
    });

    it('should handle server with session ID', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
      };

      const instance = await manager.startServer('test-server', config, 'session-123');

      expect(instance).toBeDefined();
      expect(instance.state).toBe('running');

      await manager.stopServer('test-server', 'session-123');
    });
  });

  describe('stopServer', () => {
    it('should stop a running server', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
      };

      await manager.startServer('test-server', config);
      const result = await manager.stopServer('test-server');

      expect(result).toBe(true);

      const status = manager.getServerStatus('test-server');
      expect(status?.state).toBe('stopped');
    });

    it('should return false for non-running server', async () => {
      const result = await manager.stopServer('non-existent');
      expect(result).toBe(false);
    });

    it('should stop server with session ID', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
      };

      await manager.startServer('test-server', config, 'session-123');
      const result = await manager.stopServer('test-server', 'session-123');

      expect(result).toBe(true);
    });
  });

  describe('stopSessionServers', () => {
    it('should stop all servers for a session', async () => {
      const config1: McpServer = { name: 'server-1', command: 'node', args: [KEEP_ALIVE, KEEP_ALIVE_CODE] };
      const config2: McpServer = { name: 'server-2', command: 'node', args: [KEEP_ALIVE, KEEP_ALIVE_CODE] };

      await manager.startServer('server-1', config1, 'session-123');
      await manager.startServer('server-2', config2, 'session-123');

      await manager.stopSessionServers('session-123');

      expect(manager.isServerRunning('server-1', 'session-123')).toBe(false);
      expect(manager.isServerRunning('server-2', 'session-123')).toBe(false);
    });

    it('should handle non-existent session', async () => {
      await manager.stopSessionServers('non-existent');
    });
  });

  describe('getServerStatus', () => {
    it('should return server status', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
      };

      await manager.startServer('test-server', config);
      const status = manager.getServerStatus('test-server');

      expect(status).toBeDefined();
      expect(status?.name).toBe('test-server');
      expect(status?.state).toBe('running');

      await manager.stopServer('test-server');
    });

    it('should return undefined for non-existent server', () => {
      const status = manager.getServerStatus('non-existent');
      expect(status).toBeUndefined();
    });

    it('should return status with session ID', async () => {
      const config: McpServer = {
        name: 'test-server',
        command: 'node',
        args: [KEEP_ALIVE, KEEP_ALIVE_CODE],
      };

      await manager.startServer('test-server', config, 'session-123');
      const status = manager.getServerStatus('test-server', 'session-123');

      expect(status).toBeDefined();
      expect(status?.state).toBe('running');

      await manager.stopServer('test-server', 'session-123');
    });
  });

  describe('getSessionServers', () => {
    it('should return all servers for a session', async () => {
      const config1: McpServer = { name: 'server-1', command: 'node' };
      const config2: McpServer = { name: 'server-2', command: 'node' };

      await manager.startServer('server-1', config1, 'session-123');
      await manager.startServer('server-2', config2, 'session-123');

      const servers = manager.getSessionServers('session-123');

      expect(servers).toHaveLength(2);
      expect(servers.map(s => s.name)).toContain('server-1');
      expect(servers.map(s => s.name)).toContain('server-2');
    });

    it('should return empty array for non-existent session', () => {
      const servers = manager.getSessionServers('non-existent');
      expect(servers).toHaveLength(0);
    });
  });

  describe('getRunningServers', () => {
    it('should return all running servers', async () => {
      const config1: McpServer = { name: 'server-1', command: 'node' };
      const config2: McpServer = { name: 'server-2', command: 'node' };

      await manager.startServer('server-1', config1);
      await manager.startServer('server-2', config2);
      await manager.stopServer('server-1');

      const running = manager.getRunningServers();

      expect(running).toHaveLength(1);
      expect(running[0].name).toBe('server-2');
    });

    it('should return empty array when no servers running', () => {
      const running = manager.getRunningServers();
      expect(running).toHaveLength(0);
    });
  });

  describe('isServerRunning', () => {
    it('should return true for running server', async () => {
      const config: McpServer = { name: 'test-server', command: 'node' };
      await manager.startServer('test-server', config);

      expect(manager.isServerRunning('test-server')).toBe(true);
    });

    it('should return false for stopped server', async () => {
      const config: McpServer = { name: 'test-server', command: 'node' };
      await manager.startServer('test-server', config);
      await manager.stopServer('test-server');

      expect(manager.isServerRunning('test-server')).toBe(false);
    });

    it('should return false for non-existent server', () => {
      expect(manager.isServerRunning('non-existent')).toBe(false);
    });

    it('should check server with session ID', async () => {
      const config: McpServer = { name: 'test-server', command: 'node' };
      await manager.startServer('test-server', config, 'session-123');

      expect(manager.isServerRunning('test-server', 'session-123')).toBe(true);
      expect(manager.isServerRunning('test-server', 'other-session')).toBe(false);
    });
  });

  describe('getServerCount', () => {
    it('should return correct count', async () => {
      const config1: McpServer = { name: 'server-1', command: 'node' };
      const config2: McpServer = { name: 'server-2', command: 'node' };

      await manager.startServer('server-1', config1);
      await manager.startServer('server-2', config2);
      await manager.stopServer('server-1');

      const count = manager.getServerCount();

      expect(count.total).toBe(2);
      expect(count.running).toBe(1);
      expect(count.stopped).toBe(1);
      expect(count.error).toBe(0);
    });

    it('should return zero counts when no servers', () => {
      const count = manager.getServerCount();

      expect(count.total).toBe(0);
      expect(count.running).toBe(0);
      expect(count.stopped).toBe(0);
      expect(count.error).toBe(0);
    });
  });
});

describe('Utility Functions', () => {
  describe('createMcpManager', () => {
    it('should create a new manager', () => {
      const manager = createMcpManager();
      expect(manager).toBeDefined();
    });

    it('should create separate instances', () => {
      const manager1 = createMcpManager();
      const manager2 = createMcpManager();
      expect(manager1).not.toBe(manager2);
    });
  });
});
