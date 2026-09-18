import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlapcodeBootstrap } from "../agent/bootstrap.js";
import { FLAPCODE_ACCOUNT_FILENAME } from "../agent/accounts.js";

function stubFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: true,
    json: async () => [{ account_email: "a@b.c", plan_name: "尊享版", expires_at: "2026-10-13T09:16:00.000Z" }],
  })) as unknown as ReturnType<typeof vi.fn>;
}

/** The snapshot fetch is fire-and-forget; drain the microtask/timer queue. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("flapcode bootstrap", () => {
  let agentDir: string;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "flapcode-bootstrap-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("writes the subscription snapshot once for a key handed in directly", async () => {
    const fetchSpy = stubFetch();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const bootstrap = createFlapcodeBootstrap();
    bootstrap.run("sk-flapcode-1");
    bootstrap.run("sk-flapcode-1");
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const snapshot = JSON.parse(readFileSync(join(agentDir, FLAPCODE_ACCOUNT_FILENAME), "utf8"));
    expect(snapshot.planName).toBe("尊享版");
  });

  it("never reaches the stale config control plane", async () => {
    const fetchSpy = stubFetch();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    createFlapcodeBootstrap().run("sk-flapcode-1");
    await settle();
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain("/api/cli/config");
    }
  });

  it("does nothing without a key, staying armed for a later one", async () => {
    const fetchSpy = stubFetch();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const bootstrap = createFlapcodeBootstrap();
    bootstrap.run(undefined);
    bootstrap.run("   ");
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(join(agentDir, FLAPCODE_ACCOUNT_FILENAME))).toBe(false);
    bootstrap.run("sk-flapcode-1");
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves the key lazily when only pi has it (provider login in auth.json)", async () => {
    const fetchSpy = stubFetch();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const bootstrap = createFlapcodeBootstrap();
    const resolve = vi.fn(async () => "sk-flapcode-stored");
    bootstrap.runWith(resolve);
    bootstrap.runWith(resolve);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-arms when the lazy resolution yields no key, and never double-runs after it does", async () => {
    const fetchSpy = stubFetch();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const bootstrap = createFlapcodeBootstrap();
    bootstrap.runWith(async () => undefined);
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();

    bootstrap.runWith(async () => "sk-flapcode-late");
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    bootstrap.runWith(async () => "sk-flapcode-late");
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected resolution and stays armed", async () => {
    const fetchSpy = stubFetch();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const bootstrap = createFlapcodeBootstrap();
    bootstrap.runWith(async () => {
      throw new Error("registry unavailable");
    });
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    bootstrap.runWith(async () => "sk-flapcode-late");
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
