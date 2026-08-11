import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { AuthType } from "@pipi/host-api";
import type { AuthInteractionLike, AuthRuntimeLike } from "./provider-auth.js";

const execFileAsync = promisify(execFile);
export interface ExternalAuthRuntimeOptions { helperPath: string; piPath: string; agentDir: string; env?: NodeJS.ProcessEnv; nodePath?: string }

function parseDotEnv(source: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const raw of source.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw.trim());
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

export async function modelRuntimeEnvironment(agentDir: string, piPath: string, base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  let overlay: NodeJS.ProcessEnv = {};
  try { overlay = parseDotEnv(await readFile(join(agentDir, ".env"), "utf8")); } catch { /* optional */ }
  return { ...base, ...overlay, PATH: [dirname(piPath), "/opt/homebrew/bin", "/usr/local/bin", base.PATH].filter(Boolean).join(delimiter), PIPIUI_PI_PATH: piPath };
}

async function resolveNode(explicit: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const piSibling = env.PIPIUI_PI_PATH ? join(dirname(env.PIPIUI_PI_PATH), executable) : undefined;
  const currentNode = basename(process.execPath).toLowerCase().startsWith("node") ? process.execPath : undefined;
  const pathNodes = (env.PATH ?? "").split(delimiter).filter(Boolean).map(dir => join(dir, executable));
  for (const candidate of [explicit, env.PIPIUI_NODE_PATH, piSibling, ...pathNodes, "/opt/homebrew/bin/node", "/usr/local/bin/node", currentNode]) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* next */ }
  }
  throw new Error("找不到可运行 Pi ModelRuntime 的 Node.js；请安装 pi CLI/Node.js 或设置 PIPIUI_NODE_PATH");
}

export class ExternalAuthRuntime implements AuthRuntimeLike {
  constructor(private readonly options: ExternalAuthRuntimeOptions) {}
  private async command(command: string, ...args: string[]): Promise<any> {
    const env = await modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env);
    const node = await resolveNode(this.options.nodePath, env);
    try {
      const { stdout } = await execFileAsync(node, [this.options.helperPath, command, ...args], { env, maxBuffer: 4 * 1024 * 1024 });
      const value = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}");
      if (!value.ok) throw new Error(value.error || "helper returned an invalid result");
      return value;
    } catch (error) { throw new Error(`外部 Pi runtime ${command} 失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  async getProviders() { return (await this.command("list-providers")).providers; }
  async getAvailable() { return (await this.command("list-models")).models; }
  async logout(providerId: string) { await this.command("logout", providerId); }
  async login(providerId: string, authType: AuthType, interaction: AuthInteractionLike): Promise<unknown> {
    const env = await modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env);
    const node = await resolveNode(this.options.nodePath, env);
    const child = spawn(node, [this.options.helperPath, "login-json", providerId, authType], { env, stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => child.kill();
    interaction.signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    const lines = createInterface({ input: child.stdout });
    try {
      for await (const line of lines) {
        const event = JSON.parse(line);
        if (event.event === "prompt") child.stdin.write(`${JSON.stringify({ answer: await interaction.prompt(event.prompt) })}\n`);
        else if (event.event === "notify") interaction.notify(event.notification);
        else if (event.ok) return event.result;
        else if (event.error) throw new Error(event.error);
      }
      throw new Error(stderr.trim() || `helper exited with code ${child.exitCode ?? "unknown"}`);
    } finally { interaction.signal?.removeEventListener("abort", abort); lines.close(); child.stdin.end(); }
  }
}
