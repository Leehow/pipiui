import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STICK_THRESHOLD_PX,
  canSendPrompt,
  composerActionMode,
  isNearBottom,
} from "../src/chat-ui.js";

test("isNearBottom: at exact bottom", () => {
  assert.equal(isNearBottom(100, 400, 500), true);
});

test("isNearBottom: within default threshold", () => {
  assert.equal(isNearBottom(100, 400, 500 + STICK_THRESHOLD_PX), true);
  assert.equal(isNearBottom(100, 400, 500 + STICK_THRESHOLD_PX - 1), true);
});

test("isNearBottom: just beyond threshold is not near", () => {
  assert.equal(isNearBottom(100, 400, 500 + STICK_THRESHOLD_PX + 1), false);
});

test("isNearBottom: scrolled far up", () => {
  assert.equal(isNearBottom(0, 400, 2000), false);
});

test("isNearBottom: custom threshold", () => {
  assert.equal(isNearBottom(0, 100, 150, 50), true);
  assert.equal(isNearBottom(0, 100, 151, 50), false);
});

test("composerActionMode: idle → send", () => {
  assert.equal(composerActionMode(null), "send");
  assert.equal(composerActionMode(undefined), "send");
  assert.equal(composerActionMode({}), "send");
  assert.equal(composerActionMode({ isGenerating: false, isStopping: false }), "send");
});

test("composerActionMode: generating or stopping → stop", () => {
  assert.equal(composerActionMode({ isGenerating: true }), "stop");
  assert.equal(composerActionMode({ isStopping: true }), "stop");
  assert.equal(composerActionMode({ isGenerating: true, isStopping: true }), "stop");
});

test("canSendPrompt: requires connected session non-empty alive and not sending", () => {
  const base = {
    connected: true,
    hasSession: true,
    text: "hi",
    processAlive: true,
    sending: false,
  };
  assert.equal(canSendPrompt(base), true);
  assert.equal(canSendPrompt({ ...base, connected: false }), false);
  assert.equal(canSendPrompt({ ...base, hasSession: false }), false);
  assert.equal(canSendPrompt({ ...base, text: "   " }), false);
  assert.equal(canSendPrompt({ ...base, processAlive: false }), false);
  assert.equal(canSendPrompt({ ...base, processAlive: undefined }), false);
  assert.equal(canSendPrompt({ ...base, sending: true }), false);
});
