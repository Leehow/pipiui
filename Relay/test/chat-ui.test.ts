import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STICK_THRESHOLD_PX,
  canSendPrompt,
  composerActionMode,
  composerButtons,
  draftFromQueueRestore,
  isNearBottom,
  mergeRestoredDraft,
  normalizeQueue,
  queueItemSummary,
  queueSourceKey,
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

test("composerButtons: idle always shows send, never stop", () => {
  assert.deepEqual(composerButtons({ hasText: false }), { showSend: true, showStop: false });
  assert.deepEqual(composerButtons({ hasText: true }), { showSend: true, showStop: false });
  assert.deepEqual(
    composerButtons({ isGenerating: false, isStopping: false, hasText: true }),
    { showSend: true, showStop: false },
  );
});

test("composerButtons: busy + text → send and stop", () => {
  assert.deepEqual(
    composerButtons({ isGenerating: true, hasText: true }),
    { showSend: true, showStop: true },
  );
  assert.deepEqual(
    composerButtons({ isStopping: true, hasText: true }),
    { showSend: true, showStop: true },
  );
});

test("composerButtons: busy + empty → stop only", () => {
  assert.deepEqual(
    composerButtons({ isGenerating: true, hasText: false }),
    { showSend: false, showStop: true },
  );
  assert.deepEqual(
    composerButtons({ isStopping: true, hasText: false }),
    { showSend: false, showStop: true },
  );
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

test("normalizeQueue: missing or invalid → empty", () => {
  assert.deepEqual(normalizeQueue(null), []);
  assert.deepEqual(normalizeQueue(undefined), []);
  assert.deepEqual(normalizeQueue({}), []);
  assert.deepEqual(normalizeQueue({ queue: null }), []);
  assert.deepEqual(normalizeQueue({ queue: "x" }), []);
  assert.deepEqual(normalizeQueue({ queue: [{}, null, 1, { id: 3, text: 4 }] }), [
    { id: "q-0", text: "" },
    { id: "q-3", text: "" },
  ]);
});

test("normalizeQueue: keeps id/text and fills missing id", () => {
  assert.deepEqual(
    normalizeQueue({
      queue: [
        { id: "a", text: "one" },
        { text: "two" },
        { id: "", text: "three" },
      ],
    }),
    [
      { id: "a", text: "one" },
      { id: "q-1", text: "two" },
      { id: "q-2", text: "three" },
    ],
  );
});

test("queueItemSummary: first line + truncate", () => {
  assert.equal(queueItemSummary(""), "(空)");
  assert.equal(queueItemSummary("  \nhello"), "(空)");
  assert.equal(queueItemSummary("hello\nworld"), "hello");
  assert.equal(queueItemSummary("a".repeat(10), 8), "aaaaaaaa…");
  assert.equal(queueItemSummary("short", 48), "short");
});

test("draftFromQueueRestore: prefers response text fields then queue join", () => {
  const fallback = [
    { id: "1", text: " first " },
    { id: "2", text: "" },
    { id: "3", text: "second" },
  ];
  assert.equal(draftFromQueueRestore({ text: "from-host" }, fallback), "from-host");
  assert.equal(draftFromQueueRestore({ draft: "d" }, fallback), "d");
  assert.equal(draftFromQueueRestore({ draftText: "dt" }, fallback), "dt");
  assert.equal(draftFromQueueRestore({}, fallback), "first\n\nsecond");
  assert.equal(draftFromQueueRestore(null, fallback), "first\n\nsecond");
});

test("mergeRestoredDraft: empty current / empty restored / both", () => {
  assert.equal(mergeRestoredDraft("", "restored"), "restored");
  assert.equal(mergeRestoredDraft("   ", "restored"), "restored");
  assert.equal(mergeRestoredDraft("keep", ""), "keep");
  assert.equal(mergeRestoredDraft("a", "b"), "a\n\nb");
  assert.equal(mergeRestoredDraft("a  ", "  b"), "a\n\nb");
});

test("queueSourceKey: stable fingerprint", () => {
  assert.equal(
    queueSourceKey([{ id: "a", text: "t" }, { id: "b", text: "u" }]),
    "a\0t\nb\0u",
  );
  assert.notEqual(
    queueSourceKey([{ id: "a", text: "t" }]),
    queueSourceKey([{ id: "a", text: "x" }]),
  );
});
