import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import {
  balanceProviderFor,
  codexWindowLabel,
  deepSeekApiKey,
  fetchCodexQuota,
  fetchDeepSeekBalance,
  parseCodexAuth,
  parseCodexUsageWindows,
  parseDeepSeekBalance,
  parseDotEnv,
  quotaProviderFor,
  QuotaStore,
  QUOTA_STALE_AFTER_MS
} from "../src/quota.js";
import { createPiHostBackend } from "../src/index.js";

describe("quotaProviderFor mirrors Swift ModelInfo.quotaProvider", () => {
  it("maps first-party providers", () => {
    expect(quotaProviderFor("xai")).toBe("grok");
    expect(quotaProviderFor("grok-relay")).toBeUndefined(); // relay gate wins
    expect(quotaProviderFor("zai-coding-cn")).toBe("glm");
    expect(quotaProviderFor("anthropic")).toBe("claude");
    expect(quotaProviderFor("openai-codex")).toBe("codex");
    expect(quotaProviderFor("cursor")).toBe("cursor");
    expect(quotaProviderFor("kimi-coding")).toBe("kimi");
    expect(quotaProviderFor("qoder")).toBe("qoder");
    expect(quotaProviderFor("qwen-token-plan-cn")).toBe("qwenTokenPlan");
    expect(quotaProviderFor("qwen-vl")).toBeUndefined(); // bare qwen must not map
    expect(quotaProviderFor("opencode-go")).toBe("opencodeGo");
    expect(quotaProviderFor("opencode")).toBeUndefined(); // pay-as-you-go has no caps
    expect(quotaProviderFor("deepseek")).toBeUndefined();
  });
});

describe("balanceProviderFor mirrors Swift balanceProvider(for:)", () => {
  it("maps deepseek and rejects relay/unknown", () => {
    expect(balanceProviderFor("deepseek")).toBe("deepseek");
    expect(balanceProviderFor("deepseek-relay")).toBeUndefined(); // relay gate wins
    expect(balanceProviderFor("openai-codex")).toBeUndefined(); // quota provider, not balance
    expect(balanceProviderFor("coding-relay")).toBeUndefined();
  });
});

describe("parseDotEnv mirrors EnvFileStore.parse", () => {
  it("parses KEY=VALUE with comments, quotes and later-duplicate wins", () => {
    const env = parseDotEnv(`# comment\nDEEPSEEK_API_KEY=sk-plain\n\nEMPTY=\nQUOTED="sk-quoted"\nSINGLE='sk-single'\nDEEPSEEK_API_KEY=sk-last`);
    expect(env.DEEPSEEK_API_KEY).toBe("sk-last");
    expect(env.QUOTED).toBe("sk-quoted");
    expect(env.SINGLE).toBe("sk-single");
    expect(env.EMPTY).toBe("");
  });
  it("ignores malformed lines", () => {
    expect(parseDotEnv("no-equals\n1BAD=key\n")).toEqual({});
  });
});

describe("deepSeekApiKey mirrors Swift BalanceAuthStore", () => {
  it("prefers process env over the .env file", async () => {
    expect(await deepSeekApiKey({ DEEPSEEK_API_KEY: "sk-proc" }, {
      readDeepSeekEnvFile: async () => "DEEPSEEK_API_KEY=sk-file\n"
    })).toBe("sk-proc");
  });
  it("falls back to the .env file when the process env has no key", async () => {
    expect(await deepSeekApiKey({}, {
      readDeepSeekEnvFile: async () => 'DEEPSEEK_API_KEY="sk-file"\n'
    })).toBe("sk-file");
  });
  it("falls back to auth.json deepseek api_key entry, then common key fields", async () => {
    expect(await deepSeekApiKey({}, {
      readDeepSeekEnvFile: async () => undefined,
      readDeepSeekAuth: async () => JSON.stringify({ deepseek: { type: "api_key", key: "sk-auth" } })
    })).toBe("sk-auth");
    expect(await deepSeekApiKey({}, {
      readDeepSeekEnvFile: async () => undefined,
      readDeepSeekAuth: async () => JSON.stringify({ deepseek: { access_token: "sk-access" } })
    })).toBe("sk-access");
  });
  it("returns undefined without any key source (never throws)", async () => {
    expect(await deepSeekApiKey({}, {
      readDeepSeekEnvFile: async () => undefined,
      readDeepSeekAuth: async () => undefined
    })).toBeUndefined();
    expect(await deepSeekApiKey({}, {
      readDeepSeekEnvFile: async () => "OTHER_KEY=x\n",
      readDeepSeekAuth: async () => "not json"
    })).toBeUndefined();
  });
});

