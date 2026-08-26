import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BOSS_DESKTOP_GRANT_VALUES,
  DIRECT_DRIVE_ERROR,
  createBossDesktopDirectDrive,
  formatDirectDriveToolResult,
  isComputerTaskDirectDrive,
  resolveBossDesktopGrant,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/direct-drive.ts";
import {
  ComputerWorkerBroker,
  grantsForComputerRole,
  isHostPacedDesktopRole,
} from "../../Electron/resources/runtime/pi-ext/packages/computer-agent/src/worker-broker.ts";
import { DESKTOP_GRANT_VALUES } from "../../Electron/resources/runtime/pi-ext/subagent/desktop-tool-policy.mjs";

function fakeBroker(runtime) {
  const inner = new ComputerWorkerBroker({
    request: runtime,
    tokenFactory: () => "b".repeat(48),
  });
  return {
    issue: (input) => inner.issue(input),
    execute: (token, request, signal) => inner.execute(token, request, signal),
    revokeTask: (taskId) => inner.revokeTask(taskId),
    inner,
  };
}

test("goal-only computer_task stays on the legacy path", () => {
  assert.equal(isComputerTaskDirectDrive({ goal: "Open TextEdit" }), false);
  assert.equal(isComputerTaskDirectDrive({}), false);
  assert.equal(isComputerTaskDirectDrive({ desktop: "user-requested" }), true);
  assert.equal(isComputerTaskDirectDrive({ sessionId: "desktop-1" }), true);
  assert.equal(isComputerTaskDirectDrive({ action: "observe" }), true);
});

test("direct-drive grant values stay aligned with the desktop per-task policy", () => {
  assert.deepEqual([...BOSS_DESKTOP_GRANT_VALUES], [...DESKTOP_GRANT_VALUES]);
  assert.deepEqual(grantsForComputerRole("boss-direct"), ["observe", "mutate", "openApplication"]);
  assert.equal(isHostPacedDesktopRole("boss-direct"), true);
  assert.equal(isHostPacedDesktopRole("gui-operator"), false);
});

test("opening a session without a grant is rejected and does not issue a broker token", async () => {
  let issued = 0;
  const drive = createBossDesktopDirectDrive({
    acquireBroker: async () => {
      issued += 1;
      return fakeBroker(async () => ({ ok: true }));
    },
  });
  const missing = resolveBossDesktopGrant({ desktop: undefined, hostAvailable: true });
  assert.equal(missing.granted, false);
  assert.equal(missing.code, DIRECT_DRIVE_ERROR.grantRequired);

  const denied = await drive.execute({ action: "session", goal: "click the button" }, { hostAvailable: true });
  assert.equal(denied.spawnedLeader, false);
  assert.equal(denied.sessionId, "");
  assert.equal(denied.action.type, "session");
  assert.equal(denied.observation, null);
  assert.equal(denied.screenChanged, null);
  assert.match(denied.error, /desktop_grant_required/);
  assert.equal(denied.code, DIRECT_DRIVE_ERROR.grantRequired);
  assert.equal(issued, 0);

  const unavailable = await drive.execute(
    { action: "session", desktop: "user-requested" },
    { hostAvailable: false },
  );
  assert.equal(unavailable.code, DIRECT_DRIVE_ERROR.grantUnavailable);
  assert.match(unavailable.error, /desktop_grant_unavailable/);
  assert.equal(issued, 0);

  const invalid = await drive.execute({ desktop: "please" }, { hostAvailable: true });
  assert.equal(invalid.code, DIRECT_DRIVE_ERROR.grantInvalid);
  assert.equal(issued, 0);
});

test("opening a session requires a caller-chosen semantic sessionId; nothing is generated", async () => {
  let issued = 0;
  const drive = createBossDesktopDirectDrive({
    acquireBroker: async () => {
      issued += 1;
      return fakeBroker(async () => ({ ok: true }));
    },
    randomId: () => "should-never-become-a-session-id",
  });

  const missing = await drive.execute(
    { action: "session", desktop: "user-requested", goal: "drive TextEdit" },
    { hostAvailable: true },
  );
  assert.equal(missing.code, DIRECT_DRIVE_ERROR.sessionIdRequired);
  assert.match(missing.error, /desktop_session_id_required/);
  assert.equal(missing.sessionId, "");
  assert.equal(issued, 0, "no broker token may be issued before the session id is valid");

  // Charset/shape violations only: a caller-provided id that merely LOOKS generated (hex
  // slug) is shape-legal — the contract forbids the runtime generating ids, not hex shapes.
  for (const bad of ["TextEdit Drive", "x", "way-too-long-semantic-session-id", "-leading-dash"]) {
    const invalidId = await drive.execute(
      { action: "session", desktop: "user-requested", sessionId: bad },
      { hostAvailable: true },
    );
    assert.equal(invalidId.code, DIRECT_DRIVE_ERROR.sessionIdInvalid, `sessionId=${bad} must be rejected`);
    assert.match(invalidId.error, /desktop_session_id_invalid/);
    assert.equal(issued, 0);
  }
});

