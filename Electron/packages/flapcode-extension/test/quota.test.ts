import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import agent from "../agent/index.js";
import {
  captureFlapcodeRateLimitHeaders,
  FLAPCODE_RATE_LIMITS_FILENAME,
  resetRateLimitCaptureForTests,
} from "../agent/quota.js";

const LIVE_HEADERS = {
  "x-codex-plan-type": "pro",
  "x-codex-primary-used-percent": "12",
  "x-codex-primary-window-minutes": "10080",
  "x-codex-primary-reset-at": "1789885922",
  "x-codex-secondary-used-percent": "0",
  "x-codex-secondary-window-minutes": "0",
  "x-codex-secondary-reset-at": "",
};

describe("flapcode quota capture", () => {
  let agentDir: string;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "flapcode-quota-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    resetRateLimitCaptureForTests();
  });
  afterEach(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
    resetRateLimitCaptureForTests();
  });

  const snapshotPath = () => join(agentDir, FLAPCODE_RATE_LIMITS_FILENAME);

  it("persists a normalized snapshot from live x-codex-* headers", () => {
    captureFlapcodeRateLimitHeaders(LIVE_HEADERS, 1_000_000);
    const written = JSON.parse(readFileSync(snapshotPath(), "utf8"));
    expect(written).toEqual({
      capturedAt: 1_000_000,
      planType: "pro",
      primary: { usedPercent: 12, windowMinutes: 10080, resetAtSeconds: 1789885922 },
      secondary: { usedPercent: 0, windowMinutes: 0, resetAtSeconds: undefined },
    });
  });

  it("throttles repeat writes within the interval and keeps the newest numbers after it", () => {
    captureFlapcodeRateLimitHeaders(LIVE_HEADERS, 1_000_000);
    captureFlapcodeRateLimitHeaders({ ...LIVE_HEADERS, "x-codex-primary-used-percent": "55" }, 1_000_100);
    expect(JSON.parse(readFileSync(snapshotPath(), "utf8")).primary.usedPercent).toBe(12);
    captureFlapcodeRateLimitHeaders({ ...LIVE_HEADERS, "x-codex-primary-used-percent": "55" }, 1_031_001);
    expect(JSON.parse(readFileSync(snapshotPath(), "utf8")).primary.usedPercent).toBe(55);
  });

  it("does nothing without the primary header or an agent dir", () => {
    captureFlapcodeRateLimitHeaders({ "x-codex-plan-type": "pro" }, 1_000_000);
    expect(existsSync(snapshotPath())).toBe(false);
    delete process.env.PI_CODING_AGENT_DIR;
    captureFlapcodeRateLimitHeaders(LIVE_HEADERS, 1_000_000);
    expect(existsSync(snapshotPath())).toBe(false);
  });

  it("captures through the after_provider_response hook for flapcode only", () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    agent({
      registerProvider: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        hooks.set(event, handler);
      },
    } as never);
    const handler = hooks.get("after_provider_response");
    expect(handler).toBeTruthy();
    handler!({ headers: LIVE_HEADERS }, { model: { provider: "openai-codex" } });
    expect(existsSync(snapshotPath())).toBe(false);
    handler!({ headers: LIVE_HEADERS }, { model: { provider: "flapcode" } });
    expect(existsSync(snapshotPath())).toBe(true);
  });
});
