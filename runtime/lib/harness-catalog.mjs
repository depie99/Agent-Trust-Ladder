// Connection profiles only; worker-provider capability is a separate contract.
import path from 'node:path';

export const harnessCatalog = [
  { id: 'generic', name: 'Other harness', initials: '+', file: 'Your harness MCP settings', format: 'standard', note: 'For any harness with local MCP tools. Enter the command and arguments below if it uses a form instead of JSON.' },
  { id: 'claude', name: 'Claude Code', initials: 'Cl', file: '.mcp.json', format: 'standard', native: 'claude', docs: 'https://code.claude.com/docs/en/mcp' },
  { id: 'codex', name: 'Codex', initials: 'Cx', file: '~/.codex/config.toml', format: 'toml', native: 'codex', docs: 'https://developers.openai.com/codex/mcp/' },
  { id: 'cursor', name: 'Cursor', initials: 'Cu', file: '.cursor/mcp.json', format: 'standard', native: 'cursor', docs: 'https://cursor.com/docs/context/mcp' },
  { id: 'deepseek', name: 'DeepSeek DSH', initials: 'Ds', file: 'Native DSH plugin', format: 'native', native: 'deepseek', note: 'Use the DeepSeek bundle through DSH’s plugin manager. This is the DSH harness, not the DeepSeek web chat.' },
  { id: 'gemini', name: 'Gemini CLI', initials: 'Ge', file: '.gemini/settings.json', format: 'standard', native: 'gemini', docs: 'https://geminicli.com/docs/tools/mcp-server/' },
  { id: 'vscode', name: 'VS Code · Copilot', initials: 'Vs', file: '.vscode/mcp.json', format: 'vscode', docs: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration' },
  { id: 'opencode', name: 'OpenCode v2', initials: 'Oc', file: 'opencode.jsonc', format: 'opencode2', docs: 'https://opencode.ai/v2/docs/mcp-servers' },
  { id: 'opencode1', name: 'OpenCode v1', initials: 'O1', file: 'opencode.json', format: 'opencode1', docs: 'https://opencode.ai/docs/mcp-servers/' },
  { id: 'zcode', name: 'ZCode ? Z.ai', initials: 'Zc', file: 'ZCode MCP settings', format: 'standard', native: 'zcode', docs: 'https://zcode.z.ai/en/docs/mcp-services' },
  { id: 'zed', name: 'Zed', initials: 'Zd', file: 'Zed settings.json', format: 'zed', docs: 'https://zed.dev/docs/ai/mcp' },
  { id: 'continue', name: 'Continue', initials: 'Co', file: '.continue/mcpServers/atl.json', format: 'standard', docs: 'https://docs.continue.dev/customize/deep-dives/mcp' },
];

export function connectionProfile(id, bundleRoot, node = process.execPath) {
  const host = harnessCatalog.find(entry => entry.id === id);
  if (!host) throw new Error('Unknown harness. Choose Other harness for a standard MCP connection.');
  const args = [path.join(bundleRoot, 'runtime', 'atl-plugin-mcp.mjs')];
  const server = { command: node, args };
  let config;
  if (host.format === 'native') config = 'Install the deepseek bundle using DSH’s plugin manager. Select @depie99/atl-plugin from its package.json. Then ask: “Start ATL for my current project.”';
  else if (host.format === 'toml') config = `[mcp_servers.atl]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify(args)}\n`;
  else {
    let value = { mcpServers: { atl: server } };
    if (host.format === 'vscode') value = { servers: { atl: { type: 'stdio', ...server } } };
    if (host.format === 'zed') value = { context_servers: { atl: server } };
    if (host.format === 'opencode1') value = { mcp: { atl: { type: 'local', command: [node, ...args], enabled: true } } };
    if (host.format === 'opencode2') value = { mcp: { servers: { atl: { type: 'local', command: [node, ...args] } } } };
    config = JSON.stringify(value, null, 2);
  }
  return { ...host, command: node, args, config, verification: 'Configuration profile; verify tool discovery in your installed harness.', prompt: 'Use ATL for my current application. Read the atl skill, use its absolute workspace path, then call atl_start and open the returned Control Plane URL. Do not start workers yet.' };
}
