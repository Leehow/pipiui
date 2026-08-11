import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MemoryBrokerWireResponse } from "./server.ts";

const STATUS_VERSION = 1;

function bounded(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000\r\n]/gu, " ").trim().slice(0, 300);
  return text || undefined;
}

/** Best-effort app-owned status publication. It contains no token/capability. */
export async function publishMemoryBrokerStatus(
  env: Record<string, string | undefined>,
  response: MemoryBrokerWireResponse | undefined,
  error?: unknown,
): Promise<void> {
  const directory = env.PIPIUI_MEMORY_BROKER_STATE_DIR?.trim();
  if (!directory) return;
  const destination = resolve(directory, "status.json");
  const errorText = error instanceof Error ? error.message : error;
  const status = response?.ok && response.status
    ? response.status
    : { ready: false, detail: bounded(errorText) ?? bounded(response?.error) ?? "Memory broker status unavailable." };
  const payload = JSON.stringify({
    version: STATUS_VERSION,
    ready: status.ready,
    // Versioned opaque summaries only; record/lifecycle/admin payloads never cross into the host.
    components: {
      hermes: status.ready ? "ready" : "degraded",
      catalog: status.ready ? "ready" : "degraded",
      retrieval: status.ready ? "ready" : "degraded",
      curator: status.ready ? "ready" : "degraded",
      admin: status.ready ? "ready" : "degraded",
      eval: "ready",
    },
    ...(bounded(status.detail) ? { detail: bounded(status.detail) } : {}),
    ...(error && bounded(errorText) ? { lastError: bounded(errorText) } : {}),
  });
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${payload}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (failure) {
    await unlink(temporary).catch(() => {});
    throw failure;
  }
}
