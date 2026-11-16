import { build } from 'esbuild';
import fs from 'node:fs';
// Harness bundles install without npm. Ship the official client and its runtime
// dependencies rather than downloading executable dependencies on first use.
await build({ stdin: { contents: "export { Client } from '@modelcontextprotocol/sdk/client/index.js'; export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';", resolveDir: process.cwd(), sourcefile: 'jira-mcp-sdk-entry.mjs' }, bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, legalComments: 'linked', outfile: 'runtime/assets/jira-mcp-sdk.mjs', banner: { js: "import { createRequire as sdkCreateRequire } from 'node:module'; const require = sdkCreateRequire(import.meta.url);" } });
fs.copyFileSync('node_modules/@modelcontextprotocol/sdk/LICENSE', 'runtime/assets/jira-mcp-sdk.LICENSE');
console.log('Built bundled official MCP client for offline harness installation');
