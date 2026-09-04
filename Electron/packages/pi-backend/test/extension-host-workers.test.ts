import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionHostWorkers, type HostWorkerEvent } from "../src/extension-host-workers.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

class FakeChild extends EventEmitter {
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
}

async function workerEntry(name = "worker.js"): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pipiui-worker-"));
  const entry = join(root, name);
  await writeFile(entry, "// worker\n");
  return entry;
}

function harness() {
  const children: FakeChild[] = [];
  const events: HostWorkerEvent[] = [];
  const spawnImpl = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child as never;
  });
  const workers = createExtensionHostWorkers({ spawnImpl: spawnImpl as never, onEvent: e => events.push(e) });
  return { workers, children, events, spawnImpl };
}

describe("host workers", () => {
  it("starts one worker per declared, enabled extension", async () => {
    const entry = await workerEntry();
    const { workers, spawnImpl, events } = harness();
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: root }]);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(workers.list()).toEqual(["probe"]);
    expect(events[0]).toMatchObject({ type: "started", extensionId: "probe" });
  });

  it("runs the child as Node, never as another copy of the app", async () => {
    // Electron 里 process.execPath 是应用自己的二进制。少了这个开关，spawn 出来的是又一个
    // 完整 app，它再起自己的 worker——指数级繁殖。这条断言是防止那次事故重演的锁。
    const entry = await workerEntry();
    const { workers, spawnImpl } = harness();
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: root }]);
    const options = spawnImpl.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(options.env.PIPIUI_PROJECT_ROOT).toBe(root);
  });

  it("is idempotent: a rescan that changes nothing spawns nothing", async () => {
    const entry = await workerEntry();
    const { workers, spawnImpl } = harness();
    const spec = [{ extensionId: "probe", entry, projectRoot: root }];
    workers.reconcile(spec);
    workers.reconcile(spec);
    workers.reconcile(spec);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("stops a worker whose extension is no longer wanted", async () => {
    const entry = await workerEntry();
    const { workers, children } = harness();
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: root }]);
    workers.reconcile([]);
    expect(children[0].killed).toBe(true);
    expect(workers.list()).toEqual([]);
  });

  it("restarts a worker when the project changes", async () => {
    const entry = await workerEntry();
    const { workers, spawnImpl } = harness();
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: root }]);
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: join(root, "other") }]);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a missing entry instead of spawning", async () => {
    const { workers, spawnImpl, events } = harness();
    workers.reconcile([{ extensionId: "probe", entry: "/nope/worker.js", projectRoot: "/tmp" }]);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("restarts a crashed worker, then gives up on one that never stays up", async () => {
    const entry = await workerEntry();
    const { workers, children, events } = harness();
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: root }]);
    for (let i = 0; i < 5; i += 1) children[children.length - 1].emit("exit", 1);
    // 1 次首启 + 3 次重启后放弃：起来就死的 worker 是坏的，不是需要重启的。
    expect(children.length).toBe(4);
    expect(events.some(e => e.type === "error" && /not restarting/.test(e.message))).toBe(true);
    expect(workers.list()).toEqual([]);
  });

  it("never manages workers from inside a worker", async () => {
    // 递归在这里不是慢性泄漏而是 fork 炸弹：一次错误的 spawn 会生出一个重复同样错误的孩子。
    const entry = await workerEntry();
    const children: FakeChild[] = [];
    const spawnImpl = vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child as never;
    });
    const workers = createExtensionHostWorkers({
      spawnImpl: spawnImpl as never,
      env: { PIPIUI_EXTENSION_ID: "probe" } as NodeJS.ProcessEnv,
    });
    workers.reconcile([{ extensionId: "probe", entry, projectRoot: root }]);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(workers.list()).toEqual([]);
  });

  it("stopAll leaves nothing running", async () => {
    const entry = await workerEntry();
    const { workers, children } = harness();
    workers.reconcile([
      { extensionId: "a", entry, projectRoot: root },
      { extensionId: "b", entry, projectRoot: root },
    ]);
    workers.stopAll();
    expect(children.every(child => child.killed)).toBe(true);
    expect(workers.list()).toEqual([]);
  });
});
