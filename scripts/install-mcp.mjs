#!/usr/bin/env node
// Registers the BlockForge MCP server: `npm run mcp:install`.
// Uses the Claude Code CLI when it is installed; otherwise prints the config for any MCP client.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'mcp-server.js');
const entry = { blockforge: { command: 'node', args: [server] } };

try {
  execFileSync('claude', ['mcp', 'add', '-s', 'user', 'blockforge', '--', 'node', server], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('\nBlockForge MCP server registered. Start a new session in your MCP client to use it.');
} catch {
  console.log('\nAdd this server to your MCP client configuration ("mcpServers"):\n');
  console.log(JSON.stringify(entry, null, 2));
}
console.log('\nKeep BlockForge running (npm start) with the editor open in your browser.');