describe("parseDeepSeekBalance mirrors BalanceBilling.parseDeepSeek", () => {
  it("returns total_balance + currency from the first balance_info", () => {
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "0.00", topped_up_balance: "110.00" }]
    })).toEqual({ amount: 110, currency: "CNY" });
    expect(parseDeepSeekBalance({ balance_infos: [{ total_balance: 74.75 }] })).toEqual({ amount: 74.75, currency: "CNY" });
    expect(parseDeepSeekBalance({ balance_infos: [{ currency: "usd", total_balance: "74.75" }] })).toEqual({ amount: 74.75, currency: "USD" });
  });
  it("returns undefined when is_available is false (treated as no balance)", () => {
    expect(parseDeepSeekBalance({ is_available: false, balance_infos: [{ currency: "CNY", total_balance: "110.00" }] })).toBeUndefined();
  });
  it("returns undefined for missing/empty infos or unparseable amount", () => {
    expect(parseDeepSeekBalance({})).toBeUndefined();
    expect(parseDeepSeekBalance(null)).toBeUndefined();
    expect(parseDeepSeekBalance({ balance_infos: [] })).toBeUndefined();
    expect(parseDeepSeekBalance({ balance_infos: [{ total_balance: "abc" }] })).toBeUndefined();
  });
});

describe("fetchDeepSeekBalance", () => {
  const balanceBody = { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "88.00" }] };
  it("calls /user/balance with the bearer header", async () => {
    let request: { url?: string; init?: RequestInit } = {};
    const fakeFetch = (async (url: any, init: any) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify(balanceBody), { status: 200 });
    }) as unknown as typeof fetch;
    const balance = await fetchDeepSeekBalance({ DEEPSEEK_API_KEY: "sk-ds" }, { fetch: fakeFetch });
    expect(request.url).toBe("https://api.deepseek.com/user/balance");
    const headers = request.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ds");
    expect(headers.Accept).toBe("application/json");
    expect(balance).toEqual({ amount: 88, currency: "CNY" });
  });
  it("returns undefined (no pill) without a key or when is_available is false, never throws", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify(balanceBody), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchDeepSeekBalance({}, { fetch: fakeFetch, readDeepSeekEnvFile: async () => undefined, readDeepSeekAuth: async () => undefined })).toBeUndefined();
    expect(await fetchDeepSeekBalance({ DEEPSEEK_API_KEY: "sk-ds" }, {
      fetch: (async () => new Response(JSON.stringify({ is_available: false, balance_infos: [{ total_balance: "10" }] }), { status: 200 })) as unknown as typeof fetch
    })).toBeUndefined();
  });
  it("propagates HTTP failures so the store can keep the last good cache", async () => {
    const failing = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
    await expect(fetchDeepSeekBalance({ DEEPSEEK_API_KEY: "sk-ds" }, { fetch: failing })).rejects.toThrow(/HTTP 401/);
  });
});

describe("parseCodexAuth mirrors CodexAuthStore", () => {
  it("reads the token shape with account id", () => {
    expect(parseCodexAuth(JSON.stringify({ tokens: { access_token: "tok", account_id: "acc" } }))).toEqual({ accessToken: "tok", accountId: "acc" });
    expect(parseCodexAuth(JSON.stringify({ tokens: { accessToken: "tok2" } }))).toEqual({ accessToken: "tok2" });
  });
  it("reads the API-key shape", () => {
    expect(parseCodexAuth(JSON.stringify({ OPENAI_API_KEY: "sk-x" }))).toEqual({ accessToken: "sk-x" });
  });
  it("rejects empty or malformed files", () => {
    expect(parseCodexAuth("not json")).toBeUndefined();
    expect(parseCodexAuth(JSON.stringify({ tokens: {} }))).toBeUndefined();
    expect(parseCodexAuth(JSON.stringify({ OPENAI_API_KEY: "" }))).toBeUndefined();
  });
});

