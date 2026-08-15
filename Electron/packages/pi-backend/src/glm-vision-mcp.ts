import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveNpmExecutable } from "./managed-npm.js";

/**
 * GLM 会话的附图识图改走智谱官方视觉 MCP (@z_ai/mcp-server, stdio)。替代默认识图模型的
 * visionDescribePlan(描述)路径。失败、无 key、或非 GLM 会话一律回退到既有 describeImages，
 * 优雅降级 —— 任何异常只 resolve undefined，绝不阻塞或打断用户发送。
 *
 * 与 pipiui-glm-search-mcp.ts（streamable-http）共享同一条 key 解析链：环境变量 →
 * <agentDir>/auth.json (zai-coding-cn → zai → glm) → 家目录候选 key 文件。key 永不进入日志。
 */

/** GLM provider ids（与 account-usage-core 的 apiKey() providerIds 对齐）。 */
const GLM_PROVIDERS = new Set(["zai-coding-cn", "zai", "glm"]);
const VISION_MCP_PACKAGE = "@z_ai/mcp-server";
/** 通用识图工具（以运行时 tools/list 返回的真实 schema 为准，优先此名）。 */
const IMAGE_ANALYSIS_TOOL = "image_analysis";

// MCP 协议（照 pipiui-glm-search-mcp.ts 的写法，改为 stdio 行分隔 JSON-RPC）。
const INIT_REQUEST_MS = 15000;
// npx 首次会下载包：给足时长；失败静默回退。
const NPM_CONNECT_TIMEOUT_MS = 120_000;
const TOOLS_LIST_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

const ATTACHMENT_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export type GlmVisionImage = { dataBase64: string; mimeType: string };

export type GlmVisionMcpDeps = {
  /** Real spawn. Packaged Electron tests inject a fake. */
  spawnFn?: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => ChildProcessWithoutNullStreams;
  /** npx executable path. Defaults to the `npx` sibling of the resolved npm. */
  npx?: string;
};

/** 会话主模型 provider 是否属于 GLM 家族。 */
export function isGlmProvider(provider: string): boolean {
  return GLM_PROVIDERS.has(provider.trim().toLowerCase());
}

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  let result = value.trim();
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result || undefined;
};

/**
 * 解析 GLM API key，优先级链与 pipiui-glm-search-mcp.ts / account-usage-core 对齐。
 * @param agentDir Electron 实际 agentDir（默认 ~/.pi/agent）。
 */
export async function resolveGlmApiKey(env: NodeJS.ProcessEnv = process.env, agentDir?: string): Promise<string | undefined> {
  const dir = agentDir ?? join(homedir(), ".pi", "agent");

  // 1. 环境变量。
  for (const name of [
    "Z_AI_API_KEY",
    "ZAI_CODING_CN_API_KEY",
    "BIGMODEL_API_KEY",
    "ZHIPU_API_KEY",
    "ZHIPUAI_API_KEY",
    "ZAI_API_KEY",
    "GLM_API_KEY",
  ]) {
    const value = clean(env[name]);
    if (value) return value;
  }

  // 2. <agentDir>/auth.json — { "<providerId>": { key|access|access_token } }。
  const asObject = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  try {
    const text = await readFile(join(dir, "auth.json"), "utf8");
    const root = asObject(JSON.parse(text));
    for (const id of [...GLM_PROVIDERS]) {
      const entry = asObject(root?.[id]);
      if (!entry) continue;
      for (const key of ["key", "access", "access_token"]) {
        const value = clean(entry[key]);
        if (value) return value;
      }
    }
  } catch {
    // 缺失/不可读 → 落到家目录候选文件。
  }

  // 3. 家目录候选 key 文件（CodexBar 风格），取首个可用行。
  for (const rel of [
    ".coding-relay/glm-api-key",
    ".config/bigmodel/api_key",
    ".config/zhipu/api_key",
  ]) {
    try {
      const text = await readFile(join(homedir(), rel), "utf8");
      const value = clean(text.split(/\r?\n/, 1)[0]);
      if (value) return value;
    } catch {
      // 文件缺失 → 试下一个。
    }
  }

  return undefined;
}

