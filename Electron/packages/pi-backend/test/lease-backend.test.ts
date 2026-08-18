import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function eventually(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-lease-backend-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "s1.jsonl"),
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n",
  );
  const children: ChildProcess[] = [];
  const fakePi = new URL("./fake-pi.mjs", import.meta.url).pathname;
  const create = () =>
    createPiHostBackend({
      agentDir,
      sessionsRoot,
      runtimeRoot: root,
      piPath: process.execPath,
      spawn: (_bin, _args, options) => {
        const child = spawn(process.execPath, [fakePi], options);
        children.push(child);
        return child as any;
      },
    });
  return { create, children };
}

describe("PiHostBackend session lease lifetime", () => {
  it("keeps the writer lease after the live Pi exits so another host cannot steal the session", async () => {
    const { create, children } = await fixture();
    const owner = create();
    const spectator = create();
    await owner.handle("sendPrompt", ["s1", "hello"]);
    expect(children).toHaveLength(1);
    const child = children[0]!;
    expect((await owner.handle("getSessionLease", ["s1"])) as { writable: boolean }).toMatchObject({ writable: true });

    child.kill("SIGTERM");
    await eventually(() => child.exitCode !== null || child.signalCode !== null);

    const ownerAfter = (await owner.handle("getSessionLease", ["s1"])) as { writable: boolean; holder?: { holder: string } };
    expect(ownerAfter.writable).toBe(true);
    expect(ownerAfter.holder?.holder).toBe("pipiui-electron");

    const spectatorLease = (await spectator.handle("getSessionLease", ["s1"])) as { writable: boolean };
    expect(spectatorLease.writable).toBe(false);
    await spectator.handle("sendPrompt", ["s1", "stolen"]);
    await eventually(() =>
      ((spectator as any).queue.listQueue("s1") as { state: string; error?: string }[]).some(
        (item) => item.state === "failed" && /session is read-only: held by pipiui-electron/.test(item.error ?? ""),
      ),
    );

    await expect(owner.handle("sendPrompt", ["s1", "still mine"])).resolves.toMatchObject({ outcome: "direct" });
    await spectator.close();
    await owner.close();
  });

  it("does not fail a send that races resumeSession on the same backend", async () => {
    const { create } = await fixture();
    const backend = create();
    const [resumed, sent] = await Promise.all([
      backend.handle("resumeSession", ["s1"]),
      backend.handle("sendPrompt", ["s1", "hello"]),
    ]);
    expect(resumed).toMatchObject({ id: "s1" });
    expect(sent).toMatchObject({ outcome: "direct" });
    await backend.close();
  });
});
