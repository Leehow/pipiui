import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_USAGE_STALE_AFTER_MS,
  AccountUsageMonitor,
  AccountUsageRegistry,
  builtinAccountUsageAdapters,
  createQoderAdapter,
  openCodeGoWindows,
  parseClaudeWindows,
  parseCodexWindows,
  parseDeepSeekBalance,
  parseGlmWindows,
  parseGrokWindows,
  parseKimiWindows,
  parseMoonshotBalance,
  parseOpenRouterBalance,
  parseQoderWindows,
  parseQwenWindows,
  parseSiliconFlowBalance,
  type AccountUsageAdapter,
} from "../src/index.js";

const response = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("provider parsers", () => {
  it("normalizes Codex, Claude, GLM and Kimi subscription windows", () => {
    expect(parseCodexWindows({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 }, secondary_window: { used_percent: 20, limit_window_seconds: 604800 } } }).map(w => [w.label, w.usedPercent])).toEqual([["5h", 10], ["周", 20]]);
    expect(parseClaudeWindows({ five_hour: { utilization: 16, resets_at: "2026-08-14T00:00:00Z" }, seven_day: { utilization: "40" } }).map(w => w.usedPercent)).toEqual([16, 40]);
    expect(parseGlmWindows({ success: true, data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, usage: 1000, remaining: 700, nextResetTime: 1_800_000_000_000 }] } })[0]).toMatchObject({ label: "5h", usedPercent: 30 });
    expect(parseKimiWindows({ usage: { limit: "100", used: "20" }, limits: [{ detail: { limit: 50, remaining: 40 } }] }).map(w => w.usedPercent)).toEqual([20, 20]);
  });

  it("normalizes Qoder, Qwen and every prepaid balance", () => {
    expect(parseQoderWindows({ userQuota: { used: 10, total: 100 }, addOnQuota: { used: 5, total: 50 }, totalUsagePercentage: 0.1 })[0].usedPercent).toBe(10);
    expect(parseQwenWindows({ data: { DataV2: { data: { data: { per5HourPercentage: 0.25, per1WeekPercentage: 0.5 } } } } }).map(w => w.usedPercent)).toEqual([25, 50]);
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [{ total_balance: "12.5", currency: "usd" }] })).toEqual({ amount: 12.5, currency: "USD" });
    expect(parseMoonshotBalance({ code: 0, data: { available_balance: "20" } })).toEqual({ amount: 20, currency: "CNY" });
    expect(parseSiliconFlowBalance({ data: { totalBalance: 30 } })).toEqual({ amount: 30, currency: "CNY" });
    expect(parseOpenRouterBalance({ data: { total_credits: 50, total_usage: 12.5 } })).toEqual({ amount: 37.5, currency: "USD" });
  });

  it("computes OpenCode Go local-only windows", () => {
    const now = Date.UTC(2026, 7, 13, 12);
    const windows = openCodeGoWindows([{ createdMs: now - 60_000, cost: 6 }], now);
    expect(windows.map(w => w.usedPercent)).toEqual([50, 20, 10]);
    expect(windows.map(w => w.title)).toEqual(["5小时本机用量", "周本机用量", "月本机用量"]);
  });

  it("isolates Grok's protobuf parser", () => {
    const payload = new Uint8Array(7);
    payload[0] = 0x0d;
    new DataView(payload.buffer).setFloat32(1, 25, true);
    payload[5] = 0x10; payload[6] = 0x01;
    expect(parseGrokWindows(payload)[0]).toMatchObject({ usedPercent: 25, title: "额度" });
  });

  it("selects Grok's shortest field-1 percent across data frames and ignores trailers", () => {
    const nested = new Uint8Array(7);
    nested[0] = 0x12; nested[1] = 5; nested[2] = 0x0d;
    new DataView(nested.buffer).setFloat32(3, 99, true);
    const account = new Uint8Array(5); account[0] = 0x0d;
    new DataView(account.buffer).setFloat32(1, 27, true);
    const frame = (flags: number, payload: Uint8Array) => {
      const value = new Uint8Array(5 + payload.length); value[0] = flags;
      new DataView(value.buffer).setUint32(1, payload.length, false); value.set(payload, 5); return value;
    };
    const trailer = new TextEncoder().encode("grpc-status: 0\r\n");
    const input = new Uint8Array(frame(0, nested).length + frame(0, account).length + frame(0x80, trailer).length);
    let offset = 0; for (const value of [frame(0, nested), frame(0, account), frame(0x80, trailer)]) { input.set(value, offset); offset += value.length; }
    expect(parseGrokWindows(input)[0]).toMatchObject({ usedPercent: 27, title: "额度" });
  });

  it("returns stable empty values for malformed provider payloads", () => {
    expect(parseCodexWindows(null)).toEqual([]);
    expect(parseClaudeWindows({ five_hour: { utilization: "bad" } })).toEqual([]);
    expect(parseGlmWindows({ success: false })).toEqual([]);
    expect(parseKimiWindows({})).toEqual([]);
    expect(parseDeepSeekBalance({ balance_infos: [] })).toBeUndefined();
  });
});

