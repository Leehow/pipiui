// Unit tests for the OAuth auth_url browser launcher.
//
// Why a Node test and not swift test: the launcher lives in
// `pi-auth-open-url.mjs` (ECMAScript module consumed by `node`), which the
// Swift test target cannot import or execute. We instead drive it with Node's
// built-in test runner using an injected fake `spawn`, so the behaviour is
// asserted deterministically without opening a real browser or needing a live
// OAuth provider.
//
// Run:  node --test Tests/Node/test-open-url.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openURL } from "../../Sources/PipiUI/Resources/pi-auth-open-url.mjs";

/** A spawn stub that records calls and returns an EventEmitter-based child. */
function recording_spawn(log) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.unref = () => {
      child.__unrefed = true;
    };
    const on = child.on.bind(child);
    child.on = (ev, fn) => {
      log.onEvents.push(ev);
      return on(ev, fn);
    };
    log.spawned.push({ cmd, args, opts });
    return child;
  };
}

test("darwin: launches auth_url via the absolute /usr/bin/open, detached, stdio ignored", () => {
  const log = { spawned: [], onEvents: [] };
  openURL("https://auth.example/cb?code=abc", {
    spawn: recording_spawn(log),
    platform: "darwin",
  });
  assert.equal(log.spawned.length, 1);
  assert.equal(log.spawned[0].cmd, "/usr/bin/open");
  assert.deepEqual(log.spawned[0].args, ["https://auth.example/cb?code=abc"]);
  assert.equal(log.spawned[0].opts.detached, true);
  assert.equal(log.spawned[0].opts.stdio, "ignore");
});

test("attaches an 'error' listener so a launcher failure cannot become uncaught", () => {
  const log = { spawned: [], onEvents: [] };
  openURL("https://auth.example/cb", { spawn: recording_spawn(log), platform: "darwin" });
  assert.ok(
    log.onEvents.includes("error"),
    "openURL must attach an 'error' listener to the spawned child"
  );
});

test("unrefs the child so the helper can exit independently of the launcher", () => {
  const child = openURL("https://auth.example/cb", {
    spawn: recording_spawn({ spawned: [], onEvents: [] }),
    platform: "darwin",
  });
  assert.equal(child.__unrefed, true);
});

test("an asynchronous launcher 'error' event is absorbed (no throw, no rejection)", async () => {
  // Simulate spawn ENOENT: the child emits 'error' on the next tick. Without an
  // 'error' listener this would become an uncaughtException and crash the host.
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => child.emit("error", new Error("spawn ENOENT")));
    return child;
  };
  // Must not throw synchronously...
  assert.doesNotThrow(() =>
    openURL("https://auth.example/cb", { spawn: fakeSpawn, platform: "darwin" })
  );
  // ...nor surface as an unhandled rejection / uncaught exception afterwards.
  await new Promise((r) => setImmediate(r));
});

test("a synchronous spawn throw is swallowed (never propagates to the login promise)", () => {
  const throwingSpawn = () => {
    throw new Error("spawn blew up");
  };
  assert.doesNotThrow(() =>
    openURL("https://auth.example/cb", { spawn: throwingSpawn, platform: "darwin" })
  );
});
