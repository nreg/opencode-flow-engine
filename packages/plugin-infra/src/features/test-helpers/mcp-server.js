// Simple long-running MCP test server
// Stays alive until killed via SIGTERM/SIGINT
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 60000);