// ─── 运行时行分隔 JSON-RPC 客户端 ─────────────────────────────────────────────
type JsonRpcId = number | string;
type Pending = {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => this.onData(String(chunk)));
    child.stdout.on("error", () => this.failAll(new Error("stdio read error")));
    child.stdin.on("error", () => this.failAll(new Error("stdio write error")));
    child.on("error", err => this.failAll(err));
    child.on("close", () => this.failAll(new Error("mcp process closed")));
  }

  static spawnRuntime(
    npx: string,
    key: string,
    parentEnv: NodeJS.ProcessEnv,
    spawnFn: NonNullable<GlmVisionMcpDeps["spawnFn"]>,
  ): StdioMcpClient {
    const child = spawnFn(npx, ["-y", VISION_MCP_PACKAGE], {
      env: {
        ...parentEnv,
        Z_AI_API_KEY: key,
        Z_AI_MODE: "ZHIPU",
        // 本机 npm 经代理死锁防护（AGENTS.md）；npx 会经它下载包。
        npm_config_maxsockets: "3",
        npm_config_fetch_timeout: "30000",
        PATH: parentEnv.PATH ?? process.env.PATH ?? "",
        HOME: parentEnv.HOME ?? process.env.HOME ?? homedir(),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new StdioMcpClient(child);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error.message ?? "jsonrpc error"));
            else pending.resolve(msg.result);
          }
        }
        if (msg.method === "notifications/message" && msg.params?.level === "error") {
          // MCP server diagnostic — 转发到 stderr，不进会话。忽略即可（优雅降级）。
        }
      } catch {
        // 畸形行忽略。
      }
    }
  }

  private failAll(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (this.closed) return Promise.reject(new Error("mcp closed"));
    const id: JsonRpcId = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(payload + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    try {
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }) + "\n",
      );
    } catch {
      // 通知失败忽略。
    }
  }

  /** stdio MCP 有 shutdown/exit 语义则走，否则 kill；短暂等待后强制 kill。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("mcp closed"));
    }
    this.pending.clear();
    try {
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "shutdown", params: {} }) + "\n");
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/exit" }) + "\n");
    } catch {
      // ignore
    }
    // 关闭 stdin 触发 exit；给短暂宽限后强杀。
    const killer = setTimeout(() => {
      try {
        this.child.stdin.end();
      } catch {
        // ignore
      }
      this.forceKill();
    }, SHUTDOWN_TIMEOUT_MS);
    killer.unref?.();
    // 进程自行退出后确保不泄漏计时器。
    this.child.once("close", () => clearTimeout(killer));
  }

  private forceKill(): void {
    try {
      if (this.child.exitCode === null && !this.child.signalCode) this.child.kill();
    } catch {
      // ignore
    }
  }
}

// ─── schema 驱动的 image_analysis 参数填充 ───────────────────────────────────
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 以真实 tools/list schema 填充 image_analysis 参数：
 *  - 形如路径/文件/图片的字符串参数 → 图片本地临时文件路径；
 *  - 形如 prompt/指令/问题的参数 → 通用识图指令。
 * 图片、prompt 均通过额外 kwargs 兜底（服务端通常接受宽松参数）。返回 undefined 表示
 * 无法填充（schema 形态异常），调用方回退既有路径。
 */
function buildImageAnalysisArgs(
  schema: unknown,
  imagePath: string,
  prompt: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let foundPath = false;
  let foundPrompt = false;
  const root = isObject(schema) && isObject(schema.properties) ? schema.properties : undefined;
  if (root) {
    for (const [name, raw] of Object.entries(root)) {
      const prop = isObject(raw) ? raw : undefined;
      const type = prop?.type;
      if (type !== "string") continue;
      const lower = name.toLowerCase();
      const desc = String(prop?.description ?? "").toLowerCase();
      const looksPath =
        (lower.includes("path") || lower.includes("file") || lower.includes("image")) &&
        !lower.includes("prompt") && !lower.includes("instruction") && !lower.includes("query") &&
        !lower.includes("message") && !lower.includes("text");
      if (looksPath && !foundPath) {
        args[name] = imagePath;
        foundPath = true;
        continue;
      }
      const looksPrompt =
        lower.includes("prompt") || lower.includes("instruction") || lower.includes("query") ||
        lower.includes("question") || lower.includes("message") || lower.includes("text") ||
        desc.includes("prompt") || desc.includes("instruction") || desc.includes("describe");
      if (looksPrompt && !foundPrompt) {
        args[name] = prompt;
        foundPrompt = true;
      }
    }
  }
  // 兜底：schema 没识别出 / 需要更自由字段时，补常见键。
  if (!foundPath) {
    args.image_path = imagePath;
    args.file_path = imagePath;
  }
  if (!foundPrompt) args.prompt = prompt;
  return args;
}

function contentToText(items: unknown[]): string {
  return items
    .map(raw => {
      if (!isObject(raw)) return String(raw);
      if (raw.type === "text") return String(raw.text ?? "");
      if (raw.type === "image") return `[Image: ${String(raw.mimeType ?? "unknown")}]`;
      if (raw.type === "audio") return "[Audio]";
      if (raw.type === "resource" && isObject(raw.resource)) {
        if (raw.resource.text) return String(raw.resource.text);
        return `[Resource: ${String(raw.resource.uri ?? "unknown")}]`;
      }
      return JSON.stringify(raw);
    })
    .filter(Boolean)
    .join("\n");
}