describe("Qoder token resolution", () => {
  const now = Date.UTC(2026, 7, 13, 12);
  const usage = { userQuota: { used: 25, total: 100 }, totalUsagePercentage: 0.25 };
  const monitor = (auth: unknown, fetcher: typeof fetch) => new AccountUsageMonitor(
    { fetch: fetcher, now: () => now, readAuth: async store => store === "pi" ? auth : undefined },
    new AccountUsageRegistry([createQoderAdapter()]),
  );

  it("uses a stored access token when it is valid beyond the five-minute buffer", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer access-valid");
      return response(usage);
    }) as unknown as typeof fetch;
    const result = await monitor({ "qoder-cn": { access: "access-valid", expires: now + 6 * 60_000 } }, fetcher).snapshot("qoder-cn", true);
    expect(result.status).toBe("ready"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("exchanges the PAT when stored access is expired and keeps the new token in memory", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/jobToken/exchange")) {
        expect(url).toContain("openapi.qoder.com.cn");
        expect(JSON.parse(String(init?.body))).toEqual({ personal_token: "pat-secret" });
        return response({ token: "fresh-job", expires_in: 86_400_000 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fresh-job");
      return response(usage);
    }) as unknown as typeof fetch;
    const store = monitor({ "qoder-cn": { access: "expired", expires: now - 1, refresh: "pat|pat-secret|jrt|uid|mid" } }, fetcher);
    expect((await store.snapshot("qoder-cn", true)).status).toBe("ready");
    expect((await store.snapshot("qoder-cn", true)).status).toBe("ready");
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("jobToken/exchange"))).toHaveLength(1);
  });

  it("does one PAT exchange and one retry after quota returns unauthorized", async () => {
    let usageCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("jobToken/exchange")) return response({ token: "retry-job", expires_at: "2026-08-14T12:00:00Z" });
      usageCalls++;
      if (usageCalls === 1) return response({}, 403);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer retry-job");
      return response(usage);
    }) as unknown as typeof fetch;
    const result = await monitor({ qoder: { access: "revoked", expires: now + 60 * 60_000, refresh: "pat|retry-pat|jrt" } }, fetcher).snapshot("qoder", true);
    expect(result.status).toBe("ready"); expect(usageCalls).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("jobToken/exchange"))).toHaveLength(1);
  });

  it("returns no data with neither usable access nor PAT", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(monitor({ qoder: { expires: now - 1 } }, fetcher).snapshot("qoder")).resolves.toEqual({ status: "no-data", reason: "missing-credential" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose access or PAT secrets in bounded retry errors", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("jobToken/exchange") ? response({}, 500) : response({}, 401)) as unknown as typeof fetch;
    const result = await monitor({ qoder: { access: "access-secret", refresh: "pat|pat-secret|jrt" } }, fetcher).snapshot("qoder", true);
    expect(result).toMatchObject({ status: "error", code: "http", detail: "HTTP 401" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("registry routing", () => {
  const registry = new AccountUsageRegistry();
  it("routes every built-in provider and excludes relays/near misses", () => {
    expect(registry.resolve("openai-codex")?.id).toBe("codex");
    expect(registry.resolve("xai")?.id).toBe("grok");
    expect(registry.resolve("anthropic")?.id).toBe("claude");
    expect(registry.resolve("zai-coding-cn")?.id).toBe("glm");
    expect(registry.resolve("kimi-coding")?.id).toBe("kimi");
    expect(registry.resolve("qoder-cn")?.id).toBe("qoder");
    expect(registry.resolve("qwen-token-plan-cn")?.id).toBe("qwenTokenPlan");
    expect(registry.resolve("opencode-go")?.id).toBe("opencodeGo");
    expect(registry.resolve("deepseek")?.id).toBe("deepseek");
    expect(registry.resolve("moonshotai")?.id).toBe("moonshot");
    expect(registry.resolve("siliconflow")?.id).toBe("siliconflow");
    expect(registry.resolve("openrouter")?.id).toBe("openrouter");
    expect(registry.resolve("qwen-vl")).toBeUndefined();
    expect(registry.resolve("deepseek-relay")).toBeUndefined();
  });

  it("prioritizes subscription quota over prepaid balance", () => {
    const quota: AccountUsageAdapter = { id: "quota", kind: "subscription", matches: () => true, load: async () => undefined };
    const balance: AccountUsageAdapter = { id: "balance", kind: "prepaid", priority: 100, matches: () => true, load: async () => undefined };
    expect(new AccountUsageRegistry([balance, quota]).resolve("same")?.id).toBe("quota");
  });
});

describe("built-in adapters", () => {
  const pi = {
    "openai-codex": { type: "oauth", access: "codex-token" },
    anthropic: { type: "oauth", access: "claude-token" },
    "zai-coding-cn": { type: "api_key", key: "glm-token" },
    "kimi-coding": { type: "api_key", key: "kimi-token" },
    "qoder-cn": { type: "oauth", access: "qoder-token" },
    deepseek: { type: "api_key", key: "deepseek-token" },
    moonshot: { type: "api_key", key: "moonshot-token" },
    siliconflow: { type: "api_key", key: "sf-token" },
    openrouter: { type: "api_key", key: "or-token" },
  };
  const bodies: Array<[string, unknown]> = [
    ["wham/usage", { rate_limit: { primary_window: { used_percent: 11, limit_window_seconds: 18000 } } }],
    ["anthropic.com", { five_hour: { utilization: 12 } }],
    ["monitor/usage", { success: true, data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, usage: 100, remaining: 87 }] } }],
    ["kimi.com/coding", { usage: { limit: 100, used: 14 } }],
    ["qoder.com.cn", { userQuota: { used: 15, total: 100 }, totalUsagePercentage: 0.15 }],
    ["bailian-cs", { data: { DataV2: { data: { data: { per5HourPercentage: 0.16, per1WeekPercentage: 0.17 } } } } }],
    ["deepseek.com", { is_available: true, balance_infos: [{ total_balance: 18, currency: "CNY" }] }],
    ["moonshot.cn", { code: 0, data: { available_balance: 19 } }],
    ["siliconflow.cn", { data: { totalBalance: 20 } }],
    ["openrouter.ai", { data: { total_credits: 30, total_usage: 9 } }],
  ];
  const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("grok.com")) {
      const payload = new Uint8Array(5); payload[0] = 0x0d; new DataView(payload.buffer).setFloat32(1, 22, true);
      return new Response(payload);
    }
    const match = bodies.find(([needle]) => url.includes(needle));
    if (!match) throw new Error(`unexpected URL ${url}`);
    return response(match[1]);
  }) as unknown as typeof fetch;
  const monitor = new AccountUsageMonitor({
    fetch: fakeFetch,
    env: { OPENCODE_API_KEY: "go-key" },
    readAuth: async store => store === "pi" ? pi : store === "codex" ? { tokens: { access_token: "codex-token" } } : store === "grok" ? { "https://auth.x.ai::account": { key: "grok-token" } } : undefined,
    readCookie: async provider => provider === "qwen-token-plan" ? "ticket=ok" : undefined,
    readLocalUsage: async () => [{ createdMs: Date.now() - 1000, cost: 1 }],
  });

  it("loads Grok quota through its isolated gRPC-web adapter", async () => {
    const result = await monitor.snapshot("xai", true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.snapshot.windows[0].usedPercent).toBe(22);
  });

  for (const [provider, expected] of [["openai-codex", 11], ["anthropic", 12], ["zai-coding-cn", 13], ["kimi-coding", 14], ["qoder-cn", 15], ["qwen-token-plan", 16]] as const) {
    it(`loads ${provider} quota`, async () => {
      const result = await monitor.snapshot(provider, true);
      expect(result.status).toBe("ready");
      if (result.status === "ready") expect(result.snapshot.windows[0].usedPercent).toBeCloseTo(expected);
    });
  }
  for (const [provider, expected] of [["deepseek", 18], ["moonshot", 19], ["siliconflow", 20], ["openrouter", 21]] as const) {
    it(`loads ${provider} balance`, async () => {
      const result = await monitor.snapshot(provider, true);
      expect(result.status).toBe("ready");
      if (result.status === "ready") expect(result.snapshot.balance?.amount).toBe(expected);
    });
  }
  it("loads OpenCode Go only through the injected local reader", async () => {
    const result = await monitor.snapshot("opencode-go", true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.snapshot.source).toBe("local");
  });
  it("loads GLM quota from ZAI_CODING_CN_API_KEY when no auth entry exists", async () => {
    const envOnly = new AccountUsageMonitor({ fetch: fakeFetch, env: { ZAI_CODING_CN_API_KEY: "cn-key" }, readAuth: async () => ({}) });
    const result = await envOnly.snapshot("zai-coding-cn", true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.snapshot.windows[0].usedPercent).toBeCloseTo(13);
  });
  it("loads GLM quota from a CodexBar-style key file when env and auth are empty", async () => {
    const readKeyFile = vi.fn(async (paths: string[]) => paths[0] === ".coding-relay/glm-api-key" ? "file-key" : undefined);
    const fileOnly = new AccountUsageMonitor({ fetch: fakeFetch, readAuth: async () => ({}), readKeyFile });
    const result = await fileOnly.snapshot("zai-coding-cn", true);
    expect(readKeyFile).toHaveBeenCalledWith([".coding-relay/glm-api-key", ".config/bigmodel/api_key", ".config/zhipu/api_key"]);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.snapshot.windows[0].usedPercent).toBeCloseTo(13);
  });
  it("gates OpenCode Go on env OPENCODE_API_KEY when the auth entry is missing", async () => {
    const byEnv = new AccountUsageMonitor({ fetch: fakeFetch, env: { OPENCODE_API_KEY: "go-key" }, readAuth: async () => ({}), readLocalUsage: async () => [{ createdMs: Date.now() - 1000, cost: 1 }] });
    expect((await byEnv.snapshot("opencode-go", true)).status).toBe("ready");
    const unconfigured = new AccountUsageMonitor({ fetch: fakeFetch, readAuth: async () => ({}), readLocalUsage: async () => [{ createdMs: Date.now() - 1000, cost: 1 }] });
    await expect(unconfigured.snapshot("opencode-go", true)).resolves.toEqual({ status: "no-data", reason: "missing-credential" });
  });
  it("persists the qwen cookie after a successful fetch so the session survives restarts", async () => {
    const persistCookie = vi.fn();
    const monitor = new AccountUsageMonitor({ fetch: fakeFetch, readCookie: async () => "ticket=ok", persistCookie });
    const result = await monitor.snapshot("qwen-token-plan", true);
    expect(result.status).toBe("ready");
    expect(persistCookie).toHaveBeenCalledWith("qwen-token-plan", "ticket=ok");
  });
  it("never persists the qwen cookie when the gateway reports NotLogined", async () => {
    const notLoginedFetch = vi.fn(async () => response({ errorCode: "BailianGateway.Login.NotLogined" })) as unknown as typeof fetch;
    const persistCookie = vi.fn();
    const monitor = new AccountUsageMonitor({ fetch: notLoginedFetch, readCookie: async () => "ticket=stale", persistCookie });
    await monitor.snapshot("qwen-token-plan", true);
    expect(persistCookie).not.toHaveBeenCalled();
  });
  it("returns no-data when credentials or optional capabilities are absent", async () => {
    const empty = new AccountUsageMonitor({ fetch: fakeFetch, readAuth: async () => ({}) });
    await expect(empty.snapshot("anthropic")).resolves.toEqual({ status: "no-data", reason: "missing-credential" });
    await expect(empty.snapshot("qwen-token-plan")).resolves.toEqual({ status: "no-data", reason: "missing-capability" });
    await expect(empty.snapshot("opencode-go")).resolves.toEqual({ status: "no-data", reason: "missing-capability" });
  });
});

