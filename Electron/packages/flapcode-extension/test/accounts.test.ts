import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fetchFlapcodeAccount,
  FLAPCODE_ACCOUNT_FILENAME,
  FLAPCODE_ACCOUNTS_URL,
  writeFlapcodeAccountSnapshot,
} from "../agent/accounts.js";

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("flapcode account (subscription) fetch", () => {
  let agentDir: string;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "flapcode-account-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });
  afterEach(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("normalizes the first usable account entry", async () => {
    const seen: Array<{ url: unknown; auth: unknown }> = [];
    const fetchImpl = (async (url: unknown, init: { headers?: Record<string, string> }) => {
      seen.push({ url, auth: init?.headers?.Authorization });
      return {
        ok: true,
        json: async () => [
          { account_email: "leehow9x@hotmail.com", account_uuid: null, plan_name: "尊享版", expires_at: "2026-10-13T09:16:00.000Z" },
        ],
      };
    }) as unknown as typeof fetch;
    const info = await fetchFlapcodeAccount("sk-flapcode-key", fetchImpl);
    expect(info).toEqual({
      accountEmail: "leehow9x@hotmail.com",
      planName: "尊享版",
      expiresAt: "2026-10-13T09:16:00.000Z",
    });
    expect(seen[0]?.url).toBe(FLAPCODE_ACCOUNTS_URL);
    expect(seen[0]?.auth).toBe("Bearer sk-flapcode-key");
  });

  it("drops unusable entries and unparseable expiry dates", async () => {
    await expect(fetchFlapcodeAccount("k", mockFetch([null, "x", { account_uuid: null }]))).resolves.toBeUndefined();
    await expect(
      fetchFlapcodeAccount("k", mockFetch([{ plan_name: "基础版", expires_at: "not a date" }])),
    ).resolves.toEqual({ planName: "基础版" });
  });

  it("returns undefined on HTTP errors, non-array payloads and network failure", async () => {
    await expect(fetchFlapcodeAccount("k", mockFetch({}, false))).resolves.toBeUndefined();
    await expect(fetchFlapcodeAccount("k", mockFetch({ error: true }))).resolves.toBeUndefined();
    await expect(fetchFlapcodeAccount("k", mockFetch([]))).resolves.toBeUndefined();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(fetchFlapcodeAccount("k", failing)).resolves.toBeUndefined();
  });

  it("persists the snapshot next to the rate-limit file", () => {
    writeFlapcodeAccountSnapshot({ planName: "尊享版", expiresAt: "2026-10-13T09:16:00.000Z" }, 1_000_000);
    const written = JSON.parse(readFileSync(join(agentDir, FLAPCODE_ACCOUNT_FILENAME), "utf8"));
    expect(written).toEqual({ fetchedAt: 1_000_000, planName: "尊享版", expiresAt: "2026-10-13T09:16:00.000Z" });
    delete process.env.PI_CODING_AGENT_DIR;
    writeFlapcodeAccountSnapshot({ planName: "尊享版" }, 2_000_000);
    expect(existsSync(join(agentDir, FLAPCODE_ACCOUNT_FILENAME))).toBe(true); // unchanged, no throw
  });
});
