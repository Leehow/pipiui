import { promises as fs } from "node:fs";

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
