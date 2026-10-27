import fs from "node:fs";
import path from "node:path";
import { learnLocal, learningStatus, recallLocal } from "./learning.mjs";

const clients = new Map();

export class MemoryError extends Error {}

function configFor(root) {
  const file = path.join(root, "config", "manager.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")).memory || {};
}

function envOrValue(value) {
  if (typeof value !== "string") return value;
  if (value.startsWith("$")) return process.env[value.slice(1)] || "";
  return value;
}

function projectId(root, config) {
  return config.project_id || path.basename(path.resolve(root));
}

function scope(config, root, { agentId = "atl", runId = null } = {}) {
  return {
    userId: projectId(root, config),
    agentId,
    ...(runId ? { runId } : {}),
  };
}

function graphConfig(config) {
  const source = config.mem0 || {};
  const graph = source.graph_store || {};
  const graphStore = {
    provider: graph.provider || "neo4j",
    config: Object.fromEntries(Object.entries(graph.config || {}).map(([key, value]) => [key, envOrValue(value)])),
  };
  if (!graphStore.config.url || !graphStore.config.username || !graphStore.config.password) {
    throw new MemoryError("Mem0 graph memory needs url, username, and password (literal values or $ENV names)");
  }
  return {
    enableGraph: source.enable_graph !== false,
    graphStore,
  };
}

async function createClient(root, config) {
  if (config.provider !== "mem0") return null;
  let mod;
  try {
    mod = await import("mem0ai/oss");
  } catch (err) {
    throw new MemoryError(`Mem0 is configured but the optional mem0ai package is unavailable: ${err.message}`);
  }
  const Memory = mod.Memory || mod.default?.Memory;
  if (!Memory) throw new MemoryError("The installed mem0ai package does not expose Memory from mem0ai/oss");
  return new Memory(graphConfig(config));
}

export async function getMemory(root) {
  const config = configFor(root);
  if (config.provider !== "mem0") return { kind: "disabled", config, client: null };
  if (!clients.has(root)) clients.set(root, createClient(root, config));
  return { kind: "mem0", config, client: await clients.get(root) };
}

export async function memoryStatus(root) {
  const config = configFor(root);
  const local = learningStatus(root);
  if (config.provider !== "mem0") return local;
  try {
    const provider = await getMemory(root);
    return { ...local, graph_provider: "mem0", graph: provider.config.mem0?.enable_graph !== false, available: Boolean(provider.client) };
  } catch (err) {
    return { ...local, graph_provider: "mem0", available: false, error: err.message };
  }
}

export async function remember(root, content, { agentId = "atl", runId = null } = {}) {
  const local = learnLocal(root, { kind: runId ? "outcome" : "lesson", text: content, source: runId ? "verified-run" : "explicit" });
  const provider = await getMemory(root);
  if (!provider.client) return { stored: true, provider: "local", local };
  const result = await provider.client.add([{ role: "user", content }], {
    ...scope(provider.config, root, { agentId, runId }),
    enableGraph: provider.config.mem0?.enable_graph !== false,
  });
  return { stored: true, provider: "local+mem0", local, result };
}

export async function recall(root, query, { agentId = "atl", runId = null, limit = 5 } = {}) {
  const local = recallLocal(root, query, { limit });
  const provider = await getMemory(root);
  if (!provider.client) return local;
  const result = await provider.client.search(query, {
    ...scope(provider.config, root, { agentId, runId }),
    limit,
    enableGraph: provider.config.mem0?.enable_graph !== false,
  });
  return { results: [...local.results, ...(result?.results || [])].slice(0, limit), relations: result?.relations || [], provider: "local+mem0" };
}

export async function safeRemember(root, content, options = {}) {
  try {
    return await remember(root, content, options);
  } catch (err) {
    return { stored: false, provider: "mem0", error: err.message };
  }
}

export async function safeRecall(root, query, options = {}) {
  try {
    return await recall(root, query, options);
  } catch (err) {
    return { results: [], provider: "mem0", error: err.message };
  }
}
