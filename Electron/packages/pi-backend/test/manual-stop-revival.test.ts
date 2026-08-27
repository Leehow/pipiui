import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

/** Same harness as queue-backend.test.ts; sessions s1 and s2 exist. */
async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-manual-stop-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  for (const id of ["s1", "s2"]) {
    await writeFile(join(directory, `${id}.jsonl`), JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
  }
  const create = () => createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
  });
  return { agentDir, settingsFile: join(agentDir, "pipiui-settings.json"), create };
}

describe("manual stop / archive revival suppression (host level)", () => {
  it("persists a user Stop across restart and holds restored items from every automatic drain until an explicit send", async () => {
    const setup = await fixture();
    const first = setup.create();
    await first.handle("sendPrompt", ["s1", "__hold__"]);
    const item = await first.handle("enqueueMessage", ["s1", "survive stop"]) as any;
    await first.handle("stop", ["s1"]);
    // A stopped turn settles idle with the payload queued...
    await eventually(() => !(first as any).queue.isBusy("s1"));
    expect(await first.handle("listQueue", ["s1"])).toMatchObject([
      expect.objectContaining({ text: "survive stop", state: "queued" }),
    ]);
    // ...and nothing automatic delivers it afterwards.
    await (first as any).queueIdle("s1");
    await (first as any).queue.notifyIdle("s1");
    expect((await first.handle("listQueue", ["s1"]) as any[]).map(i => i.text)).toEqual(["survive stop"]);

    // The Stop marker is durable in pipiui-settings.json (written in the
    // background, so poll for it rather than assuming a finished write).
    await eventually(async () => {
      try {
        const persisted = JSON.parse(await readFile(setup.settingsFile, "utf8"));
        return Array.isArray(persisted.sessionManualStopIds) && persisted.sessionManualStopIds.includes("s1");
      } catch {
        return false;
      }
    });
    await first.close();

    // Restart: restoreQueue resurrects the payload but must not re-arm drains.
    const second = setup.create();
    expect(await second.handle("listQueue", ["s1"])).toMatchObject([
      expect.objectContaining({ id: item.message.id, text: "survive stop", state: "queued" }),
    ]);
    await (second as any).queueIdle("s1");
    await (second as any).queue.notifyIdle("s1");
    expect((await second.handle("listQueue", ["s1"]) as any[]).map(i => i.text)).toEqual(["survive stop"]);

    // An explicit user send lifts suppression: cut-in re-engages delivery.
    await second.handle("cutInQueuedMessage", ["s1", item.message.id]);
    await eventually(() => (second as any).queue.listQueue("s1").length === 0);
    // And the cleared marker is persisted too.
    await eventually(async () => {
      const raw = JSON.parse(await readFile(setup.settingsFile, "utf8"));
      return Array.isArray(raw.sessionManualStopIds) && !raw.sessionManualStopIds.includes("s1");
    });
    await second.close();
  });

  it("archive-only sessions stay dead: restores hold through every automatic chain and conversation is refused until unarchive", async () => {
    const setup = await fixture();
    const boot = setup.create();
    await boot.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: [],
      archivedSessionIds: ["s2"],
      orderedSessionIds: [],
    }]);
    await boot.close();

    // Restart: a crash-world `sending` leftover restores to queued but every
    // automatic chain must hold it — idle drain, watchdog re-idle, busy cycle.
    const second = setup.create();
    await (second as any).queueStore.save("s2", [
      { id: "leftover-1", sessionId: "s2", text: "archived leftover", attachments: [], createdAt: 1, state: "sending" },
    ]);
    await (second as any).queueIdle("s2");
    await (second as any).queue.notifyIdle("s2");
    (second as any).queue.markBusy("s2");
    await (second as any).queue.notifyIdle("s2");
    expect((await second.handle("listQueue", ["s2"]) as any[]).map(i => i.text)).toEqual(["archived leftover"]);
    expect(((await second.handle("listQueue", ["s2"]) as any[])[0]).state).toBe("queued");

    // Opening/conversing with the archived session never respawns pi:
    // send/enqueue/follow-up/steer/cut-in/retry all demand an unarchive first.
    for (const attempt of [
      () => second.handle("sendPrompt", ["s2", "hello"]),
      () => second.handle("enqueueMessage", ["s2", "hi"]),
      () => second.handle("queueFollowUp", ["s2", "f"]),
      () => second.handle("steerQueuedMessage", ["s2", "leftover-1"]),
      () => second.handle("retryQueuedMessage", ["s2", "leftover-1"]),
    ]) {
      await expect(attempt()).rejects.toThrow(/归档/);
    }
    expect((await second.handle("listQueue", ["s2"]) as any[]).map(i => i.text)).toEqual(["archived leftover"]);

    // Explicit unarchive is the only exit from archive-death.
    await second.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: [],
      archivedSessionIds: [],
      orderedSessionIds: [],
    }]);
    expect((second as any).autoRevivalSuppressed("s2")).toBe(false);
    await second.handle("cutInQueuedMessage", ["s2", "leftover-1"]);
    await eventually(() => (second as any).queue.listQueue("s2").length === 0);
    await second.close();
  });

  it("archiving a live session kills its process and keeps it dead until unarchive", async () => {
    const setup = await fixture();
    const backend = setup.create();
    const statuses: any[] = [];
    const off = backend.subscribe(frame => { const wrapper = frame as any; const e = wrapper?.event as any; if (wrapper?.channel === "stream" && e?.type === "status" && e.sessionId === "s1") statuses.push(e); });
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    const b = backend as any;
    await eventually(() => !!b.live.get("s1"));
    const pid = b.live.get("s1").process.pid as number;
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    expect(alive()).toBe(true);

    // The UI's one and only archive channel: setSidebarSessionPreferences.
    await backend.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: [],
      archivedSessionIds: ["s1"],
      orderedSessionIds: [],
    }]);
    // The running pi child is torn down and the UI sees the terminal stop.
    await eventually(() => !alive());
    await eventually(() => statuses.some(e => e.status === "stopped"));
    // Talking again is refused without an implicit respawn.
    await expect(backend.handle("sendPrompt", ["s1", "hello again"])).rejects.toThrow(/归档/);
    expect(b.live.get("s1")).toBeUndefined();

    // Explicit unarchive restores normal conversation.
    await backend.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: [],
      archivedSessionIds: [],
      orderedSessionIds: [],
    }]);
    expect((b.autoRevivalSuppressed("s1"))).toBe(false);
    await backend.handle("sendPrompt", ["s1", "revived by explicit unarchive"]);
    off();
    await backend.close();
  });
});