describe("codexWindowLabel mirrors Swift CodexRateWindow.label", () => {
  it("derives 5h / 周 / 月 / 额度 from window seconds", () => {
    expect(codexWindowLabel(5 * 3600)).toBe("5h");
    expect(codexWindowLabel(7 * 86400)).toBe("周");
    expect(codexWindowLabel(30 * 86400)).toBe("月");
    expect(codexWindowLabel(3600)).toBe("额度");
    expect(codexWindowLabel(undefined)).toBe("额度");
  });
});

describe("parseCodexUsageWindows mirrors CodexWebBilling.parseWindows", () => {
  const body = {
    rate_limit: {
      primary_window: { used_percent: 4, reset_at: 1786400000, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 41, reset_at: "2026-08-16T10:00:00Z", limit_window_seconds: 604800 }
    }
  };
  it("parses both windows with epoch-second and ISO resets", () => {
    const windows = parseCodexUsageWindows(body);
    expect(windows).toEqual([
      { id: "window0", usedPercent: 4, resetsAt: 1786400000000, label: "5h", title: "5h额度" },
      { id: "window1", usedPercent: 41, resetsAt: Date.parse("2026-08-16T10:00:00Z"), label: "周", title: "周额度" }
    ]);
  });
  it("keeps the raw key id for a single window and clamps percentages", () => {
    const single = parseCodexUsageWindows({ rate_limit: { primary_window: { used_percent: "128", limit_window_seconds: 18000 } } });
    expect(single).toEqual([{ id: "primary_window", usedPercent: 100, resetsAt: undefined, label: "5h", title: "5h额度" }]);
  });
  it("tolerates missing rate_limit", () => {
    expect(parseCodexUsageWindows({})).toEqual([]);
    expect(parseCodexUsageWindows(null)).toEqual([]);
  });
});

describe("fetchCodexQuota", () => {
  const usageBody = { rate_limit: { primary_window: { used_percent: 41, reset_at: 1786900000, limit_window_seconds: 604800 } } };
  it("calls /wham/usage with bearer + account headers", async () => {
    let request: { url?: string; init?: RequestInit } = {};
    const fakeFetch = (async (url: any, init: any) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify(usageBody), { status: 200 });
    }) as unknown as typeof fetch;
    const windows = await fetchCodexQuota({}, {
      fetch: fakeFetch,
      readCodexAuth: async () => JSON.stringify({ tokens: { access_token: "tok", account_id: "acc" } })
    });
    expect(request.url).toBe("https://chatgpt.com/backend-api/wham/usage");
    const headers = request.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["ChatGPT-Account-Id"]).toBe("acc");
    expect(windows).toEqual([{ id: "primary_window", usedPercent: 41, resetsAt: 1786900000000, label: "周", title: "周额度" }]);
  });
  it("returns undefined (no pill) without a credential, never throws", async () => {
    expect(await fetchCodexQuota({}, { readCodexAuth: async () => undefined })).toBeUndefined();
    expect(await fetchCodexQuota({}, { readCodexAuth: async () => "{}" })).toBeUndefined();
  });
  it("propagates HTTP failures so the store can keep the last good cache", async () => {
    const failing = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
    await expect(fetchCodexQuota({}, { fetch: failing, readCodexAuth: async () => JSON.stringify({ OPENAI_API_KEY: "sk-x" }) })).rejects.toThrow(/HTTP 401/);
  });
});

