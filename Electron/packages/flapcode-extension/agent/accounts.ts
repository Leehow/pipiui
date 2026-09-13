/**
 * Flapcode subscription info (plan name + expiry) from the account API.
 *
 * `https://flapcode.com/api/cli/accounts?provider=codex` (Bearer = the same
 * relay API key, live-probed 2026-09) returns the subscription's accounts:
 *   [{ "account_email": "…", "plan_name": "尊享版",
 *      "expires_at": "2026-10-13T09:16:00.000Z" }]
 * There is no "remaining reset count" anywhere in flapcode's model (独享账号
 * plans) — plan name and expiry are the whole subscription surface. Fetched
 * once per agent start and persisted next to the rate-limit snapshot as
 * `{PI_CODING_AGENT_DIR}/flapcode-account.json`; best-effort, never breaks
 * the chat.
 */

import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FLAPCODE_ACCOUNTS_URL = "https://flapcode.com/api/cli/accounts?provider=codex";
export const FLAPCODE_ACCOUNT_FILENAME = "flapcode-account.json";

const ACCOUNTS_TIMEOUT_MS = 10_000;

export type FlapcodeAccountInfo = {
  accountEmail?: string;
  planName?: string;
  /** ISO timestamp as returned by the API, e.g. "2026-10-13T09:16:00.000Z". */
  expiresAt?: string;
};

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Returns the first usable account entry, or undefined on any failure. Never throws. */
export async function fetchFlapcodeAccount(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FlapcodeAccountInfo | undefined> {
  try {
    const res = await fetchImpl(FLAPCODE_ACCOUNTS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(ACCOUNTS_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return undefined;
    for (const item of data) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const expiresAt = cleanString(entry.expires_at);
      const info: FlapcodeAccountInfo = {
        ...(cleanString(entry.account_email) ? { accountEmail: cleanString(entry.account_email) } : {}),
        ...(cleanString(entry.plan_name) ? { planName: cleanString(entry.plan_name) } : {}),
        ...(expiresAt && Number.isFinite(Date.parse(expiresAt)) ? { expiresAt } : {}),
      };
      if (info.accountEmail || info.planName || info.expiresAt) return info;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeFlapcodeAccountSnapshot(info: FlapcodeAccountInfo, now: number): void {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (!agentDir) return;
  const payload = { fetchedAt: now, ...info };
  try {
    const target = join(agentDir, FLAPCODE_ACCOUNT_FILENAME);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload)}\n`);
    renameSync(temporary, target);
  } catch {
    // Best-effort; a failed write must never break the chat.
  }
}
