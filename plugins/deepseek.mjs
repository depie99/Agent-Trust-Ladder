// Native Cordis contribution: tools use the same bridge as the MCP plugins.
// Raw JSON Schema ToolDefinition is part of dsh-tools' public contract;
// validation is owned by plugin-host, so no host package copy is required.
import { createPluginHost, pluginTools } from '../runtime/lib/plugin-host.mjs';
import { registerDeepSeekPanel } from './deepseek-panel.mjs';
import { applyHostIntegrations } from './deepseek-host.mjs';

export const name = 'agent-trust-ladder';
export const inject = ['tools'];
// DSH's enforced schema subset omits numeric/item bounds. The shared host
// still validates those bounds; expose their values as model-facing guidance.
function nativeSchema(node) {
  const { minimum, maximum, minItems, maxItems, ...schema } = node;
  const bounds = Object.entries({ minimum, maximum, minItems, maxItems }).filter(([, value]) => value !== undefined);
  if (bounds.length) schema.description = [schema.description, bounds.map(([key, value]) => `${key}: ${value}`).join(', ')].filter(Boolean).join(' ');
  if (schema.properties) schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, nativeSchema(value)]));
  if (schema.items) schema.items = nativeSchema(schema.items);
  return schema;
}
export function apply(ctx) {
  const host = createPluginHost();
  ctx.effect(() => () => host.close());
  // Optional: CLI-only profiles keep their tools without waiting for a web host.
  ctx.inject?.(['connection'], child => registerDeepSeekPanel(child, host));
  // Host-native surfaces (issue #34): sidebar board tab, slash commands,
  // folder-picker repository flow. Feature-detected; a host without them
  // keeps the tool-only behavior, and a failing registration never breaks
  // tool loading.
  try { applyHostIntegrations(ctx, host); } catch { /* tools remain available */ }
  for (const tool of pluginTools) {
    ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: nativeSchema(tool.inputSchema),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, exec) => host.call(tool.name, args, { signal: exec.signal }),
    });
  }
}
