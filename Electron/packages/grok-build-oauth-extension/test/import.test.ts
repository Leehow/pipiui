import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lstatSync } from "node:fs";
import {
  globalGrokAuthPath,
  readGlobalGrokAuth,
  importFromGlobalGrok,
  parseImportConfirm,
} from "../agent/oauth/import.js";
import { GrokCredentialBroker } from "../agent/oauth/broker.js";

const NOW = 1_800_000_000_000;

function officialAuth(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "at-imported",
    refresh_token: "rt-imported",
    expires_at: NOW + 3_600_000, // ms
    oidc_issuer: "https://auth.x.ai",
    client_id: "b1a00492-073a-47ea-816f-4c329264a828",
    ...overrides,
  };
}

describe("parseImportConfirm", () => {
  it("accepts --confirm / confirm=true / confirm / object confirm", () => {
    expect(parseImportConfirm("--confirm").confirm).toBe(true);
    expect(parseImportConfirm("  --confirm  ").confirm).toBe(true);
    expect(parseImportConfirm("confirm=true").confirm).toBe(true);
    expect(parseImportConfirm("confirm=yes").confirm).toBe(true);
    expect(parseImportConfirm({ confirm: true }).confirm).toBe(true);
  });
  it("refuses everything else", () => {
    expect(parseImportConfirm("").confirm).toBe(false);
    expect(parseImportConfirm(undefined).confirm).toBe(false);
    expect(parseImportConfirm("--dry-run").confirm).toBe(false);
    expect(parseImportConfirm("confirm=false").confirm).toBe(false);
    expect(parseImportConfirm({ confirm: "false" }).confirm).toBe(false);
    expect(parseImportConfirm({}).confirm).toBe(false);
  });
});

describe("readGlobalGrokAuth (one-shot read, validated)", () => {
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "grok-import-")); });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("maps the official {key, refresh_token, expires_at(ms), oidc_issuer, client_id} shape", async () => {
    const source = join(dir, "auth.json");
    await writeFile(source, JSON.stringify(officialAuth()));
    const result = await readGlobalGrokAuth({ sourcePath: source, nowMs: () => NOW });
    expect(result).toEqual({
      ok: true,
      credential: {
        access: "at-imported",
        refresh: "rt-imported",
        expiresAtMs: NOW + 3_600_000,
        issuer: "https://auth.x.ai",
        clientId: "b1a00492-073a-47ea-816f-4c329264a828",
      },
    });
  });

  it("accepts seconds-epoch expires_at and pi-shaped {access, refresh, expires}", async () => {
    const source = join(dir, "auth.json");
    await writeFile(source, JSON.stringify(officialAuth({ key: undefined, access: "at2", refresh_token: undefined, refresh: "rt2", expires_at: undefined, expires: Math.floor((NOW + 60_000) / 1000), oidc_issuer: undefined, client_id: undefined })));
    const result = await readGlobalGrokAuth({ sourcePath: source, nowMs: () => NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credential.access).toBe("at2");
      expect(result.credential.refresh).toBe("rt2");
      expect(result.credential.expiresAtMs).toBe(NOW + 60_000);
    }
  });

  it("refuses missing file, missing token, missing expiry, and expired tokens", async () => {
    const missing = await readGlobalGrokAuth({ sourcePath: join(dir, "none.json") });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/未找到/);

    const noToken = join(dir, "no-token.json");
    await writeFile(noToken, JSON.stringify({ refresh_token: "rt" }));
    const r2 = await readGlobalGrokAuth({ sourcePath: noToken });
    expect(r2.ok).toBe(false);

    const noExpiry = join(dir, "no-expiry.json");
    await writeFile(noExpiry, JSON.stringify({ key: "at" }));
    const r3 = await readGlobalGrokAuth({ sourcePath: noExpiry });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toMatch(/expires_at/);

    const expired = join(dir, "expired.json");
    await writeFile(expired, JSON.stringify(officialAuth({ expires_at: NOW - 1 })));
    const r4 = await readGlobalGrokAuth({ sourcePath: expired, nowMs: () => NOW });
    expect(r4.ok).toBe(false);
    if (!r4.ok) expect(r4.reason).toMatch(/过期/);
  });
});

