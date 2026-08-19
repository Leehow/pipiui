import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Tool = {
  name: string;
  execute: (id: string, params: any, signal?: unknown, onUpdate?: unknown, ctx?: { sessionManager: { getSessionId: () => string; getSessionFile?: () => string } }) => Promise<any>;
};

async function loadExtension(dir: string, depth = "0") {
  vi.resetModules();
  vi.stubEnv("PIPIUI_SECRET_VAULT_DIR", dir);
  vi.stubEnv("PIPIUI_VAULT_DEK", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("PIPIUI_AGENT_DEPTH", depth);
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
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("stores, lists, mounts across sessions, deletes, and never returns plaintext", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-tools-"));
    const sessionFile = join(root, "sess.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ message: { content: "ghp_toolsecret99" } })}\n`);
    const tools = await loadExtension(root);
    const ctx = { sessionManager: { getSessionId: () => "sess-a", getSessionFile: () => sessionFile } };
    const put = parse(await tools.secret_vault_put!.execute("1", { name: "gh", envName: "GH_TOKEN", value: "ghp_toolsecret99" }, undefined, undefined, ctx));
    expect(put.ok).toBe(true);
    expect(JSON.stringify(put)).not.toContain("ghp_toolsecret99");
    const listed = parse(await tools.secret_vault_list!.execute("2", {}, undefined, undefined, ctx));
    expect(listed.secrets).toEqual([expect.objectContaining({ name: "gh", envName: "GH_TOKEN" })]);
    expect(listed.mounts).toEqual([expect.objectContaining({ envName: "GH_TOKEN" })]);
    const other = { sessionManager: { getSessionId: () => "sess-b" } };
    const remount = parse(await tools.secret_vault_mount!.execute("4", { secret: put.secret.id }, undefined, undefined, other));
    expect(remount.mount.secretId).toBe(put.secret.id);
    const deleted = parse(await tools.secret_vault_delete!.execute("5", { secret: put.secret.id }, undefined, undefined, ctx));
    expect(deleted).toEqual({ ok: true, deleted: true });
  });

  it("does not rewrite the live session file from the Pi extension", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-no-rewrite-"));
    const sessionFile = join(root, "sess.jsonl");
    const original = `${JSON.stringify({ message: { content: "ghp_toolsecret99" } })}\n`;
    writeFileSync(sessionFile, original);
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
