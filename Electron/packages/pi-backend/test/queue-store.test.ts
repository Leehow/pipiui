import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileQueueStore } from "../src/queue-store.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

const item = (state: "queued" | "sending" | "failed", error?: string) => ({
  id: "message-1",
  sessionId: "session/with?characters",
  text: "inspect this",
  attachments: [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "shot.png", width: 800 }],
  createdAt: 1,
  state,
  error,
});

describe("FileQueueStore", () => {
  it("atomically round-trips queued and failed items, preserves attachment fields, and restores sending as queued", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-queue-store-"));
    const store = new FileQueueStore(root);
    const sessionId = "session/with?characters";
    await store.save(sessionId, [item("queued"), item("sending"), { ...item("failed", "rpc failed"), id: "message-3" }]);

    const restored = await store.load(sessionId);
    expect(restored).toEqual([
      expect.objectContaining({ id: "message-1", state: "queued", attachments: [expect.objectContaining({ width: 800, name: "shot.png" })] }),
      expect.objectContaining({ id: "message-1", state: "queued" }),
      expect.objectContaining({ id: "message-3", state: "failed", error: "rpc failed" }),
    ]);
    const names = await readdir(root);
    expect(names).toEqual([`${encodeURIComponent(sessionId)}.json`]);
    expect(names.join(" ")).not.toContain("inspect this");
  });

  it("treats malformed or mismatched persisted data as an empty queue", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-queue-store-invalid-"));
    const store = new FileQueueStore(root);
    const sessionId = "session-1";
    await writeFile(join(root, `${encodeURIComponent(sessionId)}.json`), "not json", "utf8");
    expect(await store.load(sessionId)).toEqual([]);
    await writeFile(join(root, `${encodeURIComponent(sessionId)}.json`), JSON.stringify({ version: 1, sessionId: "other", items: [item("queued")] }), "utf8");
    expect(await store.load(sessionId)).toEqual([]);
  });

  it("removes only the selected session record", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-queue-store-remove-"));
    const store = new FileQueueStore(root);
    await store.save("one", [{ ...item("queued"), id: "one", sessionId: "one" }]);
    await store.save("two", [{ ...item("failed", "no"), id: "two", sessionId: "two" }]);
    await store.remove("one");
    expect(await store.load("one")).toEqual([]);
    expect(await store.load("two")).toMatchObject([expect.objectContaining({ id: "two", state: "failed" })]);
  });
});
