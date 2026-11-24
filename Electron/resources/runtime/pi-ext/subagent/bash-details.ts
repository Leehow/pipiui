import { readAssistantToolCall, toolResultMessageFromEvent } from "./assistant-tool-call.ts";

export const BASH_DETAIL_PAGE_BYTES = 32 * 1024;
const INPUT_BYTES = 256 * 1024;
type Identity = { agentId: string; runId: string; toolCallId: string };
type State = "running" | "completed" | "failed" | "interrupted";
type Entry = Identity & { state: State; revision: number; input: string; output: string; inputTruncated: boolean; outputTruncated: boolean };
export type BashDetailRequest = Identity & { requestId: string; field?: "live" | "input" | "output"; offset?: number; sinceRevision?: number };
const key = (id: Identity) => JSON.stringify([id.agentId, id.runId, id.toolCallId]);
const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** Slice only bounded source characters before encoding; never allocate a full-output Buffer. */
function bounded(text: string, max: number, tail = false): string {
	let source = tail ? text.slice(-max) : text.slice(0, max);
	if (tail && source.length < text.length && /[\uDC00-\uDFFF]/.test(source[0] ?? "")) source = source.slice(1);
	if (!tail && source.length < text.length && /[\uD800-\uDBFF]/.test(source.at(-1) ?? "")) source = source.slice(0, -1);
	const buf = Buffer.from(source);
	let start = tail ? Math.max(0, buf.length - max) : 0;
	let end = tail ? buf.length : Math.min(max, buf.length);
	while (start < end && (buf[start] & 0xc0) === 0x80) start++;
	while (end < buf.length && end > start && (buf[end] & 0xc0) === 0x80) end--;
	return buf.subarray(start, end).toString("utf8");
}
function resultTail(result: any): { text: string; truncated: boolean } {
	const content = typeof result === "string" ? [result] : typeof result?.content === "string" ? [result.content] : result?.content;
	let text = "";
	let total = 0;
	if (Array.isArray(content)) for (const part of content) {
		const value = typeof part === "string" ? part : part?.type === "text" && typeof part.text === "string" ? part.text : undefined;
		if (value === undefined) continue;
		const separator = total > 0 ? "\n" : "";
		total += bytes(value) + separator.length;
		text = bounded(text + separator + bounded(value, BASH_DETAIL_PAGE_BYTES, true), BASH_DETAIL_PAGE_BYTES, true);
	}
	return { text, truncated: total > bytes(text) };
}

