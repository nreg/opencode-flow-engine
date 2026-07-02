/**
 * MCP Manager - Manages MCP server lifecycle for skills
 * Based on oh-my-openagent's skill-mcp-manager pattern
 */
import type { McpServer } from './skill-loader.js';
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
/**
 * MCP Manager class
 */
export declare class McpManager {
    private servers;
    private sessionServers;
    private processes;
    /**
     * Start an MCP server
     */
    startServer(name: string, config: McpServer, sessionId?: string, options?: {
        startupTimeout?: number;
    }): Promise<McpServerInstance>;
    /**
     * Stop an MCP server
     */
    stopServer(name: string, sessionId?: string, options?: {
        shutdownTimeout?: number;
    }): Promise<boolean>;
    /**
     * Stop all servers for a session
     */
    stopSessionServers(sessionId: string): Promise<void>;
    /**
     * Get server status
     */
    getServerStatus(name: string, sessionId?: string): McpServerInstance | undefined;
    /**
     * Get all servers for a session
     */
    getSessionServers(sessionId: string): McpServerInstance[];
    /**
     * Get all running servers
     */
    getRunningServers(): McpServerInstance[];
    /**
     * Check if server is running
     */
    isServerRunning(name: string, sessionId?: string): boolean;
    /**
     * Get server count
     */
    getServerCount(): {
        total: number;
        running: number;
        stopped: number;
        error: number;
    };
}
/**
 * Create an MCP manager instance
 */
export declare function createMcpManager(): McpManager;