describe("PiHostBackend quota bridge", () => {
  it("uses the requested session's Codex provider instead of the configured default", async () => {
    const snapshot = { provider: "codex", accountLabel: "Codex 账号额度", windows: [{ id: "primary", usedPercent: 63, label: "5h", title: "5小时额度" }, { id: "secondary", usedPercent: 12, label: "周", title: "周额度" }] };
    const quotaStore = { snapshot: vi.fn(async () => snapshot) };
    const backend = createPiHostBackend({ quotaStore: quotaStore as any });
    const privateBackend = backend as unknown as { sessionModelSnapshots: Map<string, unknown> };
    privateBackend.sessionModelSnapshots.set("codex-session", {
      model: { provider: "openai-codex", id: "gpt-5.4", name: "Codex", reasoning: true },
      thinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium"],
    });

    await expect(backend.handle("getQuotaSnapshot", ["codex-session"])).resolves.toEqual(snapshot);
    expect(quotaStore.snapshot).toHaveBeenCalledWith("openai-codex");
  });

  it("uses an OpenCode Go model id when OpenCode groups it under its generic provider", async () => {
    const snapshot = { provider: "opencodeGo", accountLabel: "OpenCode Go 本机用量", windows: [{ id: "fiveHour", usedPercent: 50, label: "5h", title: "5小时本机用量" }] };
    const quotaStore = { snapshot: vi.fn(async () => snapshot) };
    const backend = createPiHostBackend({ quotaStore: quotaStore as any });
    const privateBackend = backend as unknown as { sessionModelSnapshots: Map<string, unknown> };
    privateBackend.sessionModelSnapshots.set("opencode-go-session", {
      model: { provider: "opencode", id: "opencode-go", name: "OpenCode Go", reasoning: true },
      thinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium"],
    });

    await expect(backend.handle("getQuotaSnapshot", ["opencode-go-session"])).resolves.toEqual(snapshot);
    expect(quotaStore.snapshot).toHaveBeenCalledWith("opencode-go");
  });
});