test("Boss-direct screenshot/action loop reuses the broker and never marks a Leader spawn", async () => {
  const calls = [];
  const drive = createBossDesktopDirectDrive({
    acquireBroker: async () => fakeBroker(async (request) => {
      calls.push(request);
      const visible = request.action === "computer_batch" && Array.isArray(request.actions) && request.actions.some((item) => item.type === "click")
        ? "after"
        : "before";
      return {
        ok: true,
        action: request.action,
        observationId: `obs-${calls.length}`,
        visibleText: [visible],
        screenshotBase64: "aaa",
      };
    }),
    randomId: () => "fixed-id",
  });

  const opened = await drive.execute(
    { desktop: "user-requested", sessionId: "textedit-drive", goal: "drive TextEdit" },
    { hostAvailable: true },
  );
  assert.equal(opened.spawnedLeader, false);
  assert.equal(opened.sessionId, "textedit-drive");
  assert.deepEqual(opened.action, { type: "session", desktop: "user-requested" });
  assert.equal(opened.error, null);
  assert.equal(opened.screenChanged, null);
  assert.equal("expectedEffect" in opened, false);
  assert.equal(calls.length, 0);

  // Re-opening with the same semantic id resumes the same session instead of issuing a new one.
  const resumed = await drive.execute(
    { desktop: "user-requested", sessionId: "textedit-drive" },
    { hostAvailable: true },
  );
  assert.deepEqual(resumed.action, { type: "session", desktop: "user-requested", resumed: true });
  assert.equal(resumed.sessionId, "textedit-drive");
  assert.equal(calls.length, 0);

  const observed = await drive.execute(
    { sessionId: opened.sessionId, action: "observe" },
    { hostAvailable: true },
  );
  assert.equal(observed.spawnedLeader, false);
  assert.equal(observed.action.type, "observe");
  assert.deepEqual(observed.observation.visibleText, ["before"]);
  assert.equal(observed.screenChanged, null);
  assert.equal(observed.error, null);
  assert.equal(calls[0].action, "computer_batch");
  assert.deepEqual(calls[0].actions, [{ type: "screenshot" }]);
  assert.equal(calls[0].taskId.startsWith("boss-direct-"), true);

  const acted = await drive.execute({
    sessionId: opened.sessionId,
    action: "act",
    actions: [{ type: "click", x: 12, y: 40 }],
    expectedEffect: { kind: "visible_text", contains: "after" },
  }, { hostAvailable: true });
  assert.equal(acted.spawnedLeader, false);
  assert.equal(acted.action.type, "act");
  assert.deepEqual(acted.action.actions, [{ type: "click", x: 12, y: 40 }]);
  assert.deepEqual(acted.observation.visibleText, ["after"]);
  assert.equal(acted.screenChanged, true);
  assert.equal(acted.error, null);
  assert.deepEqual(acted.expectedEffect, { kind: "visible_text", contains: "after" });
  assert.equal(calls[1].action, "computer_batch");
  assert.deepEqual(calls[1].actions, [{ type: "click", x: 12, y: 40 }]);

  const formatted = formatDirectDriveToolResult(acted);
  assert.equal(formatted.details.observation.screenshotBase64, undefined);
  assert.equal(formatted.content[1].type, "image");
  assert.equal(formatted.details.spawnedLeader, false);
  for (const key of ["action", "observation", "screenChanged", "error"]) {
    assert.equal(key in formatted.details, true);
  }

  const unchanged = await drive.execute({
    sessionId: opened.sessionId,
    action: "act",
    actions: [{ type: "click", x: 12, y: 40 }],
  }, { hostAvailable: true });
  assert.equal(unchanged.screenChanged, false);

  const closed = await drive.execute({ sessionId: opened.sessionId, action: "close" }, { hostAvailable: true });
  assert.equal(closed.action.type, "close");
  const missing = await drive.execute({ sessionId: opened.sessionId, action: "observe" }, { hostAvailable: true });
  assert.equal(missing.code, DIRECT_DRIVE_ERROR.sessionUnknown);

  const unsupported = await drive.execute({ action: "explode", desktop: "user-requested" }, { hostAvailable: true });
  assert.equal(unsupported.code, DIRECT_DRIVE_ERROR.unsupportedAction);
});

test("boss-direct broker role can observe repeatedly without the legacy worker fence", async () => {
  const broker = new ComputerWorkerBroker({
    request: async (request) => ({ ok: true, action: request.action, observationId: "obs" }),
    tokenFactory: () => "c".repeat(48),
  });
  const issued = broker.issue({ taskId: "t", stepId: "s", runId: "r", role: "boss-direct" });
  for (let i = 0; i < 5; i += 1) {
    const observed = await broker.execute(issued.token, { operation: "observe", payload: { fresh: true } });
    assert.equal(observed.ok, true);
  }
});

test("registerComputerTaskTool is Boss-direct only and never starts Leader or a long Computer Use Agent", async () => {
  const source = await readFile(new URL("../../Electron/resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("function registerComputerTaskTool");
  const end = source.indexOf("function registerLedgerNoteTool", start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /createBossDesktopDirectDrive/);
  assert.match(body, /formatDirectDriveToolResult/);
  assert.match(body, /stepFromDirectDriveResult/);
  assert.match(body, /createDirectDriveStuckGuard/);
  assert.match(body, /adviseFromDirectDriveResult/);
  assert.match(body, /computer_task_leader_retired/);
  assert.doesNotMatch(body, /withDirectDriveStuckGuard/);
  assert.doesNotMatch(body, /runRegisteredComputerTaskLifecycle/);
  assert.doesNotMatch(body, /role: "computer-use-agent"/);
  assert.doesNotMatch(body, /ComputerAgentCoordinator/);
  assert.doesNotMatch(body, /computer-use-leader/);
});
