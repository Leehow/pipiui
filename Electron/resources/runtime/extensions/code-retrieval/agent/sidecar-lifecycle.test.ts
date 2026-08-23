import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  attachSidecar,
  defaultIdleMs,
  detachSidecar,
  pidAlive,
  pingSidecar,
  readSidecarSnapshot,
} from "./sidecar-lifecycle.js";

test("seam 2: two sessions reuse one sidecar; idle exit after refcount hits 0", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-side-"));
  const idleMs = 400;
  process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS = String(idleMs);
  try {
    const a = await attachSidecar({ projectRoot: root, sessionId: "A", idleMs });
    assert.ok(a, "first session should spawn sidecar");
    assert.ok(pidAlive(a.pid));
    const snapA = await readSidecarSnapshot(root);
    assert.ok(snapA);
    assert.equal(snapA!.pid, a.pid);
    assert.equal(snapA!.port, a.port);
    assert.ok(snapA!.token);

    const b = await attachSidecar({ projectRoot: root, sessionId: "B", idleMs });
    assert.ok(b, "second session should reuse");
    assert.equal(b.pid, a.pid);
    assert.equal(b.port, a.port);

    const live = await pingSidecar(b);
    assert.ok(live);
    assert.ok((live.refcount ?? 0) >= 2);

    const afterA = await detachSidecar(root, "A");
    assert.ok(pidAlive(a.pid), "must not kill a process others still hold");
    assert.ok((afterA ?? 1) >= 1);

    await detachSidecar(root, "B");
    const deadline = Date.now() + idleMs + 2500;
    while (pidAlive(a.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(pidAlive(a.pid), false, "idle timeout should self-exit after refcount 0");
    const leftover = await readSidecarSnapshot(root);
    if (leftover) {
      assert.equal(pidAlive(leftover.pid), false);
    }
  } finally {
    delete process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS;
    await rm(root, { recursive: true, force: true });
  }
});

test("default idle is a positive timeout", () => {
  delete process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS;
  assert.ok(defaultIdleMs() >= 1000);
});
