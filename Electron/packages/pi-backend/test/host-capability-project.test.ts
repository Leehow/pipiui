import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { HostCapabilityBroker } from "../src/host-capability.js";
import { type HostBridge } from "../src/bridge.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { readProjectExtensionGrants, writeProjectExtensionGrant } from "../src/extension-grants.js";
import { createNativeCuaClient } from "../../../resources/runtime/extensions/cua-extension/agent/host-capability-client.js";

let root = "";
let backend: ReturnType<typeof createPiHostBackend> | undefined;
afterEach(async () => {
  if (backend) {
    (backend as any).live.clear();
    await backend.close();
    backend = undefined;
  }
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function setup() {
  root = await mkdtemp(join(tmpdir(), "pipi-capability-project-"));
  const project = join(root, "project");
  const cwd = join(project, ".pi", "worktrees", "session-test");
  const other = join(root, "other-project");
  await Promise.all([cwd, other].map(path => mkdir(path, { recursive: true })));
  const grant = { grantedCapabilities: ["native.exec"], grantedAt: "2026-01-01T00:00:00Z" };
  await writeProjectExtensionGrant(projectPiAgentDir(project), "cua-extension", grant);
  await writeProjectExtensionGrant(projectPiAgentDir(other), "cua-extension", grant);
  let bridge: HostBridge;
  const driver = vi.fn(async () => ({ ok: true, observed: "test-only-driver" }));
  const projectAllows = vi.fn(async (id: string, projectRoot: string, permission: string) => {
    const grants = await readProjectExtensionGrants(projectPiAgentDir(projectRoot));
    return grants[id]?.grantedCapabilities.includes(permission) ?? false;
  });
  const broker = new HostCapabilityBroker({
    policy: {
      declaredPermissions: id => id === "cua-extension" ? ["native.exec"] : [],
      projectAllows,
      verifyDesktopGrant: ({ sessionId, computerCapability }) => bridge.verifyComputerGrant(sessionId, computerCapability),
    },
    drivers: { native: { handle: driver } },
  });
  const mint = vi.fn(request => broker.mint(request));
  backend = createPiHostBackend({
    agentDir: join(root, "app"), runtimeRoot: join(root, "runtime"), sessionsRoot: join(root, "sessions"),
    canonicalProjectPaths: async () => undefined, profileMode: "default",
    hostCapabilityTokenAction: mint,
    hostCapabilityAction: (request, sessionId) => broker.dispatch(request, sessionId),
  });
  const internals = backend as any;
  internals.live.set("session-test", { projectRoot: project, cwd });
  bridge = internals.bridge as HostBridge;
  const port = await bridge.listen();
  const sessionCapability = bridge.register("session-test");
  const computerCapability = bridge.registerComputer("session-test");
  const client = (projectRoot = cwd, desktopGrant = computerCapability) => createNativeCuaClient({
    bridgePort: String(port), sessionCapability, sessionKey: "session-test",
    computerCapability: desktopGrant, projectRoot,
  });
  const post = async (action: string, event: Record<string, unknown>, capability = sessionCapability) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, sessionCapability: capability, action, event }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { project, cwd, other, client, post, broker, driver, mint, projectAllows, internals };
}

const mintEvent = (projectRoot: unknown) => ({ extensionId: "cua-extension", permission: "native.exec", projectRoot });
const observe = { action: "computer_runtime_capabilities", protocolVersion: 1 };

describe("host capability grants belong to the authenticated session project, not its worktree", () => {
  it("uses the existing main-project grant for both real client hops without creating worktree grants", async () => {
    const env = await setup();
    const grantFile = join(projectPiAgentDir(env.project), "ext-grants.json");
    const before = await readFile(grantFile, "utf8");
    expect(await env.client().call(observe)).toMatchObject({ ok: true });
    expect(env.driver).toHaveBeenCalledTimes(1);
    expect(env.projectAllows).toHaveBeenCalledTimes(2);
    for (const args of env.projectAllows.mock.calls) expect(args).toEqual(["cua-extension", env.project, "native.exec"]);
    expect(await readFile(grantFile, "utf8")).toBe(before);
    await expect(access(join(projectPiAgentDir(env.cwd), "ext-grants.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await env.client(env.project).call(observe)).toMatchObject({ ok: true });
  });

  it("refuses another project's grants and an unregistered sibling worktree before mint or dispatch", async () => {
    const env = await setup();
    for (const projectRoot of [env.other, join(env.project, ".pi/worktrees/unregistered"), undefined]) {
      for (const action of ["host_capability_token", "host_capability"]) {
        const response = await env.post(action, { ...mintEvent(projectRoot), sessionId: "forged-other-session" });
        expect(response.body).toMatchObject({ ok: false, code: "permission_denied" });
      }
    }
    expect(env.mint).not.toHaveBeenCalled();
    expect(env.projectAllows).not.toHaveBeenCalled();
    expect(env.driver).not.toHaveBeenCalled();
  });

  it("does not bypass revoked project permission or the separate desktop grant", async () => {
    const env = await setup();
    await expect(env.client(env.cwd, "forged-desktop-grant").call(observe)).rejects.toMatchObject({ code: "permission_denied" });
    await writeProjectExtensionGrant(projectPiAgentDir(env.project), "cua-extension", { grantedCapabilities: [], grantedAt: "2026-01-02T00:00:00Z" });
    await expect(env.client().call(observe)).rejects.toThrow("project has not granted");
    expect(env.driver).not.toHaveBeenCalled();
  });

  it("rejects dead/rootless sessions and forged bridge authentication; supports ordinary non-worktree sessions", async () => {
    const env = await setup();
    expect((await env.post("host_capability_token", mintEvent(env.cwd), "forged-session-capability")).status).toBe(403);
    env.internals.live.delete("session-test");
    expect((await env.post("host_capability_token", mintEvent(env.cwd))).body).toMatchObject({ code: "permission_denied" });
    env.internals.live.set("session-test", {});
    expect((await env.post("host_capability_token", mintEvent(undefined))).body).toMatchObject({ code: "permission_denied" });
    expect(env.mint).not.toHaveBeenCalled();
    env.internals.live.set("session-test", { cwd: env.project });
    expect(await env.client(env.project).call(observe)).toMatchObject({ ok: true });
  });
});