describe("importFromGlobalGrok + broker.importCredential (reviewer MUST-FIX #5)", () => {
  let dir = "";
  let source: string;
  let authPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-import2-"));
    source = join(dir, "grok-auth.json");
    authPath = join(dir, "auth.json");
    await writeFile(source, JSON.stringify(officialAuth()));
  });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("requires explicit confirm", async () => {
    const broker = new GrokCredentialBroker({ authPath });
    const result = await importFromGlobalGrok({ confirm: false, broker, sourcePath: source, nowMs: () => NOW });
    expect(result.imported).toBe(false);
    if (!result.imported) expect(result.reason).toMatch(/确认/);
  });

  it("imports once, validates, persists via broker, and never touches the source", async () => {
    const broker = new GrokCredentialBroker({ authPath });
    // Another provider's credential must survive the merge.
    const data = { other: { type: "api", key: "k" } };
    await writeFile(authPath, JSON.stringify(data, null, 2));
    const before = await readFile(source, "utf8");

    const result = await importFromGlobalGrok({ confirm: true, broker, sourcePath: source, nowMs: () => NOW });
    expect(result.imported).toBe(true);
    expect(result.expiresAtMs).toBe(NOW + 3_600_000);

    const after = await readFile(source, "utf8");
    expect(after).toBe(before); // source untouched

    const stored = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    const entry = stored["grok-build"] as Record<string, unknown>;
    expect(entry.access).toBe("at-imported");
    expect(entry.refresh).toBe("rt-imported");
    expect(entry.issuer).toBe("https://auth.x.ai");
    expect(stored.other).toEqual(data.other);
  });

  it("refuses issuer / client_id mismatch and writes nothing", async () => {
    const badIssuer = join(dir, "bad-issuer.json");
    await writeFile(badIssuer, JSON.stringify(officialAuth({ oidc_issuer: "https://evil.example" })));
    const broker = new GrokCredentialBroker({ authPath });
    const r1 = await importFromGlobalGrok({ confirm: true, broker, sourcePath: badIssuer, nowMs: () => NOW });
    expect(r1.imported).toBe(false);
    if (!r1.imported) expect(r1.reason).toMatch(/issuer/);

    const badClient = join(dir, "bad-client.json");
    await writeFile(badClient, JSON.stringify(officialAuth({ client_id: "someone-else" })));
    const r2 = await importFromGlobalGrok({ confirm: true, broker, sourcePath: badClient, nowMs: () => NOW });
    expect(r2.imported).toBe(false);
    if (!r2.imported) expect(r2.reason).toMatch(/client_id/);
  });

  it("imports through a project symlink without replacing it (shared profile)", async () => {
    const profileDir = join(dir, "app-profile");
    const canonical = join(profileDir, "auth.json");
    const { mkdirSync, symlinkSync, realpathSync } = await import("node:fs");
    mkdirSync(profileDir, { recursive: true });
    await writeFile(canonical, "{}\n", { mode: 0o600 });
    const projectDir = join(dir, "project", ".pi", "agent");
    mkdirSync(projectDir, { recursive: true });
    symlinkSync(canonical, join(projectDir, "auth.json"));

    const broker = new GrokCredentialBroker({ authPath: join(projectDir, "auth.json") });
    const result = await importFromGlobalGrok({ confirm: true, broker, sourcePath: source, nowMs: () => NOW });
    expect(result.imported).toBe(true);
    expect(lstatSync(join(projectDir, "auth.json")).isSymbolicLink()).toBe(true);
    const stored = JSON.parse(await readFile(realpathSync(canonical), "utf8")) as Record<string, unknown>;
    expect((stored["grok-build"] as { access: string }).access).toBe("at-imported");
  });

  it("globalGrokAuthPath points at ~/.grok/auth.json", () => {
    expect(globalGrokAuthPath("/home/tester")).toBe("/home/tester/.grok/auth.json");
  });
});
