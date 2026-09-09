import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FORK_SCRATCH_KEEP,
	OMITTED_REASONING_TEXT,
	formatForkSanitizedLine,
	isAnthropicAssistantMessage,
	isAnthropicModelRef,
	isSignedThinkingBlock,
	prepareSanitizedForkSource,
	pruneForkScratch,
	sanitizeForkLines,
} from "../fork-sanitize.ts";

function entry(id: string, parentId: string | null, message: Record<string, unknown>): string {
	return JSON.stringify({ type: "message", id, parentId, timestamp: "2026-09-09T00:00:00.000Z", message });
}

const anthropicHeader = { role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "claude-sonnet-4-5" };

test("block and message classification", () => {
	assert.equal(isSignedThinkingBlock({ type: "thinking", thinking: "x", thinkingSignature: "sig" }), true);
	assert.equal(isSignedThinkingBlock({ type: "thinking", thinking: "x", redacted: true, thinkingSignature: "enc" }), true);
	assert.equal(isSignedThinkingBlock({ type: "redacted_thinking", data: "enc" }), true);
	assert.equal(isSignedThinkingBlock({ type: "thinking", thinking: "unsigned" }), false);
	assert.equal(isSignedThinkingBlock({ type: "thinking", thinking: "x", thinkingSignature: "" }), false);
	assert.equal(isSignedThinkingBlock({ type: "text", text: "t" }), false);
	assert.equal(isSignedThinkingBlock(null), false);
	assert.equal(isAnthropicAssistantMessage(anthropicHeader), true);
	assert.equal(isAnthropicAssistantMessage({ role: "assistant", provider: "openai", api: "openai-responses", model: "gpt-5.6" }), false);
	assert.equal(isAnthropicAssistantMessage({ role: "assistant", provider: "custom", api: "openai-completions", model: "anthropic/claude-opus-5" }), true);
	assert.equal(isAnthropicAssistantMessage({ role: "user", provider: "anthropic" }), false);
	assert.equal(isAnthropicModelRef("anthropic/claude-sonnet-4-5"), true);
	assert.equal(isAnthropicModelRef("Anthropic/claude-opus-5:high"), true);
	assert.equal(isAnthropicModelRef("xai/grok-4.5"), false);
	assert.equal(isAnthropicModelRef(undefined), false);
});

test("sanitizeForkLines strips only signed Anthropic thinking and keeps ids, parents, and other entries verbatim", () => {
	const header = JSON.stringify({ type: "session", id: "s1", cwd: "/repo" });
	const user = entry("u1", null, { role: "user", content: "hello" });
	const mixed = entry("a1", "u1", {
		...anthropicHeader,
		content: [
			{ type: "thinking", thinking: "secret", thinkingSignature: "sig1" },
			{ type: "text", text: "visible" },
			{ type: "toolCall", id: "t1", name: "read", arguments: { path: "x" } },
		],
	});
	const onlyThinking = entry("a2", "a1", { ...anthropicHeader, content: [{ type: "thinking", thinking: "only", thinkingSignature: "sig2" }] });
	const openai = entry("a3", "a2", { role: "assistant", provider: "openai", api: "openai-responses", model: "gpt-5.6", content: [{ type: "thinking", thinking: "keep", thinkingSignature: "rs_abc" }, { type: "text", text: "ok" }] });
	const unsigned = entry("a4", "a3", { ...anthropicHeader, content: [{ type: "thinking", thinking: "unsigned" }, { type: "text", text: "fine" }] });
	const outcome = sanitizeForkLines([header, user, mixed, onlyThinking, openai, unsigned, ""]);
	assert.ok(outcome);
	assert.equal(outcome.removedBlocks, 2);
	assert.equal(outcome.touchedMessages, 2);
	assert.equal(outcome.placeholders, 1);
	assert.equal(outcome.lines.length, 7);
	assert.equal(outcome.lines[0], header);
	assert.equal(outcome.lines[1], user);
	assert.equal(outcome.lines[4], openai, "non-Anthropic messages are untouched byte-for-byte");
	assert.equal(outcome.lines[5], unsigned, "unsigned Anthropic thinking stays");
	assert.equal(outcome.lines[6], "");
	const rewritten = JSON.parse(outcome.lines[2]);
	assert.equal(rewritten.id, "a1");
	assert.equal(rewritten.parentId, "u1");
	assert.deepEqual(rewritten.message.content.map((block: { type: string }) => block.type), ["text", "toolCall"]);
	assert.equal(rewritten.message.provider, "anthropic");
	const placeholder = JSON.parse(outcome.lines[3]);
	assert.equal(placeholder.id, "a2");
	assert.equal(placeholder.parentId, "a1");
	assert.deepEqual(placeholder.message.content, [{ type: "text", text: OMITTED_REASONING_TEXT }]);
});

