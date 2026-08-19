import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PADDLEOCR_CONFIG_NAME = "paddleocr.json";
export const PADDLEOCR_TOKEN_FIELD = "aistudioAccessToken";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

export function paddleocrConfigPath(agentDir: string): string {
  return join(agentDir, PADDLEOCR_CONFIG_NAME);
}

export function paddleocrTokenFromConfig(value: unknown): string | undefined {
  const raw = asObject(value)?.[PADDLEOCR_TOKEN_FIELD];
  if (typeof raw !== "string") return undefined;
  const token = raw.trim();
  return token || undefined;
}

export async function readPaddleocrConfig(agentDir: string): Promise<JsonObject> {
  try {
    const parsed = JSON.parse(await readFile(paddleocrConfigPath(agentDir), "utf8"));
    return asObject(parsed) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function readPaddleocrAccessToken(agentDir: string): Promise<string | undefined> {
  return paddleocrTokenFromConfig(await readPaddleocrConfig(agentDir));
}

export async function paddleocrHasKey(agentDir: string): Promise<boolean> {
  return Boolean(await readPaddleocrAccessToken(agentDir));
}

async function writePaddleocrConfigAtomic(agentDir: string, next: JsonObject): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const path = paddleocrConfigPath(agentDir);
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Persist or clear the AI Studio token. Never writes into web-search.json. */
export async function writePaddleocrAccessToken(agentDir: string, token: string | null): Promise<boolean> {
  const current = await readPaddleocrConfig(agentDir);
  const next = { ...current };
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (trimmed) next[PADDLEOCR_TOKEN_FIELD] = trimmed;
  else delete next[PADDLEOCR_TOKEN_FIELD];
  await writePaddleocrConfigAtomic(agentDir, next);
  return Boolean(trimmed);
}

export function paddleocrMcpEnv(token?: string): Record<string, string> {
  const env: Record<string, string> = {
    PADDLEOCR_MCP_MODEL: "PaddleOCR-VL-1.6",
    PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio",
  };
  if (token) env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN = token;
  return env;
}

export const PADDLEOCR_MCP_COMMAND = "uvx";
export const PADDLEOCR_MCP_ARGS = ["--from", "paddleocr-mcp", "paddleocr_mcp"] as const;
