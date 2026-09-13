/**
 * Flapcode quota capture: persist the relay's `x-codex-*` rate-limit response
 * headers so the host quota pill can read them without a probe request.
 *
 * The relay forwards the ChatGPT Codex rate-limit header set on every
 * /responses call (live-probed 2026-09: plan type, primary/secondary window
 * used-percent, window minutes, reset timestamps, credits). There is no
 * standalone usage endpoint, so live-traffic capture is the only source.
 *
 * Mirrors the grok capture in pipiui-xai-server-tools.ts: throttled atomic
 * write into `{PI_CODING_AGENT_DIR}/flapcode-rate-limits.json`, read back by
 * pi-backend quota.ts and parsed by account-usage-core
 * parseFlapcodeRateLimitSnapshot. Best-effort: a failed write must never
 * break the chat.
 */

import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export const FLAPCODE_RATE_LIMITS_FILENAME = "flapcode-rate-limits.json";

const RATE_LIMIT_WRITE_INTERVAL_MS = 30_000;
let lastRateLimitWriteMs = 0;

/** Test seam: reset the throttle between assertions. */
export function resetRateLimitCaptureForTests(): void {
  lastRateLimitWriteMs = 0;
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
}

function numberHeader(headers: Record<string, unknown>, name: string): number | undefined {
  const raw = headerValue(headers, name);
  if (raw === undefined || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function windowSnapshot(headers: Record<string, unknown>, prefix: string) {
  return {
    usedPercent: numberHeader(headers, `x-codex-${prefix}-used-percent`),
    windowMinutes: numberHeader(headers, `x-codex-${prefix}-window-minutes`),
    resetAtSeconds: numberHeader(headers, `x-codex-${prefix}-reset-at`),
  };
}

export function captureFlapcodeRateLimitHeaders(headers: Record<string, unknown> | undefined, now: number): void {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const usedPercent = numberHeader(headers ?? {}, "x-codex-primary-used-percent");
  if (!agentDir || usedPercent === undefined) return;
  if (now - lastRateLimitWriteMs < RATE_LIMIT_WRITE_INTERVAL_MS) return;
  lastRateLimitWriteMs = now;
  const payload = {
    capturedAt: now,
    planType: headerValue(headers ?? {}, "x-codex-plan-type"),
    primary: windowSnapshot(headers ?? {}, "primary"),
    secondary: windowSnapshot(headers ?? {}, "secondary"),
  };
  try {
    const target = join(agentDir, FLAPCODE_RATE_LIMITS_FILENAME);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload)}\n`);
    renameSync(temporary, target);
  } catch {
    // Quota capture is best-effort; a failed write must never break the chat.
  }
}