describe("QuotaStore", () => {
  const windows = [{ id: "window0", usedPercent: 4, label: "5h", title: "5h额度" }, { id: "window1", usedPercent: 41, label: "周", title: "周额度" }];
  const authReader = async () => JSON.stringify({ tokens: { access_token: "tok" } });

  it("returns a codex snapshot for the model provider", async () => {
    const store = new QuotaStore({}, { fetch: (async () => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 4, limit_window_seconds: 18000 }, secondary_window: { used_percent: 41, limit_window_seconds: 604800 } } }), { status: 200 })) as unknown as typeof fetch, readCodexAuth: authReader });
    const snapshot = await store.snapshot("openai-codex");
    expect(snapshot).toEqual({ provider: "codex", accountLabel: "Codex 账号额度", windows });
  });

  it("returns null for unmapped and relay providers, and balance providers without a key", async () => {
    const store = new QuotaStore({}, {
      readCodexAuth: authReader,
      readDeepSeekEnvFile: async () => undefined,
      readDeepSeekAuth: async () => undefined
    });
    expect(await store.snapshot("deepseek")).toBeNull();
    expect(await store.snapshot("coding-relay")).toBeNull();
  });

  it("returns a deepseek balance snapshot for the model provider (fixture, no network)", async () => {
    const store = new QuotaStore({}, {
      readDeepSeekEnvFile: async () => "DEEPSEEK_API_KEY=sk-fixture\n",
      fetch: (async () => new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "88.00" }] }), { status: 200 })) as unknown as typeof fetch
    });
    const snapshot = await store.snapshot("deepseek");
    expect(snapshot).toEqual({ provider: "deepseek", accountLabel: "账户余额", balance: { amount: 88, currency: "CNY" }, windows: [] });
    expect(snapshot?.windows).toEqual([]);
  });

  it("reads OpenCode Go costs from a temporary SQLite database only when auth.json has a key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pipi-opencode-go-"));
    const databasePath = join(directory, "opencode.db");
    const now = Date.UTC(2026, 7, 13, 12);
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT, time_created INTEGER); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT, time_created INTEGER)");
      const message = database.prepare("INSERT INTO message (id, data, time_created) VALUES (?, ?, ?)");
      message.run("m1", JSON.stringify({ providerID: "opencode-go", role: "assistant", cost: 8, time: { created: now - 60_000 } }), now - 60_000);
      message.run("m2", JSON.stringify({ providerID: "opencode-go", role: "assistant", cost: 2, time: { created: now - 120_000 } }), now - 120_000);
      message.run("m3", JSON.stringify({ providerID: "other", role: "assistant", cost: 100, time: { created: now - 60_000 } }), now - 60_000);
      database.prepare("INSERT INTO part (id, message_id, data, time_created) VALUES (?, ?, ?, ?)")
        .run("p1", "m1", JSON.stringify({ type: "step-finish", cost: 3, time: { created: now - 30_000 } }), now - 30_000);
    } finally {
      database.close();
    }
    try {
      // agentDir points at the temp dir so a real ~/.pi/agent/.env (which may
      // carry OPENCODE_API_KEY) never satisfies the credential gate.
      const withoutKey = new QuotaStore({}, { now: () => now, agentDir: directory, openCodeDatabasePath: databasePath, readOpenCodeAuth: async () => JSON.stringify({ "opencode-go": { key: "  " } }) });
      expect(await withoutKey.snapshot("opencode-go", true)).toBeNull();

      const withKey = new QuotaStore({}, { now: () => now, agentDir: directory, openCodeDatabasePath: databasePath, readOpenCodeAuth: async () => JSON.stringify({ "opencode-go": { key: "go-key" } }) });
      const snapshot = await withKey.snapshot("opencode-go", true);
      expect(snapshot?.provider).toBe("opencodeGo");
      expect(snapshot?.windows.map(window => window.usedPercent)).toEqual([expect.closeTo(5 / 12 * 100), expect.closeTo(5 / 30 * 100), expect.closeTo(5 / 60 * 100)]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets an injected OpenCode local reader override the default auth/database capability", async () => {
    const now = Date.UTC(2026, 7, 13, 12);
    const readLocalUsage = vi.fn(async () => [{ createdMs: now - 1_000, cost: 6 }]);
    const store = new QuotaStore({ OPENCODE_API_KEY: "go-key" }, { now: () => now, readOpenCodeAuth: async () => "{}", openCodeDatabasePath: "/must/not/be/opened", readLocalUsage });
    const snapshot = await store.snapshot("opencode-go", true);
    expect(snapshot?.windows[0].usedPercent).toBe(50);
    expect(readLocalUsage).toHaveBeenCalledOnce();
  });

  it("falls back to assistant message costs when the OpenCode database has no part table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pipi-opencode-go-message-"));
    const databasePath = join(directory, "opencode.db"), now = Date.UTC(2026, 7, 13, 12);
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT, time_created INTEGER)");
      database.prepare("INSERT INTO message (id, data, time_created) VALUES (?, ?, ?)")
        .run("m1", JSON.stringify({ providerID: "opencode-go", role: "assistant", cost: 6, time: { created: now - 1_000 } }), now - 1_000);
    } finally {
      database.close();
    }
    try {
      const store = new QuotaStore({}, { now: () => now, openCodeDatabasePath: databasePath, readOpenCodeAuth: async () => JSON.stringify({ "opencode-go": { key: "go-key" } }) });
      expect((await store.snapshot("opencode-go", true))?.windows[0].usedPercent).toBe(50);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("throttles refetches until the snapshot is stale, then refreshes", async () => {
    let time = 1_000_000;
    let calls = 0;
    const store = new QuotaStore({}, {
      now: () => time,
      readCodexAuth: authReader,
      fetch: (async () => { calls++; return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: calls * 10, limit_window_seconds: 604800 } } }), { status: 200 }); }) as unknown as typeof fetch
    });
    const first = await store.snapshot("openai-codex");
    expect(first?.windows[0].usedPercent).toBe(10);
    time += QUOTA_STALE_AFTER_MS - 1;
    const cached = await store.snapshot("openai-codex");
    expect(cached).toBe(first);
    expect(calls).toBe(1);
    time += 2;
    const refreshed = await store.snapshot("openai-codex");
    expect(refreshed?.windows[0].usedPercent).toBe(20);
    expect(calls).toBe(2);
  });

  it("keeps the last good snapshot when a refresh fails", async () => {
    let time = 0;
    let fail = false;
    const store = new QuotaStore({}, {
      now: () => time,
      readCodexAuth: authReader,
      fetch: (async () => fail ? new Response("denied", { status: 401 }) : new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 41, limit_window_seconds: 604800 } } }), { status: 200 })) as unknown as typeof fetch
    });
    const good = await store.snapshot("openai-codex");
    expect(good?.windows[0].usedPercent).toBe(41);
    time += QUOTA_STALE_AFTER_MS + 1;
    fail = true;
    expect(await store.snapshot("openai-codex")).toBe(good);
  });
});