test("a non-JSON line aborts sanitizing rather than rewriting half a file", () => {
	assert.equal(sanitizeForkLines([entry("a1", null, { ...anthropicHeader, content: [{ type: "thinking", thinking: "x", thinkingSignature: "s" }] }), "{not json"]), undefined);
});

test("prepareSanitizedForkSource writes a copy only when needed and preserves the trailing newline", () => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-fork-sanitize-"));
	const source = join(root, "boss.jsonl");
	const scratch = join(root, "forks");
	const clean = [entry("u1", null, { role: "user", content: "hi" }), entry("a1", "u1", { ...anthropicHeader, content: [{ type: "text", text: "plain" }] })].join("\n") + "\n";
	writeFileSync(source, clean);
	assert.equal(prepareSanitizedForkSource(source, scratch, { agentId: "w", runId: "r1" }), undefined);
	assert.equal(existsSync(scratch), false);

	const signed = [entry("u1", null, { role: "user", content: "hi" }), entry("a1", "u1", { ...anthropicHeader, content: [{ type: "thinking", thinking: "x", thinkingSignature: "s" }, { type: "text", text: "plain" }] })].join("\n") + "\n";
	writeFileSync(source, signed);
	const prepared = prepareSanitizedForkSource(source, scratch, { agentId: "w", runId: "r/1 weird" });
	assert.ok(prepared);
	assert.equal(prepared.removedBlocks, 1);
	assert.equal(prepared.path, join(scratch, "w.r_1_weird.jsonl"));
	const copy = readFileSync(prepared.path, "utf8");
	assert.equal(copy.endsWith("\n"), true);
	assert.equal(copy.includes("thinkingSignature"), false);
	assert.equal(readFileSync(source, "utf8"), signed, "the Boss session itself is never rewritten");
	assert.equal(readdirSync(scratch).some((name) => name.endsWith(".tmp")), false);
	assert.equal(prepareSanitizedForkSource(join(root, "missing.jsonl"), scratch, { agentId: "w", runId: "r2" }), undefined);
});

test("scratch pruning keeps the newest copies", () => {
	const scratch = mkdtempSync(join(tmpdir(), "pipiui-fork-prune-"));
	for (let index = 0; index < FORK_SCRATCH_KEEP + 5; index += 1) {
		const file = join(scratch, `copy-${String(index).padStart(2, "0")}.jsonl`);
		writeFileSync(file, "{}\n");
		const when = new Date(Date.now() - (FORK_SCRATCH_KEEP + 5 - index) * 60_000);
		utimesSync(file, when, when);
	}
	writeFileSync(join(scratch, "unrelated.txt"), "keep");
	pruneForkScratch(scratch);
	const remaining = readdirSync(scratch).filter((name) => name.endsWith(".jsonl")).sort();
	assert.equal(remaining.length, FORK_SCRATCH_KEEP);
	assert.equal(remaining[0], "copy-05.jsonl", "oldest copies go first");
	assert.equal(existsSync(join(scratch, "unrelated.txt")), true);
});

test("done-message line", () => {
	assert.equal(
		formatForkSanitizedLine({ removedBlocks: 3, touchedMessages: 2, thinkingOff: true }),
		"Fork: 3 signed Anthropic thinking block(s) stripped from 2 message(s) before copying; thinking forced off for this Anthropic child (signed blocks cannot be resumed with thinking on)",
	);
	assert.equal(
		formatForkSanitizedLine({ removedBlocks: 1, touchedMessages: 1, thinkingOff: false }),
		"Fork: 1 signed Anthropic thinking block(s) stripped from 1 message(s) before copying",
	);
});