export class BashDetailStore {
	private entries = new Map<string, Entry>();
	private used = 0;
	private closed = false;
	constructor(private maxBytes = 8 * 1024 * 1024, private maxEntries = 512) {}
	get stats() { return { bytes: this.used, entries: this.entries.size }; }
	clear() { this.entries.clear(); this.used = 0; }
	close() { this.closed = true; this.clear(); }
	private save(entry: Entry) {
		const id = key(entry);
		const old = this.entries.get(id);
		if (old) this.used -= bytes(old.input) + bytes(old.output);
		this.entries.delete(id);
		this.entries.set(id, entry);
		this.used += bytes(entry.input) + bytes(entry.output);
		while (this.used > this.maxBytes || this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value!;
			const value = this.entries.get(oldest)!;
			this.used -= bytes(value.input) + bytes(value.output);
			this.entries.delete(oldest);
		}
	}
	start(id: Identity, args: any) {
		if (this.closed || this.entries.has(key(id))) return;
		const serialized = JSON.stringify(args ?? {});
		const input = bounded(serialized, INPUT_BYTES);
		this.save({ ...id, state: "running", revision: 1, input, output: "", inputTruncated: bytes(serialized) > bytes(input), outputTruncated: false });
	}
	update(id: Identity, result: unknown, terminal?: "completed" | "failed") {
		const entry = this.entries.get(key(id));
		if (!entry || entry.state !== "running") return;
		const output = resultTail(result);
		this.save({ ...entry, output: output.text, outputTruncated: output.truncated, state: terminal ?? "running", revision: entry.revision + 1 });
	}
	interrupt(agentId: string, runId: string) {
		for (const entry of [...this.entries.values()]) if (entry.agentId === agentId && entry.runId === runId && entry.state === "running") {
			this.save({ ...entry, state: "interrupted", revision: entry.revision + 1 });
		}
	}
	read(request: BashDetailRequest): Record<string, unknown> {
		const entry = this.entries.get(key(request));
		if (!entry) return { state: "unavailable" };
		this.entries.delete(key(request)); this.entries.set(key(request), entry);
		const base = { state: entry.state, revision: entry.revision };
		if (request.field === "output" && (request.offset ?? 0) > 0 && request.sinceRevision !== entry.revision) return { state: "unavailable" };
		if ((!request.field || request.field === "live") && request.sinceRevision === entry.revision) return { ...base, unchanged: true };
		if (!request.field || request.field === "live") return { ...base, input: bounded(entry.input, BASH_DETAIL_PAGE_BYTES), output: entry.output, inputTruncated: entry.inputTruncated || bytes(entry.input) > BASH_DETAIL_PAGE_BYTES, outputTruncated: entry.outputTruncated };
		const text = entry[request.field];
		const buf = Buffer.from(text);
		const offset = request.offset ?? 0;
		if (offset > buf.length || (offset < buf.length && (buf[offset] & 0xc0) === 0x80)) return { state: "unavailable" };
		const page = bounded(buf.subarray(offset).toString("utf8"), BASH_DETAIL_PAGE_BYTES);
		const next = offset + bytes(page);
		return { ...base, text: page, totalBytes: buf.length, ...(next < buf.length ? { nextOffset: next } : {}), truncated: entry[request.field === "input" ? "inputTruncated" : "outputTruncated"] };
	}
	/** Called by the existing stdout drain. No reports, timers, or disk writes. */
	consume(agentId: string, runId: string, event: any): boolean {
		if (this.closed) return false;
		let bashCall = false;
		const ame = event?.type === "message_update" ? event.assistantMessageEvent : event;
		if (ame?.type === "toolcall_end") {
			const tool = readAssistantToolCall(ame.toolCall) ?? readAssistantToolCall(ame);
			if (tool?.name === "bash" && tool.id) {
				bashCall = true;
				this.start({ agentId, runId, toolCallId: tool.id }, tool.arguments);
			}
		}
		if (event?.type === "tool_execution_start" && event.toolName === "bash" && typeof event.toolCallId === "string") {
			bashCall = true;
			this.start({ agentId, runId, toolCallId: event.toolCallId }, event.args);
		}
		const message = event?.type === "message_end" && event.message?.role === "toolResult" ? event.message : toolResultMessageFromEvent(event);
		if (message && typeof message.toolCallId === "string") {
			const id = { agentId, runId, toolCallId: message.toolCallId };
			if (message.toolName === "bash" && !this.entries.has(key(id))) return false; // evicted / historical: never invent input
			this.update(id, message, message.isError ? "failed" : "completed");
		} else if (event?.type === "tool_execution_update" && typeof event.toolCallId === "string") this.update({ agentId, runId, toolCallId: event.toolCallId }, event.partialResult);
		return bashCall;
	}
}

/** One closure per run (including retries); readiness never carries a tool body. */
export function createBashDetailConsumer(store: BashDetailStore, agentId: string, runId: string, report: (event: { kind: string; agentId: string; runId: string; ownerPid: number }) => void) {
	let ready = false;
	return (event: unknown) => {
		const bashCall = store.consume(agentId, runId, event);
		if (bashCall && !ready) {
			ready = true;
			// Parent extension process, not the child worker process.
			report({ kind: "bash_detail_ready", agentId, runId, ownerPid: process.pid });
		}
	};
}

function validId(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\x00-\x1f]/.test(value);
}
/** Only explicit host demand reports body text. Invalid requests never echo their body. */
export async function handleBashDetailCommand(args: string, store: BashDetailStore, report: (payload: { kind: string; agentId: string; runId: string; requestId: string; detail: Record<string, unknown> }) => Promise<unknown>) {
	let value: any;
	try { if (args.length <= 8192) value = JSON.parse(decodeURIComponent(args)); } catch { /* unavailable */ }
	const identity = { requestId: validId(value?.requestId, 160) ? value.requestId : "invalid", agentId: validId(value?.agentId, 80) ? value.agentId : "invalid", runId: validId(value?.runId, 160) ? value.runId : "invalid" };
	const valid = value && typeof value === "object" && !Array.isArray(value)
		&& validId(value.requestId, 160) && validId(value.agentId, 80) && validId(value.runId, 160) && validId(value.toolCallId, 512)
		&& Object.keys(value).every(k => ["requestId", "agentId", "runId", "toolCallId", "field", "offset", "sinceRevision"].includes(k))
		&& (value.field === undefined || ["live", "input", "output"].includes(value.field))
		&& (value.offset === undefined || Number.isSafeInteger(value.offset) && value.offset >= 0)
		&& (value.sinceRevision === undefined || Number.isSafeInteger(value.sinceRevision) && value.sinceRevision >= 0);
	await report({ kind: "bash_detail", ...identity, detail: valid ? store.read(value) : { state: "unavailable" } });
}
