import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySessionMountsToMainEnv,
  applySessionMountsToWorkerEnv,
  atomicWriteFile,
  configureVaultKeyProvider,
  createSealedDekProvider,
  createSessionEnvRefreshGate,
  createSessionRedactionGate,
  createSessionWriteBarrier,
  deleteSecret,
  ensureSecureDirectory,
  listSecretMeta,
  listSessionMounts,
  loadVault,
  memoryKeyProvider,
  mountSecret,
  putSecret,
  redactSessionJsonl,
  redactText,
  revealMountedSecrets,
  StreamRedactor,
  unmountSecret,
  VaultEncryptionError,
  vaultDiagnosisFor,
  workerEnvFromVault,
} from "../../../resources/runtime/extensions/secret-vault-core.ts";

describe("secret vault", () => {
  const dirs: string[] = [];
  const dek = Buffer.alloc(32, 7);

  beforeEach(() => {
    configureVaultKeyProvider(memoryKeyProvider(dek));
  });
  afterEach(async () => {
    configureVaultKeyProvider(undefined);
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tmp() {
    const dir = await mkdtemp(join(tmpdir(), "pipi-vault-"));
    dirs.push(dir);
    return dir;
  }

  it("encrypts values without a sibling key file and survives restart with a separate sealed DEK", async () => {
    const dir = await tmp();
    const sealedDir = await tmp();
    const sealedPath = join(sealedDir, "dek.sealed");
    const store = new Map<string, Buffer>();
    configureVaultKeyProvider(createSealedDekProvider(sealedPath, {
      available: () => true,
      seal: (plain) => {
        const token = Buffer.from(`sealed:${plain.toString("base64")}`);
        store.set(token.toString("base64"), plain);
        return token;
      },
      open: (sealed) => store.get(sealed.toString("base64")) ?? Buffer.alloc(0),
    }));
    await putSecret(dir, { name: "openai", envName: "OPENAI_API_KEY", value: "sk-live-supersecret" });
    expect(existsSync(join(dir, "secret-vault.key"))).toBe(false);
    expect(readFileSync(join(dir, "secret-vault.json"), "utf8")).not.toContain("sk-live-supersecret");
    expect(existsSync(sealedPath)).toBe(true);
    configureVaultKeyProvider(createSealedDekProvider(sealedPath, {
      available: () => true,
      seal: (plain) => Buffer.from(`sealed:${plain.toString("base64")}`),
      open: (sealed) => store.get(sealed.toString("base64")) ?? Buffer.alloc(0),
    }));
    expect(revealMountedSecrets(dir, "none")).toEqual([]);
    await mountSecret(dir, "s1", "openai");
    expect(revealMountedSecrets(dir, "s1")[0]?.value).toBe("sk-live-supersecret");
  });

  it("fails closed when encryption is unavailable and never writes a key file", async () => {
    const dir = await tmp();
    configureVaultKeyProvider({ getDek: () => { throw new Error("vault encryption unavailable"); } });
    await expect(putSecret(dir, { name: "x", envName: "X_TOKEN", value: "abcdefghij" })).rejects.toThrow(/unavailable/);
    expect(existsSync(join(dir, "secret-vault.key"))).toBe(false);
  });

  it("mounts per session and injects only that session's worker env", async () => {
    const dir = await tmp();
    await putSecret(dir, { name: "a", envName: "TOKEN_A", value: "aaaaaaaaaaaa" });
    await putSecret(dir, { name: "b", envName: "TOKEN_B", value: "bbbbbbbbbbbb" });
    await mountSecret(dir, "session-1", "a");
    await mountSecret(dir, "session-2", "b");
    expect(workerEnvFromVault(dir, "session-1")).toEqual({ TOKEN_A: "aaaaaaaaaaaa" });
    expect(workerEnvFromVault(dir, "session-2")).toEqual({ TOKEN_B: "bbbbbbbbbbbb" });
    expect(listSessionMounts(dir, "session-1")).toEqual([expect.objectContaining({ envName: "TOKEN_A", name: "a" })]);
    expect(await unmountSecret(dir, "session-1", "a")).toBe(true);
    expect(workerEnvFromVault(dir, "session-1")).toEqual({});
  });

  it("deletes globally and serializes concurrent writes atomically", async () => {
    const dir = await tmp();
    await Promise.all(Array.from({ length: 12 }, (_, index) => putSecret(dir, {
      name: `n${index}`,
      envName: `TOKEN_${index}`,
      value: `valuevalue${index}xx`,
    })));
    expect(listSecretMeta(dir)).toHaveLength(12);
    expect(loadVault(dir).revision).toBe(12);
    expect(await deleteSecret(dir, "TOKEN_3")).toBe(true);
    expect(listSecretMeta(dir).some((item) => item.envName === "TOKEN_3")).toBe(false);
  });

  it("redacts secrets across stream chunks and on stable JSONL rewrite", async () => {
    const dir = await tmp();
    await putSecret(dir, { name: "gh", envName: "GH_TOKEN", value: "ghp_historysecret" });
    await mountSecret(dir, "sess", "gh");
    const secrets = revealMountedSecrets(dir, "sess");
    const stream = new StreamRedactor(secrets);
    expect(stream.push("token=ghp_hist")).toBe("token=");
    expect(stream.push("orysecret done and more padding")).toContain("{{secret:GH_TOKEN}}");
    expect(stream.flush()).not.toContain("ghp_historysecret");
    const session = join(dir, "chat.jsonl");
    writeFileSync(session, `${JSON.stringify({ message: { content: "leak ghp_historysecret here" } })}\n`);
    const result = await redactSessionJsonl(session, secrets);
    expect(result.changed).toBe(true);
    const text = readFileSync(session, "utf8");
    expect(text).toContain("{{secret:GH_TOKEN}}");
    expect(text).not.toContain("ghp_historysecret");
  });

  it("holds a split secret until the second chunk completes", () => {
    const secrets = [{ id: "1", name: "demo", envName: "DEMO_TOKEN", value: "abcdefgh" }];
    const stream = new StreamRedactor(secrets);
    expect(stream.push("abcd")).toBe("");
    expect(stream.push("efghX")).toBe("{{secret:DEMO_TOKEN}}X");
    expect(stream.flush()).toBe("");
  });

  it("keeps overlapping prefixes, multiple secrets, short values, and flush isolated", () => {
    const longA = { id: "a", name: "a", envName: "TOKEN_A", value: "abcdwxyz" };
    const longB = { id: "b", name: "b", envName: "TOKEN_B", value: "abcd1234" };
    const short = { id: "s", name: "s", envName: "TOKEN_S", value: "short" };
    const text = new StreamRedactor([longA, longB, short]);
    const thinking = new StreamRedactor([longA, longB, short]);
    expect(text.push("abcd")).toBe("");
    expect(thinking.push("hello ")).toBe("hello ");
    expect(text.push("wxyz and abcd")).toBe("{{secret:TOKEN_A}} and ");
    expect(text.push("1234!")).toBe("{{secret:TOKEN_B}}!");
    expect(thinking.push("short abcd")).toBe("short ");
    expect(thinking.flush()).toBe("abcd");
    expect(text.flush()).toBe("");
  });

  it("serializes a concurrent JSONL append behind the session writer barrier", async () => {
    const dir = await tmp();
    await putSecret(dir, { name: "gh", envName: "GH_TOKEN", value: "ghp_historysecret" });
    await mountSecret(dir, "sess", "gh");
    const session = join(dir, "chat.jsonl");
    writeFileSync(session, `${JSON.stringify({ id: "1", message: { content: "ghp_historysecret" } })}\n`);
    const barrier = createSessionWriteBarrier();
    const rewrite = redactSessionJsonl(session, revealMountedSecrets(dir, "sess"), { exclusive: barrier });
    const append = barrier(async () => {
      appendFileSync(session, `${JSON.stringify({ id: "2", message: { content: "later" } })}\n`);
    });
    await Promise.all([rewrite, append]);
    const text = readFileSync(session, "utf8");
    expect(text).toContain("later");
    expect(text).not.toContain("ghp_historysecret");
  });

  it("constructs a real child env with only the current session mounts", async () => {
    const dir = await tmp();
    await putSecret(dir, { name: "a", envName: "TOKEN_A", value: "aaaaaaaaaaaa" });
    await putSecret(dir, { name: "b", envName: "TOKEN_B", value: "bbbbbbbbbbbb" });
    await mountSecret(dir, "session-1", "a");
    const parent = {
      PATH: process.env.PATH,
      PIPIUI_SECRET_VAULT_DIR: dir,
      PIPIUI_SESSION_ID: "session-1",
      PIPIUI_VAULT_DEK: dek.toString("base64"),
      EXISTING: "keep",
      OPENAI_API_KEY: "from-dotenv",
    };
    const main = applySessionMountsToMainEnv(parent, workerEnvFromVault(dir, "session-1"));
    expect(main.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(main.TOKEN_B).toBeUndefined();
    expect(main.PIPIUI_VAULT_DEK).toBe(dek.toString("base64"));
    const child = applySessionMountsToWorkerEnv(parent, workerEnvFromVault(dir, "session-1"));
    expect(child.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(child.TOKEN_B).toBeUndefined();
    expect(child.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(child.EXISTING).toBe("keep");
    expect(child.OPENAI_API_KEY).toBe("from-dotenv");
    const script = `process.stdout.write(JSON.stringify({a:process.env.TOKEN_A,b:process.env.TOKEN_B,dek:process.env.PIPIUI_VAULT_DEK,dot:process.env.OPENAI_API_KEY}))`;
    const spawned = spawnSync(process.execPath, ["-e", script], { env: child as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(spawned.status).toBe(0);
    expect(JSON.parse(spawned.stdout)).toEqual({ a: "aaaaaaaaaaaa", dot: "from-dotenv" });
    const afterRedactionStop = applySessionMountsToWorkerEnv(parent, workerEnvFromVault(dir, "session-1"));
    expect(afterRedactionStop.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(afterRedactionStop.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(afterRedactionStop.PIPIUI_SECRET_VAULT_DEK).toBeUndefined();
    await mountSecret(dir, "session-1", "b");
    const afterMount = applySessionMountsToWorkerEnv(parent, workerEnvFromVault(dir, "session-1"));
    expect(afterMount.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(afterMount.TOKEN_B).toBe("bbbbbbbbbbbb");
    await unmountSecret(dir, "session-1", "a");
    const afterUnmount = applySessionMountsToWorkerEnv(parent, workerEnvFromVault(dir, "session-1"));
    expect(afterUnmount.TOKEN_A).toBeUndefined();
    expect(afterUnmount.TOKEN_B).toBe("bbbbbbbbbbbb");
    await deleteSecret(dir, "b");
    const afterDelete = applySessionMountsToWorkerEnv(parent, workerEnvFromVault(dir, "session-1"));
    expect(afterDelete.TOKEN_B).toBeUndefined();
    expect(afterDelete.OPENAI_API_KEY).toBe("from-dotenv");
  });

  it("defers a busy-session env refresh and restarts once the writer is confirmed idle", async () => {
    let quiet = false;
    let writerLive = true;
    let stops = 0;
    const gate = createSessionEnvRefreshGate({
      canRefresh: () => quiet,
      stopWriter: async () => {
        if (!quiet) return false;
        stops += 1;
        writerLive = false;
        return true;
      },
    });
    gate.request("sess");
    gate.request("sess");
    expect(await gate.flush("sess")).toBe("deferred");
    expect(stops).toBe(0);
    expect(writerLive).toBe(true);
    quiet = true;
    expect(await gate.flush("sess")).toBe("rewritten");
    expect(stops).toBe(1);
    expect(writerLive).toBe(false);
    expect(writerLive ? "reused" : "respawned").toBe("respawned");
  });

  it("redacts only complete secrets in text", async () => {
    expect(redactText("token=ghp_historysecret", [{ id: "1", name: "gh", envName: "GH_TOKEN", value: "ghp_historysecret" }])).toBe("token={{secret:GH_TOKEN}}");
  });

  it("defers busy-turn puts, dedupes them, and rewrites once after idle with a confirmed writer stop", async () => {
    let quiet = false;
    let writerLive = true;
    let rewrites = 0;
    const gate = createSessionRedactionGate({
      hasWork: () => true,
      canRewrite: () => quiet,
      confirmWriterIdle: async () => {
        if (!quiet) return false;
        writerLive = false;
        return true;
      },
      rewrite: async () => { rewrites += 1; },
    });
    gate.request("sess");
    gate.request("sess");
    expect(await gate.flush("sess")).toBe("deferred");
    expect(rewrites).toBe(0);
    expect(gate.hasPending("sess")).toBe(true);
    expect(writerLive).toBe(true);
    quiet = true;
    expect(await gate.flush("sess")).toBe("rewritten");
    expect(rewrites).toBe(1);
    expect(gate.hasPending("sess")).toBe(false);
    expect(writerLive).toBe(false);
    expect(writerLive ? "reused" : "respawned").toBe("respawned");
  });

  it("writes vault files 0600 into a 0700 directory and cleans leftover temps", async () => {
    const dir = await tmp();
    ensureSecureDirectory(dir);
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o777).toBe(0o700);
    await putSecret(dir, { name: "perm", envName: "PERM_TOKEN", value: "abcdefghijkl" });
    const file = join(dir, "secret-vault.json");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const leftover = join(dir, "secret-vault.json.tmp-orphan");
    writeFileSync(leftover, "partial");
    atomicWriteFile(file, readFileSync(file));
    expect(existsSync(leftover)).toBe(true);
    expect(existsSync(join(dir, "secret-vault.key"))).toBe(false);
  });

  it("fails closed with a classified error and recovers when encryption returns", async () => {
    const dir = await tmp();
    configureVaultKeyProvider({
      getDek: () => { throw new VaultEncryptionError("encryption-unavailable"); },
    });
    await expect(putSecret(dir, { name: "x", envName: "X_TOKEN", value: "abcdefghij" })).rejects.toBeInstanceOf(VaultEncryptionError);
    expect(existsSync(join(dir, "secret-vault.key"))).toBe(false);
    configureVaultKeyProvider(memoryKeyProvider(dek));
    await putSecret(dir, { name: "x", envName: "X_TOKEN", value: "abcdefghij" });
    expect(listSecretMeta(dir)).toEqual([expect.objectContaining({ envName: "X_TOKEN" })]);
    expect(vaultDiagnosisFor("missing-packages").installHint).toContain("gnome-keyring");
  });

  it("does not rewrite when the session writer stop is not confirmed", async () => {
    let confirmed = false;
    let rewrites = 0;
    const gate = createSessionRedactionGate({
      hasWork: () => true,
      canRewrite: () => true,
      confirmWriterIdle: async () => confirmed,
      rewrite: async () => { rewrites += 1; },
    });
    gate.request("sess");
    expect(await gate.flush("sess")).toBe("deferred");
    expect(rewrites).toBe(0);
    expect(gate.hasPending("sess")).toBe(true);
    confirmed = true;
    expect(await gate.flush("sess")).toBe("rewritten");
    expect(rewrites).toBe(1);
  });
});
