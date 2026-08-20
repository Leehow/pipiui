import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostBridge } from "../src/bridge.js";
import {
  deleteSecret,
  listSecretMeta,
  listSessionMounts,
  mountSecret,
  putSecret,
  resetInMemoryVault,
  unmountSecret,
} from "../src/secret-vault.js";

type Tool = {
  name: string;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { sessionManager: { getSessionId: () => string; getSessionFile?: () => string } }) => Promise<any>;
};

async function loadExtension(dir: string, depth = "0") {
  vi.resetModules();
  vi.stubEnv("PIPIUI_AGENT_DEPTH", depth);
  vi.stubEnv("PIPIUI_SECRET_VAULT_DIR", dir);
  vi.stubEnv("PIPIUI_VAULT_DEK", "");
  const tools: Tool[] = [];
  const extension = (await import("../../../resources/runtime/extensions/pipiui-secret-vault.ts")).default;
  extension({
    on: () => {},
    registerTool: (definition: Tool) => { tools.push(definition); },
  } as never);
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("pipiui secret vault tools", () => {
  let root = "";
  let bridge: HostBridge | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await bridge?.close();
    bridge = undefined;
    resetInMemoryVault();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function started(dir: string) {
    bridge = new HostBridge({
      onAgentEvent() {},
      onVaultAction: async (event, sessionId) => {
        const method = String(event.method ?? "");
        const params = Array.isArray(event.params) ? event.params : [];
        if (method === "listSecretVault") {
          return { sessionId, secrets: listSecretMeta(dir), mounts: listSessionMounts(dir, sessionId) };
        }
        if (method === "putSecretVault") {
          const input = params[0] as { name: string; envName: string; value: string };
          const secret = await putSecret(dir, input);
          const mount = await mountSecret(dir, sessionId, secret.id);
          return { secret, mount, sessionId };
        }
        if (method === "mountSecretVault") return { sessionId, mount: await mountSecret(dir, sessionId, String(params[1] ?? params[0]), params[2] ? String(params[2]) : undefined) };
        if (method === "unmountSecretVault") return { sessionId, removed: await unmountSecret(dir, sessionId, String(params[1] ?? params[0])) };
        if (method === "deleteSecretVault") return { deleted: await deleteSecret(dir, String(params[0])) };
        throw new Error(`unsupported ${method}`);
      },
    });
    const port = await bridge.listen();
    const capability = bridge.register("sess-a");
    vi.stubEnv("PIPIUI_BRIDGE_PORT", String(port));
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", capability);
    return capability;
  }

  it("marks an empty mount list so callers re-authorize before secret-backed requests", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-tools-empty-"));
    await started(root);
    const tools = await loadExtension(root);
    const ctx = { sessionManager: { getSessionId: () => "sess-a" } };
    const listed = parse(await tools.secret_vault_list!.execute("1", {}, undefined, undefined, ctx));
    expect(listed).toMatchObject({
      ok: true,
      empty: true,
      message: "vault is empty; please re-authorize before any secret-backed request",
      mounts: [],
    });
  });

  it("stores, lists, mounts across sessions, deletes, and never returns plaintext", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-tools-"));
    const sessionFile = join(root, "sess.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ message: { content: "ghp_toolsecret99" } })}\n`);
    await started(root);
    const tools = await loadExtension(root);
    const ctx = { sessionManager: { getSessionId: () => "sess-a", getSessionFile: () => sessionFile } };
    const put = parse(await tools.secret_vault_put!.execute("1", { name: "gh", envName: "GH_TOKEN", value: "ghp_toolsecret99" }, undefined, undefined, ctx));
    expect(put.ok).toBe(true);
    expect(JSON.stringify(put)).not.toContain("ghp_toolsecret99");
    expect(listSecretMeta(root)).toEqual([expect.objectContaining({ name: "gh", envName: "GH_TOKEN" })]);
    expect(existsSync(join(root, "secret-vault.json"))).toBe(false);
    const listed = parse(await tools.secret_vault_list!.execute("2", {}, undefined, undefined, ctx));
    expect(listed.secrets).toEqual([expect.objectContaining({ name: "gh", envName: "GH_TOKEN" })]);
    expect(listed.mounts).toEqual([expect.objectContaining({ envName: "GH_TOKEN" })]);
    const remount = parse(await tools.secret_vault_mount!.execute("4", { secret: put.secret.id }, undefined, undefined, ctx));
    expect(remount.mount.secretId).toBe(put.secret.id);
    const otherMount = await mountSecret(root, "sess-b", put.secret.id);
    expect(otherMount.secretId).toBe(put.secret.id);
    const deleted = parse(await tools.secret_vault_delete!.execute("5", { secret: put.secret.id }, undefined, undefined, ctx));
    expect(deleted).toEqual({ ok: true, deleted: true });
  });

  it("does not rewrite the live session file from the Pi extension", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-no-rewrite-"));
    const sessionFile = join(root, "sess.jsonl");
    const original = `${JSON.stringify({ message: { content: "ghp_toolsecret99" } })}\n`;
    writeFileSync(sessionFile, original);
    await started(root);
    const tools = await loadExtension(root);
    const ctx = { sessionManager: { getSessionId: () => "sess-a", getSessionFile: () => sessionFile } };
    const put = parse(await tools.secret_vault_put!.execute("1", { name: "gh", envName: "GH_TOKEN", value: "ghp_toolsecret99" }, undefined, undefined, ctx));
    expect(put.ok).toBe(true);
    expect(put.redactError).toBeUndefined();
    expect(readFileSync(sessionFile, "utf8")).toBe(original);
  });

  it("does not register tools on workers", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-worker-"));
    const tools = await loadExtension(root, "1");
    expect(Object.keys(tools)).toEqual([]);
  });
});