describe("monitor caching and failures", () => {
  const auth = async () => ({ tokens: { access_token: "secret" } });
  it("throttles for three minutes, force refreshes, and dedupes concurrent force calls", async () => {
    let now = 1_000, calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async () => { calls++; if (calls === 2) await gate; return response({ rate_limit: { primary_window: { used_percent: calls, limit_window_seconds: 18000 } } }); }) as unknown as typeof fetch;
    const monitor = new AccountUsageMonitor({ fetch: fetcher, readAuth: async store => store === "codex" ? auth() : undefined, now: () => now });
    const first = await monitor.snapshot("openai-codex");
    now += ACCOUNT_USAGE_STALE_AFTER_MS - 1;
    expect(await monitor.snapshot("openai-codex")).toEqual(first);
    const a = monitor.snapshot("openai-codex", true), b = monitor.snapshot("openai-codex", true);
    release();
    expect(await a).toEqual(await b);
    expect(calls).toBe(2);
  });

  it("returns explicit HTTP/malformed/timeout errors without leaking credentials and carries last-good", async () => {
    let mode: "ok" | "http" | "malformed" | "timeout" = "ok";
    const fetcher = vi.fn(async () => {
      if (mode === "http") return response("denied", 401);
      if (mode === "malformed") return response("not-json");
      if (mode === "timeout") throw new DOMException("secret-token", "TimeoutError");
      return response({ rate_limit: { primary_window: { used_percent: 44, limit_window_seconds: 18000 } } });
    }) as unknown as typeof fetch;
    const monitor = new AccountUsageMonitor({ fetch: fetcher, readAuth: async store => store === "codex" ? auth() : undefined });
    const good = await monitor.snapshot("openai-codex");
    for (const [next, code] of [["http", "http"], ["malformed", "malformed"], ["timeout", "timeout"]] as const) {
      mode = next;
      const failed = await monitor.snapshot("openai-codex", true);
      expect(failed).toMatchObject({ status: "error", code });
      if (failed.status === "error") expect(failed.staleSnapshot).toEqual(good.status === "ready" ? good.snapshot : undefined);
      expect(JSON.stringify(failed)).not.toContain("secret");
    }
  });
});

it("exports an explicit, unique provider registry", () => {
  expect(new Set(builtinAccountUsageAdapters.map(adapter => adapter.id)).size).toBe(builtinAccountUsageAdapters.length);
});
