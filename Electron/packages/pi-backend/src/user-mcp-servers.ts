import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export type UserMcpServer = {
  name: string;
  transport: string;
  summary: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandBase(command: string): string {
  const trimmed = command.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function urlSummary(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url.length > 80 ? `${url.slice(0, 77)}…` : url;
  }
}

/** Parse `.pi/mcp.json` shape. Never includes env or secrets. */
export function summarizeMcpServers(json: unknown): UserMcpServer[] {
  if (!isRecord(json) || !isRecord(json.mcpServers)) return [];
  const out: UserMcpServer[] = [];
  for (const [name, spec] of Object.entries(json.mcpServers)) {
    if (!name.trim()) continue;
    const rec = isRecord(spec) ? spec : {};
    const command = typeof rec.command === "string" ? rec.command : "";
    const url = typeof rec.url === "string" ? rec.url : "";
    const declared = typeof rec.transport === "string" ? rec.transport.trim() : "";
    const transport = declared || (url ? "http" : command ? "stdio" : "unknown");
    const args = Array.isArray(rec.args)
      ? rec.args.filter((item): item is string => typeof item === "string").join(" ")
      : "";
    let summary = transport;
    if (command) summary = [commandBase(command), args].filter(Boolean).join(" ");
    else if (url) summary = urlSummary(url);
    out.push({ name, transport, summary });
  }
  return out;
}

export async function readUserMcpServers(mcpJsonPath: string): Promise<UserMcpServer[]> {
  let raw: string;
  try {
    raw = await fs.readFile(mcpJsonPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    return [];
  }
  try {
    return summarizeMcpServers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

const MCP_SERVER_NAME_LIMIT = 128;

export function validateMcpServerName(name: unknown): string {
  if (typeof name !== "string") throw new Error("MCP 名称必须是字符串");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("MCP 名称不能为空");
  if (trimmed.length > MCP_SERVER_NAME_LIMIT) throw new Error("MCP 名称过长（最多 128 字符）");
  return trimmed;
}

export function validateMcpServerSpec(spec: unknown): Record<string, unknown> {
  if (!isRecord(spec)) throw new Error("MCP 配置必须是一个 JSON 对象");
  const hasCommand = typeof spec.command === "string" && spec.command.trim().length > 0;
  const hasUrl = typeof spec.url === "string" && spec.url.trim().length > 0;
  if (!hasCommand && !hasUrl) throw new Error("MCP 配置需要 command（本地进程）或 url（远程服务）");
  return spec;
}

async function readMcpJsonDocument(mcpJsonPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(mcpJsonPath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMcpJsonDocument(mcpJsonPath: string, doc: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dirname(mcpJsonPath), { recursive: true });
  await fs.writeFile(mcpJsonPath, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(mcpJsonPath, 0o600);
}

function mcpServersOf(doc: Record<string, unknown>): Record<string, unknown> {
  const existing = doc.mcpServers;
  if (isRecord(existing)) return existing;
  const created: Record<string, unknown> = {};
  doc.mcpServers = created;
  return created;
}

/** Merge one server entry into `.pi/mcp.json`, keeping every other key and server. */
export async function writeUserMcpServer(mcpJsonPath: string, rawName: unknown, rawSpec: unknown): Promise<UserMcpServer[]> {
  const name = validateMcpServerName(rawName);
  const spec = validateMcpServerSpec(rawSpec);
  const doc = await readMcpJsonDocument(mcpJsonPath);
  if (!isRecord(doc.settings)) doc.settings = { toolPrefix: "mcp" };
  mcpServersOf(doc)[name] = spec;
  await writeMcpJsonDocument(mcpJsonPath, doc);
  return summarizeMcpServers(doc);
}

/** Remove one named server from `.pi/mcp.json`; missing names are a no-op. */
export async function removeUserMcpServer(mcpJsonPath: string, rawName: unknown): Promise<UserMcpServer[]> {
  const name = validateMcpServerName(rawName);
  const doc = await readMcpJsonDocument(mcpJsonPath);
  if (isRecord(doc.mcpServers) && name in doc.mcpServers) {
    delete doc.mcpServers[name];
    await writeMcpJsonDocument(mcpJsonPath, doc);
  }
  return summarizeMcpServers(doc);
}