export type DescribeViaGlmMcpOptions = {
  /** 会话主模型的 provider。非 GLM 时外部已分流，这里仍做防御。 */
  provider: string;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  images: GlmVisionImage[];
  userText?: string;
  deps?: GlmVisionMcpDeps;
  signal?: AbortSignal;
};

/**
 * 用智谱官方视觉 MCP 描述一批图片。成功返回描述文本（与 describeImages 语义一致），
 * 任何失败/超时/无 key 均 resolve undefined（优雅降级，调用方回退既有路径）。
 */
export async function describeImagesViaGlmMcp(
  options: DescribeViaGlmMcpOptions,
): Promise<string | undefined> {
  if (!options.images.length || options.signal?.aborted) return undefined;
  if (!isGlmProvider(options.provider)) return undefined;

  const env = options.env ?? process.env;
  const key = await resolveGlmApiKey(env, options.agentDir);
  if (!key) return undefined;

  const deps = options.deps ?? {};
  const spawnFn = deps.spawnFn ?? ((c, a, o) => spawn(c, a, o));
  const npx = deps.npx ?? resolveNpx(env);
  if (!npx) return undefined;

  let tmpDir: string | undefined;
  let client: StdioMcpClient | undefined;
  const onAbort = () => { client?.close(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // 图片落临时文件。
    tmpDir = await mkdtemp(join(tmpdir(), "pipiui-glm-vision-"));
    const paths: string[] = [];
    for (const image of options.images) {
      const ext = ATTACHMENT_EXT[image.mimeType] ?? "png";
      const file = join(tmpDir, `image-${paths.length}.${ext}`);
      await writeFile(file, Buffer.from(image.dataBase64, "base64"));
      paths.push(file);
    }

    client = StdioMcpClient.spawnRuntime(npx, key, env, spawnFn);
    // initialize 握手（npx 首次下载包，给足超时）。
    const initResult = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pipiui-glm-vision-mcp", version: "1.0.0" },
    }, NPM_CONNECT_TIMEOUT_MS);
    if (!isObject(initResult)) return undefined;
    client.notify("notifications/initialized", {});
    const listResult = await client.request("tools/list", {}, TOOLS_LIST_TIMEOUT_MS);
    const tools = isObject(listResult) && Array.isArray(listResult.tools) ? listResult.tools : [];
    const tool = tools.find((t: unknown) => isObject(t) && t.name === IMAGE_ANALYSIS_TOOL);
    if (!isObject(tool)) return undefined;

    const prompt = buildDescribePrompt(options.userText);
    const descriptions: string[] = [];
    for (const file of paths) {
      const args = buildImageAnalysisArgs(tool.inputSchema, file, prompt);
      const callResult = await client.request(
        "tools/call",
        { name: IMAGE_ANALYSIS_TOOL, arguments: args },
        CALL_TIMEOUT_MS,
      );
      const content = isObject(callResult) && Array.isArray(callResult.content) ? callResult.content : [];
      const text = contentToText(content).trim();
      if (callResult?.isError === true) return undefined;
      if (!text) return undefined;
      descriptions.push(text);
    }
    const joined = descriptions.join("\n\n");
    return parseGlmDescription(joined);
  } catch {
    // 除 AbortError 外一律静默回退。
    if (options.signal?.aborted) return undefined;
    return undefined;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    client?.close();
    if (tmpDir) {
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function buildDescribePrompt(userText?: string): string {
  const body = userText?.trim() ? [...userText.trim()].slice(0, 500).join("") : undefined;
  const lines = [
    "Describe each provided image in detail. Rules: use the same language as the user's message; output ONLY the description text, one paragraph per image in attachment order.",
  ];
  if (body) lines.push(`User message:\n"""\n${body}\n"""`);
  return lines.join("\n");
}

/** 接受任意非空文本；对齐既有 parseImageDescription 的防回显原则。 */
function parseGlmDescription(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  return value;
}

function resolveNpx(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // 优先 resolved npm 的兄弟 npx（Finder 启动的 App PATH 很薄）；否则裸 "npx"（PATH 兜底）。
  const npm = resolveNpmExecutable(env);
  if (npm) {
    const sibling = join(dirname(npm), "npx");
    try {
      accessSync(sibling, constants.X_OK);
      return sibling;
    } catch {
      // 无 x 权限 → fall through
    }
  }
  return "npx";
}
