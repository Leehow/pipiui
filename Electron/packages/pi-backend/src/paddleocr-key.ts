import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * TEMPORARY pdf-extension legacy-token adapter (`{projectAgentHome}/paddleocr.json`).
 *
 * The PDF parser lives in the bundled `pdf-extension` package; its secret is managed
 * through project-scoped extension settings (`ext.pdf-extension.aistudioAccessToken`).
 * Because the in-memory vault does not survive backend/App restart, this file is the
 * one canonical DURABLE projection for that single key: the generic channel writes
 * replacements here first (atomic 0600), then mirrors them into the per-run vault
 * cache, and clearing removes the field here plus the vault entry — so neither a
 * replacement nor a clear can revert or resurrect after restart. Read helpers also
 * seed presence/spawn delivery for values saved before this contract existed.
 * `web-search.json` (including its legacy `firecrawlApiKey`) is never read.
 */
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

/**
 * Durable write/clear of the AI Studio token — the TEMPORARY pdf-extension migration
 * adapter. After the cutover the generic extension-settings channel is the only UI,
 * and this file is its one canonical durable projection for `pdf-extension`:
 * saving routes here FIRST (atomic 0600 replace), then into the project vault
 * namespace as a per-run spawn cache; clearing removes the field here AND the vault
 * entry, so neither replacement nor clear can revert when the memory-only vault
 * resets on backend/App restart. Other documents (notably web-search.json with its
 * legacy firecrawlApiKey) are never read or written.
 */
export async function writePaddleocrAccessToken(agentDir: string, token: string | null): Promise<boolean> {
  const current = await readPaddleocrConfig(agentDir);
  const next = { ...current };
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (trimmed) next[PADDLEOCR_TOKEN_FIELD] = trimmed;
  else delete next[PADDLEOCR_TOKEN_FIELD];
  await writePaddleocrConfigAtomic(agentDir, next);
  return Boolean(trimmed);
}
