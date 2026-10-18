#!/usr/bin/env node
// Registers the BlockForge MCP server with Claude Code (all projects): `npm run mcp:install`
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'mcp-server.js');
const args = ['mcp', 'add', '-s', 'user', 'blockforge', '--', 'node', server];

try {
  execFileSync('claude', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('\n✔ BlockForge MCP server registered. Start a NEW Claude Code session to use it.');
  console.log('  Keep BlockForge running (start.bat / start.sh) with the editor open in your browser.');
} catch {
  console.log('\nCould not run the `claude` CLI. Install Claude Code, or register the server yourself:\n');
  console.log(`  claude mcp add -s user blockforge -- node "${server}"\n`);
  console.log('Claude Desktop: add this to claude_desktop_config.json → "mcpServers":');
  console.log(JSON.stringify({ blockforge: { command: 'node', args: [server] } }, null, 2));
  process.exitCode = 1;
}
