import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserInputPriority } from "../src/user-input-priority.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pipi-priority-"));
  roots.push(root);
  return { priority: new UserInputPriority(root), path: (key: string) => join(root, `pipiui-cutin-${key}.json`) };
}

describe("host user input priority marker", () => {
  it("holds queued/sending, clears empty/failed-only, and never writes user text", () => {
    const { priority, path } = fixture();
    priority.bind("ui-id", 1, "spawn-key");
    for (const state of ["queued", "sending"]) {
      priority.update("ui-id", 1, [{ state }]);
      expect(JSON.parse(readFileSync(path("spawn-key"), "utf8"))).toEqual({
        at: expect.any(Number), pendingUserInput: true, ownerPid: process.pid, owner: expect.any(String),
      });
    }
    priority.update("ui-id", 1, [{ state: "failed" }]);
    expect(existsSync(path("spawn-key"))).toBe(false);
    priority.update("ui-id", 1, [{ state: "queued" }, { state: "failed" }]);
    expect(existsSync(path("spawn-key"))).toBe(true);
    priority.update("ui-id", 1, []);
    expect(existsSync(path("spawn-key"))).toBe(false);
    expect(existsSync(path("ui-id"))).toBe(false);
  });

  it("isolates bindings and rejects stale lifecycle cleanup and updates", () => {
    const { priority, path } = fixture();
    priority.bind("a", 1, "key-a");
    priority.bind("b", 2, "key-b");
    priority.update("a", 1, [{ state: "queued" }]);
    priority.update("b", 2, [{ state: "sending" }]);
    priority.bind("a", 3, "key-a");
    priority.update("a", 3, [{ state: "queued" }]);
    const current = readFileSync(path("key-a"), "utf8");
    priority.update("a", 1, []);
    priority.dispose("a", 1);
    expect(readFileSync(path("key-a"), "utf8")).toBe(current);
    priority.dispose("a", 3);
    expect(existsSync(path("key-a"))).toBe(false);
    expect(existsSync(path("key-b"))).toBe(true);
    priority.dispose("b", 2);
    expect(existsSync(path("key-b"))).toBe(false);
  });

  it("does not delete a legacy marker or another host's replacement", () => {
    const { priority, path } = fixture();
    priority.bind("a", 1, "key");
    for (const marker of [{ at: Date.now() }, { at: Date.now(), pendingUserInput: true, ownerPid: process.pid, owner: "another-host" }]) {
      priority.update("a", 1, [{ state: "queued" }]);
      writeFileSync(path("key"), JSON.stringify(marker));
      priority.update("a", 1, []);
      expect(JSON.parse(readFileSync(path("key"), "utf8"))).toEqual(marker);
    }
    priority.dispose("a", 1);
    expect(existsSync(path("key"))).toBe(true);
  });

  it("does not infer a missing spawn key from the UI session id", () => {
    const { priority, path } = fixture();
    priority.bind("ui-id", 1, undefined);
    priority.update("ui-id", 1, [{ state: "queued" }]);
    expect(existsSync(path("ui-id"))).toBe(false);
  });
});
