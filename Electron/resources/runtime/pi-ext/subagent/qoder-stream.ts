/**
 * Vendored, minimally-patched Qoder stream adapter (PipiUI).
 *
 * SPDX-License-Identifier: MIT
 *
 * ATTRIBUTION
 * -----------
 * Vendored from `pi-provider-qoder@0.2.9`
 * (https://github.com/simonsmh/pi-provider-qoder), whose package.json declares
 * `license: "MIT"`. The upstream repository and published npm tarball contain
 * no LICENSE file and publish no copyright line, so no year or holder name is
 * asserted here beyond the package name and repository URL. The complete MIT
 * permission notice ships at `ThirdPartyNotices/QoderProvider-LICENSE.txt`
 * (repo root), alongside the existing CuaDriver notice.
 *
 * WHY WE MUST OWN streamSimple
 * ----------------------------
 * pi's model-runtime `streamSimple` path does not pass through any extension
 * hook that can rewrite an already-encoded, COSY-signed request body, and the
 * package's request-building helpers are closure-private (not exported, not
 * observable). There is no pi extension event through which a third party can
 * patch the request `model_config`, so the only safe in-process lever is to
 * own the stream function and re-register it (see qoder-context-window.ts).
 *
 * SYNC BASELINE
 * -------------
 * Line-by-line port of the package's `streamQoder` + helpers from the
 * published 0.2.9 dist (npm tarball `pi-provider-qoder-0.2.9.tgz`, sha256
 * b47a279686e846c8148165e71b7ed98f55bbfad8d6e0ef59fd9a5793e39b2c48;
 * `dist/index.js` sha256
 * fc0203021ce971c0a8aa4e2c4a53911f2ebd05a27b8aac30c4c8622d9c54c2d2), with
 * the 0.3.0 thinking-tag parser. Fixed request-shape constants (COSY version,
 * client/login versions, chat URL path, request envelope fields) are pinned
 * by Tests/Node/test-qoder-context-window.mjs as a drift canary.
 *
 * BEHAVIORAL DIVERGENCE (the fix)
 * -------------------------------
 * 1. `model_config` is the raw cache entry (API-marked default tier kept);
 *    `withMaxContextAsDefault()`'s max-tier flip never happens.
 *    `getCachedModelConfig`/`withMaxContextAsDefault` are replaced by
 *    `readRawModelConfig` (raw entry, default preserved).
 * 2. The no-cache fallback is mode-faithful to upstream `getCachedModelConfig`:
 *    CN mode uses the package's explicit `reasoningModels` set verbatim
 *    (identical in 0.2.9 and 0.3.0); global mode uses the package's
 *    ultimate/performance/dmodel/dfmodel heuristic. An earlier port conflated
 *    the two heuristics; this now matches upstream exactly.
 *
 * Everything else — COSY signing, WAF body encoding, message transforms, SSE
 * parsing — is byte-identical to the pinned package so the protocol cannot
 * drift.
 *
 * State files are read-only (auth.json, model cache); the only file ever
 * written is `~/.pi/agent/qoder-machine-id` when it does not exist — exactly
 * what the package itself does. Tests override the agent dir via
 * `PIPIUI_QODER_AGENT_DIR` and additionally isolate HOME, so a future
 * machineID-less fixture can never write the real `~/.pi/agent`.
 *
 * Audit: diff against `pi-provider-qoder@0.2.9` dist/index.js, `streamQoder`
 * and its helpers, and `getCachedModelConfig` (the fallback branch).
 */

import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// COSY constants (verbatim from pi-provider-qoder src/cosy.ts)
// ---------------------------------------------------------------------------

const qoderRSAPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

const QoderIDEVersion = "1.1.3";
const QoderClientType = "5";
const QoderDataPolicy = "disagree";
const QoderLoginVersion = "v2";
const QoderMachineOS =
	process.platform === "win32"
		? process.arch === "arm64"
			? "aarch64_windows"
			: "x86_64_windows"
		: process.arch === "arm64"
			? "aarch64_linux"
			: "x86_64_linux";
const QoderMachineTypeMagic = "5";

const qoderCustomAlphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
const qoderStdAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// ---------------------------------------------------------------------------
// Mode / URL helpers (verbatim from src/index.ts)
// ---------------------------------------------------------------------------

const QoderModeEnv =
	process.env.QODER_REGION || process.env.QODER_BACKEND || process.env.QODER_MODE || "";

function getQoderMode(modeOverride?: string): "cn" | "global" {
	const mode = (modeOverride || QoderModeEnv).toLowerCase();
	if (["cn", "china", "qodercn", "qoder-cn"].includes(mode)) return "cn";
	if (["global", "intl", "international", "qoder"].includes(mode)) return "global";
	if (
		(process.env.QODERCN_PERSONAL_ACCESS_TOKEN || process.env.QODERCN_PAT) &&
		!(process.env.QODER_PERSONAL_ACCESS_TOKEN || process.env.QODER_PAT)
	) {
		return "cn";
	}
	return "global";
}

function isQoderCNMode(modeOverride?: string): boolean {
	return getQoderMode(modeOverride) === "cn";
}

function getQoderBaseUrl(mode?: string): string {
	return isQoderCNMode(mode) ? "https://gateway.qoder.com.cn/" : "https://api3.qoder.sh/";
}

function getQoderChatURL(mode?: string): string {
	return `${getQoderBaseUrl(mode)}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
}

/** CN friendly-id → API key mapping (verbatim from src/index.ts). */
function getQoderCNDirectModel(modelID: string): string {
	return (
		{
			"qoder-cn": "auto",
			"qwen3.7-max": "qmodel_latest",
			"qwen3.7-plus": "qmodel",
			"qwen3.6-plus": "qmodel",
			"qwen3.6-flash": "q36fmodel",
			"deepseek-v4-pro": "dmodel",
			"deepseek-v4-flash": "dfmodel",
			"glm-5.2": "gm51model",
			"glm-5.1": "gm51model",
			"kimi-k2.6": "kmodel",
			"minimax-m2.7": "mmodel",
			"minimax-m3": "mmodel",
		} as Record<string, string>
	)[modelID || ""] || modelID || "auto";
}

function getQoderUserEmailFallback(mode?: string): string {
	return isQoderCNMode(mode) ? "user@qoder.com.cn" : "user@qoder.com";
}

// ---------------------------------------------------------------------------
// State paths (read-only except qoder-machine-id, same as the package)
// ---------------------------------------------------------------------------

function defaultStateDir(): string {
	return join(homedir(), ".pi", "agent");
}

/** Agent state dir; env override (tests) → homedir-based default (production). */
export function qoderStateDir(): string {
	return process.env.PIPIUI_QODER_AGENT_DIR || defaultStateDir();
}

export function qoderCachePath(mode?: string): string {
	return join(qoderStateDir(), isQoderCNMode(mode) ? "qoder-cn-models-cache.json" : "qoder-models-cache.json");
}

export function qoderAuthFilePath(): string {
	return join(qoderStateDir(), "auth.json");
}

// ---------------------------------------------------------------------------
// Credentials (read-only; verbatim from src/auth.ts)
// ---------------------------------------------------------------------------

interface QoderCredentials {
	access?: string;
	userID?: string;
	name?: string;
	email?: string;
	machineID?: string;
	[key: string]: unknown;
}

function getCachedCredentials(_accessToken: string, providerID = "qoder"): QoderCredentials | null {
	if (existsSync(qoderAuthFilePath())) {
		try {
			const auth = JSON.parse(readFileSync(qoderAuthFilePath(), "utf8"));
			const creds = auth?.[providerID] || (providerID === "qoder" ? auth?.qoder : null);
			if (creds?.userID || creds?.access) {
				return creds;
			}
		} catch {
			// fall through
		}
	}
	return null;
}

function getMachineId(): string {
	const paths = [join(homedir(), ".qoder", ".auth", "machine_id"), join(homedir(), ".pi", "agent", "qoder-machine-id")];
	for (const p of paths) {
		if (existsSync(p)) {
			try {
				const val = readFileSync(p, "utf8").trim();
				if (val) return val;
			} catch {
				// continue
			}
		}
	}
	const newId = crypto.randomUUID();
	try {
		const savePath = paths[1];
		mkdirSync(dirname(savePath), { recursive: true });
		writeFileSync(savePath, newId, "utf8");
	} catch {
		// best effort, same as the package
	}
	return newId;
}

// ---------------------------------------------------------------------------
// COSY signing (verbatim from src/cosy.ts)
// ---------------------------------------------------------------------------

function rsaEncryptBase64(data: string | Buffer): string {
	const key = {
		key: qoderRSAPublicKey,
		padding: crypto.constants.RSA_PKCS1_PADDING,
	};
	const encrypted = crypto.publicEncrypt(key, typeof data === "string" ? Buffer.from(data) : data);
	return encrypted.toString("base64");
}

function aesEncryptCBCBase64(plaintext: string, keyStr: string): string {
	const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(keyStr), Buffer.from(keyStr));
	let encrypted = cipher.update(plaintext, "utf8", "base64");
	encrypted += cipher.final("base64");
	return encrypted;
}

function computeSigPath(urlStr: string): string {
	const parsed = new URL(urlStr);
	let sigPath = parsed.pathname;
	if (sigPath.startsWith("/algo")) {
		sigPath = sigPath.substring("/algo".length);
	}
	return sigPath;
}

function buildAuthHeaders(
	body: Buffer | string | undefined,
	requestURL: string,
	creds: { userID?: string; authToken?: string; name?: string; email?: string; machineID?: string },
): Record<string, string> {
	if (!creds.userID) {
		throw new Error("cosy: user id is empty");
	}
	if (!creds.authToken) {
		throw new Error("cosy: auth token is empty");
	}
	const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const userInfo = {
		uid: creds.userID,
		security_oauth_token: creds.authToken,
		name: creds.name || "",
		aid: "",
		email: creds.email || "",
	};
	const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey);
	const cosyKey = rsaEncryptBase64(aesKey);
	const timestamp = Math.floor(Date.now() / 1e3).toString();
	const requestId = crypto.randomUUID();
	const cosyPayload = {
		version: "v1",
		requestId,
		info: infoB64,
		cosyVersion: QoderIDEVersion,
		ideVersion: "",
	};
	const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString("base64");
	const sigPath = computeSigPath(requestURL);
	const bodyStr = body ? (Buffer.isBuffer(body) ? body.toString("utf8") : body) : "";
	const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyStr}\n${sigPath}`;
	const sig = crypto.createHash("md5").update(sigInput).digest("hex");
	const bodyHash = crypto.createHash("md5").update(body || "").digest("hex");
	const bodyLen = body ? (Buffer.isBuffer(body) ? body.length : Buffer.from(body).length).toString() : "0";
	const machineID = creds.machineID || getMachineId();
	return {
		Authorization: `Bearer COSY.${payloadB64}.${sig}`,
		"Cosy-Key": cosyKey,
		"Cosy-User": creds.userID,
		"Cosy-Date": timestamp,
		"Cosy-Version": QoderIDEVersion,
		"Cosy-Machineid": machineID,
		"Cosy-Machinetoken": machineID,
		"Cosy-Machinetype": QoderMachineTypeMagic,
		"Cosy-Machineos": QoderMachineOS,
		"Cosy-Clienttype": QoderClientType,
		"Cosy-Clientip": "127.0.0.1",
		"Cosy-Bodyhash": bodyHash,
		"Cosy-Bodylength": bodyLen,
		"Cosy-Sigpath": sigPath,
		"Cosy-Data-Policy": QoderDataPolicy,
		"Cosy-Organization-Id": "",
		"Cosy-Organization-Tags": "",
		"Login-Version": QoderLoginVersion,
		"X-Request-Id": crypto.randomUUID(),
	};
}

// ---------------------------------------------------------------------------
// WAF body encoding (verbatim from src/index.ts)
// ---------------------------------------------------------------------------

function qoderEncodeBody(plaintext: string | Buffer): string {
	const std = Buffer.isBuffer(plaintext)
		? plaintext.toString("base64")
		: Buffer.from(plaintext).toString("base64");
	const n = std.length;
	const a = Math.floor(n / 3);
	const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);
	let out = "";
	for (let i = 0; i < n; i++) {
		const c = rearranged[i];
		if (c === "=") {
			out += "$";
		} else {
			const idx = qoderStdAlphabet.indexOf(c);
			if (idx >= 0) {
				out += qoderCustomAlphabet[idx];
			} else {
				out += c;
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Message transforms (verbatim from src/transform.ts)
// ---------------------------------------------------------------------------

interface LlmMessageLike {
	role: string;
	content?: unknown;
	stopReason?: string;
	toolCallId?: string;
	[key: string]: unknown;
}

function getContentText(msg: LlmMessageLike): string {
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.map((c: Record<string, unknown>) => {
				if (c.type === "text") return c.text;
				if (c.type === "thinking") return c.thinking;
				return "";
			})
			.join("");
	}
	return "";
}

function transformTools(tools: Array<{ name: string; description?: string; parameters?: unknown }>) {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

function transformMessagesForQoder(messages: LlmMessageLike[]) {
	const normalizedMessages: Array<Record<string, unknown>> = [];
	for (const msg of messages) {
		if (msg.role === "assistant" && (msg.stopReason === "error" || msg.stopReason === "aborted")) {
			continue;
		}
		if (msg.role === "user") {
			let content: unknown = "";
			if (typeof msg.content === "string") {
				content = msg.content;
			} else if (Array.isArray(msg.content)) {
				const hasImage = msg.content.some((c) => c.type === "image");
				if (hasImage) {
					content = msg.content
						.map((c: Record<string, unknown>) => {
							if (c.type === "text") {
								return { type: "text", text: c.text };
							}
							if (c.type === "image") {
								const img = c as unknown as { mimeType?: string; data?: string };
								return {
									type: "image_url",
									image_url: {
										url: `data:${img.mimeType};base64,${img.data}`,
									},
								};
							}
							return null;
						})
						.filter((p) => p !== null);
				} else {
					content = getContentText(msg);
				}
			}
			normalizedMessages.push({
				role: "user",
				content,
			});
		} else if (msg.role === "assistant") {
			const am = msg as unknown as {
				content?: unknown;
				[key: string]: unknown;
			};
			let content = "";
			const toolCalls: Array<Record<string, unknown>> = [];
			if (Array.isArray(am.content)) {
				for (const block of am.content as Array<Record<string, unknown>>) {
					if (block.type === "text") {
						content += block.text;
					} else if (block.type === "thinking") {
						content += `<thinking>${block.thinking}</thinking>\n\n`;
					} else if (block.type === "toolCall") {
						const tc = block as unknown as {
							id?: string;
							name?: string;
							arguments?: unknown;
						};
						toolCalls.push({
							id: tc.id,
							type: "function",
							function: {
								name: tc.name,
								arguments:
									typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
							},
						});
					}
				}
			} else {
				content = (am.content as string) || "";
			}
			const mapped: Record<string, unknown> = {
				role: "assistant",
				content: content || null,
			};
			if (toolCalls.length > 0) {
				mapped.tool_calls = toolCalls;
			}
			normalizedMessages.push(mapped);
		} else if (msg.role === "toolResult") {
			const tr = msg as unknown as { toolCallId?: string };
			normalizedMessages.push({
				role: "tool",
				tool_call_id: tr.toolCallId,
				content: getContentText(msg),
			});
		}
	}
	return normalizedMessages;
}

// ---------------------------------------------------------------------------
// Stable ids (verbatim from src/stream.ts)
// ---------------------------------------------------------------------------

function stableHash(prefix: string, ...inputs: string[]): string {
	const hash = crypto.createHash("sha256");
	hash.update(prefix);
	for (const input of inputs) {
		hash.update("\0");
		hash.update(input);
	}
	return hash.digest("hex").slice(0, 16);
}

function stableChatRecordID(
	model: string,
	messages: Array<{ role?: unknown; content?: unknown }>,
	tools: unknown,
	maxTokens: number,
): string {
	const hash = crypto.createHash("sha256");
	hash.update("qoder-record");
	hash.update("\0");
	hash.update(model);
	for (const msg of messages) {
		if (msg?.role) {
			hash.update("\0");
			hash.update(String(msg.role));
		}
		if (msg?.content) {
			hash.update("\0");
			hash.update(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
		}
	}
	if (tools) {
		hash.update("\0");
		hash.update(JSON.stringify(tools));
	}
	hash.update("\0");
	hash.update(`mt=${maxTokens}`);
	return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Thinking-tag parser (0.3.0 version: handles stray close tags in plain text)
// ---------------------------------------------------------------------------

const THINKING_TAG_VARIANTS = [
	{ open: "<thinking>", close: "</thinking>" },
	{ open: "<think>", close: "</think>" },
	{ open: "<reasoning>", close: "</reasoning>" },
	{ open: "<thought>", close: "</thought>" },
];

function getTrailingPossibleTagPrefixLength(text: string, tag: string): number {
	const maxPrefixLength = Math.min(text.length, tag.length - 1);
	for (let len = maxPrefixLength; len > 0; len--) {
		if (text.endsWith(tag.slice(0, len))) return len;
	}
	return 0;
}

function getMaxTrailingPossibleTagPrefixLength(text: string, tags: string[]): number {
	let maxLength = 0;
	for (const tag of tags) {
		maxLength = Math.max(maxLength, getTrailingPossibleTagPrefixLength(text, tag));
	}
	return maxLength;
}

class ThinkingTagParser {
	private output: AssistantMessage;
	private stream: AssistantMessageEventStream;
	private textBuffer = "";
	private inThinking = false;
	private thinkingExtracted = false;
	private thinkingBlockIndex: number | null = null;
	private textBlockIndex: number | null = null;
	private lastTextBlockIndex: number | null = null;
	private activeEndTag = THINKING_TAG_VARIANTS[0].close;

	constructor(output: AssistantMessage, stream: AssistantMessageEventStream) {
		this.output = output;
		this.stream = stream;
	}

	processChunk(chunk: string): void {
		this.textBuffer += chunk;
		while (this.textBuffer.length > 0) {
			const prevLength = this.textBuffer.length;
			if (!this.inThinking && !this.thinkingExtracted) {
				this.processBeforeThinking();
				if (this.textBuffer.length === 0) break;
			}
			if (this.inThinking) {
				this.processInsideThinking();
				if (this.textBuffer.length === 0) break;
			}
			if (this.thinkingExtracted) {
				this.processAfterThinking();
				break;
			}
			if (this.textBuffer.length >= prevLength) break;
		}
	}

	finalize(): void {
		if (this.textBuffer.length === 0) return;
		if (this.inThinking && this.thinkingBlockIndex !== null) {
			const block = this.output.content[this.thinkingBlockIndex] as { thinking?: string };
			block.thinking += this.textBuffer;
			this.stream.push({
				type: "thinking_delta",
				contentIndex: this.thinkingBlockIndex,
				delta: this.textBuffer,
				partial: this.output,
			});
			this.stream.push({
				type: "thinking_end",
				contentIndex: this.thinkingBlockIndex,
				content: block.thinking,
				partial: this.output,
			});
		} else {
			this.emitText(this.textBuffer);
		}
		this.textBuffer = "";
	}

	getTextBlockIndex(): number | null {
		return this.textBlockIndex ?? this.lastTextBlockIndex;
	}

	private processBeforeThinking(): void {
		let bestOpenPos = -1;
		let bestOpenVariant: (typeof THINKING_TAG_VARIANTS)[number] | null = null;
		let bestClosePos = -1;
		let bestCloseVariant: (typeof THINKING_TAG_VARIANTS)[number] | null = null;
		for (const variant of THINKING_TAG_VARIANTS) {
			const openPos = this.textBuffer.indexOf(variant.open);
			if (openPos !== -1 && (bestOpenPos === -1 || openPos < bestOpenPos)) {
				bestOpenPos = openPos;
				bestOpenVariant = variant;
			}
			const closePos = this.textBuffer.indexOf(variant.close);
			if (closePos !== -1 && (bestClosePos === -1 || closePos < bestClosePos)) {
				bestClosePos = closePos;
				bestCloseVariant = variant;
			}
		}
		if (bestOpenVariant !== null && (bestCloseVariant === null || bestOpenPos < bestClosePos)) {
			if (bestOpenPos > 0) this.emitText(this.textBuffer.slice(0, bestOpenPos));
			this.textBuffer = this.textBuffer.slice(bestOpenPos + bestOpenVariant.open.length);
			this.activeEndTag = bestOpenVariant.close;
			this.inThinking = true;
			return;
		}
		if (bestCloseVariant !== null) {
			if (bestClosePos > 0) this.emitText(this.textBuffer.slice(0, bestClosePos));
			this.textBuffer = this.textBuffer.slice(bestClosePos + bestCloseVariant.close.length);
			if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
			else if (this.textBuffer.startsWith("\n")) this.textBuffer = this.textBuffer.slice(1);
			return;
		}
		const allTags = THINKING_TAG_VARIANTS.flatMap((variant) => [variant.open, variant.close]);
		const trailingPrefixLength = getMaxTrailingPossibleTagPrefixLength(this.textBuffer, allTags);
		const safeLen = this.textBuffer.length - trailingPrefixLength;
		if (safeLen > 0) {
			this.emitText(this.textBuffer.slice(0, safeLen));
			this.textBuffer = this.textBuffer.slice(safeLen);
		}
	}

	private processInsideThinking(): void {
		const endPos = this.textBuffer.indexOf(this.activeEndTag);
		if (endPos !== -1) {
			if (endPos > 0) this.emitThinking(this.textBuffer.slice(0, endPos));
			if (this.thinkingBlockIndex !== null) {
				const block = this.output.content[this.thinkingBlockIndex] as { thinking?: string };
				this.stream.push({
					type: "thinking_end",
					contentIndex: this.thinkingBlockIndex,
					content: block.thinking,
					partial: this.output,
				});
			}
			this.textBuffer = this.textBuffer.slice(endPos + this.activeEndTag.length);
			this.inThinking = false;
			this.thinkingExtracted = true;
			this.lastTextBlockIndex = this.textBlockIndex;
			this.textBlockIndex = null;
			if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
			return;
		}
		const trailingPrefixLength = getTrailingPossibleTagPrefixLength(this.textBuffer, this.activeEndTag);
		const safeLen = this.textBuffer.length - trailingPrefixLength;
		if (safeLen > 0) {
			this.emitThinking(this.textBuffer.slice(0, safeLen));
			this.textBuffer = this.textBuffer.slice(safeLen);
		}
	}

	private processAfterThinking(): void {
		this.emitText(this.textBuffer);
		this.textBuffer = "";
	}

	private emitText(text: string): void {
		if (!text) return;
		if (this.textBlockIndex === null) {
			this.textBlockIndex = this.output.content.length;
			this.output.content.push({ type: "text", text: "" });
			this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
		}
		const block = this.output.content[this.textBlockIndex] as { text: string };
		block.text += text;
		this.stream.push({
			type: "text_delta",
			contentIndex: this.textBlockIndex,
			delta: text,
			partial: this.output,
		});
	}

	private emitThinking(thinking: string): void {
		if (!thinking) return;
		if (this.thinkingBlockIndex === null) {
			if (this.textBlockIndex !== null) {
				this.thinkingBlockIndex = this.textBlockIndex;
				this.output.content.splice(this.thinkingBlockIndex, 0, { type: "thinking", thinking: "" });
				this.textBlockIndex = this.textBlockIndex + 1;
			} else {
				this.thinkingBlockIndex = this.output.content.length;
				this.output.content.push({ type: "thinking", thinking: "" });
			}
			this.stream.push({
				type: "thinking_start",
				contentIndex: this.thinkingBlockIndex,
				partial: this.output,
			});
		}
		const block = this.output.content[this.thinkingBlockIndex] as { thinking: string };
		block.thinking += thinking;
		this.stream.push({
			type: "thinking_delta",
			contentIndex: this.thinkingBlockIndex,
			delta: thinking,
			partial: this.output,
		});
	}
}

// ---------------------------------------------------------------------------
// Raw model config (THE FIX — replaces getCachedModelConfig +
// withMaxContextAsDefault: the API-marked default tier is preserved, never
// promoted to the largest tier)
// ---------------------------------------------------------------------------

export interface QoderConfigEntry {
	key?: string;
	format?: string;
	source?: string;
	enable?: boolean;
	display_name?: string;
	is_vl?: boolean;
	is_reasoning?: boolean;
	max_input_tokens?: number;
	is_editable?: boolean;
	max_output_tokens?: number;
	context_config?: Record<string, { token_count?: number; is_default?: boolean } | undefined>;
	thinking_config?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Raw cache `configs[modelKey]` — the exact object the API sent, with the
 * API-marked `context_config.<tier>.is_default` untouched. This is what the
 * request `model_config` must contain (the package's
 * `withMaxContextAsDefault` rewrite is the bug being fixed).
 */
export function readRawModelConfig(modelKey: string, mode?: string): QoderConfigEntry | null {
	const cachePath = qoderCachePath(mode);
	if (existsSync(cachePath)) {
		try {
			const data = JSON.parse(readFileSync(cachePath, "utf8")) as {
				configs?: Record<string, QoderConfigEntry>;
			};
			if (data?.configs?.[modelKey]) {
				return data.configs[modelKey];
			}
		} catch {
			// fall through
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// No-cache fallback (verbatim from src/index.ts `getCachedModelConfig`)
// ---------------------------------------------------------------------------

/**
 * CN no-cache fallback reasoning keys — verbatim from
 * `pi-provider-qoder@0.2.9` dist/index.js `getCachedModelConfig` (the
 * `reasoningModels` set; identical in 0.3.0). Explicit set, no wildcards.
 */
const QODER_CN_REASONING_MODEL_KEYS = new Set([
	"qoder-cn",
	"auto",
	"qmodel_latest",
	"qmodel",
	"q36fmodel",
	"qfmodel",
	"dmodel",
	"gm51model",
	"kmodel",
	"qwen3.7-max",
	"qwen3.7-plus",
	"qwen3.6-plus",
	"qwen3.6-flash",
	"deepseek-v4-pro",
	"glm-5.2",
	"glm-5.1",
	"kimi-k2.6",
]);

/**
 * Mode-faithful no-cache fallback: CN → `reasoningModels.has(modelKey)`;
 * global → the package's `|| {...}` heuristic. Same shape as upstream
 * (`key`/`is_reasoning`/`max_output_tokens`/`source`).
 */
function fallbackModelConfig(modelKey: string, mode: "cn" | "global"): QoderConfigEntry {
	if (mode === "cn") {
		return {
			key: modelKey,
			is_reasoning: QODER_CN_REASONING_MODEL_KEYS.has(modelKey),
			max_output_tokens: 32768,
			source: "system",
		};
	}
	return {
		key: modelKey,
		is_reasoning:
			modelKey === "ultimate" ||
			modelKey === "performance" ||
			modelKey.includes("dmodel") ||
			modelKey.includes("dfmodel"),
		max_output_tokens: 32768,
		source: "system",
	};
}

// ---------------------------------------------------------------------------
// Request building — pure and exported for hermetic fixture tests
// ---------------------------------------------------------------------------

export interface QoderRequestBodyPlan {
	reqBody: Record<string, unknown>;
	modelConfig: QoderConfigEntry;
	chatURL: string;
	headers: Record<string, string>;
	encodedBody: string;
	userID: string;
	name: string;
	email: string;
	machineID: string;
	maxTokens: number;
	modelKey: string;
}

interface QoderStreamContextLike {
	messages: LlmMessageLike[];
	systemPrompt?: string;
	tools?: Array<{ name: string; description?: string; parameters?: unknown }>;
}

export interface QoderStreamOptionsLike {
	apiKey?: string;
	signal?: AbortSignal;
	maxTokens?: number;
	reasoning?: boolean | string;
}

/**
 * Build the full signed request for a Qoder turn. `model_config` is the raw
 * cache entry (API default tier preserved). Exported so tests can assert the
 * request shape against fixtures without any network access.
 */
export function buildQoderRequestBody(
	model: Model,
	context: QoderStreamContextLike,
	options: QoderStreamOptionsLike = {},
): QoderRequestBodyPlan {
	const providerMode = model.provider === "qoder-cn" ? "cn" : getQoderMode();
	const accessToken = options?.apiKey;
	if (!accessToken) {
		throw new Error(
			isQoderCNMode(providerMode)
				? "Qoder CN credentials not set. Run /login qoder-cn or set QODERCN_PERSONAL_ACCESS_TOKEN."
				: "Qoder credentials not set. Run /login qoder or set QODER_PERSONAL_ACCESS_TOKEN.",
		);
	}
	const cachedCreds = getCachedCredentials(accessToken, model.provider);
	const userID = cachedCreds?.userID || "qoder-user";
	const name = cachedCreds?.name || (isQoderCNMode(providerMode) ? "Qoder CN User" : "Qoder User");
	const email = cachedCreds?.email || getQoderUserEmailFallback(providerMode);
	const machineID = cachedCreds?.machineID || getMachineId();
	const modelKey = isQoderCNMode(providerMode) ? getQoderCNDirectModel(model.id) : model.id;
	const rawEntry = readRawModelConfig(modelKey, providerMode);
	const modelConfig: QoderConfigEntry = rawEntry
		? { ...rawEntry, key: modelKey }
		: fallbackModelConfig(modelKey, providerMode);
	const isReasoning = !!modelConfig.is_reasoning;
	const maxOutputTokens = modelConfig.max_output_tokens || 32768;
	const normalizedMessages = transformMessagesForQoder(context.messages);
	const systemText = context.systemPrompt || "";
	let lastUserText = "";
	for (let i = normalizedMessages.length - 1; i >= 0; i--) {
		if (normalizedMessages[i].role === "user") {
			const content = normalizedMessages[i].content;
			lastUserText =
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content
								.map((c) => ("text" in c ? c.text : ""))
								.join("")
						: "";
			break;
		}
	}
	const sessionID = stableHash("qoder-session", userID, modelKey);
	let maxTokens = 32768;
	if (maxOutputTokens > 0) {
		maxTokens = maxOutputTokens;
	}
	if (options?.maxTokens && options.maxTokens < maxTokens) {
		maxTokens = options.maxTokens;
	}
	const toolsRaw = context.tools && context.tools.length > 0 ? transformTools(context.tools) : undefined;
	const recordID = stableChatRecordID(modelKey, normalizedMessages, toolsRaw, maxTokens);
	const reqBody: Record<string, unknown> = {
		request_id: crypto.randomUUID(),
		request_set_id: recordID,
		chat_record_id: recordID,
		session_id: sessionID,
		stream: true,
		chat_task: "FREE_INPUT",
		is_reply: true,
		is_retry: false,
		source: 1,
		version: "3",
		session_type: "qodercli",
		agent_id: "agent_common",
		task_id: "common",
		code_language: "",
		chat_prompt: "",
		image_urls: null,
		aliyun_user_type: "",
		system: systemText,
		messages: normalizedMessages,
		tools: toolsRaw || [],
		parameters: { max_tokens: maxTokens },
		chat_context: {
			chatPrompt: "",
			imageUrls: null,
			extra: {
				context: [],
				modelConfig: {
					key: modelKey,
					is_reasoning: isReasoning,
				},
				originalContent: lastUserText,
			},
			features: [],
			text: lastUserText,
		},
		model_config: modelConfig,
		business: {
			product: "cli",
			version: "1.0.0",
			type: "agent",
			stage: "start",
			id: crypto.randomUUID(),
			name: lastUserText.substring(0, 30),
			begin_at: Date.now(),
		},
	};
	const bodyBytes = Buffer.from(JSON.stringify(reqBody));
	const encodedBody = qoderEncodeBody(bodyBytes);
	const chatURL = getQoderChatURL(providerMode);
	const headers = buildAuthHeaders(encodedBody, chatURL, {
		userID,
		authToken: accessToken,
		name,
		email,
		machineID,
	});
	return { reqBody, modelConfig, chatURL, headers, encodedBody, userID, name, email, machineID, maxTokens, modelKey };
}

// ---------------------------------------------------------------------------
// Stream (port of streamQoder; the request above + the SSE consumption loop)
// ---------------------------------------------------------------------------

export function qoderStreamSimple(
	model: Model,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	(async () => {
		try {
			const plan = buildQoderRequestBody(model, context, options as QoderStreamOptionsLike);
			const { chatURL, encodedBody, headers } = plan;
			const modelSource = plan.modelConfig.source || "system";
			const response = await fetch(chatURL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
					"Accept-Encoding": "identity",
					"X-Model-Key": plan.modelKey,
					"X-Model-Source": modelSource,
					...headers,
				},
				body: encodedBody,
				signal: options?.signal,
			});
			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Qoder API request failed: ${response.status} ${response.statusText}. Response: ${errText}`);
			}
			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");
			const decoder = new TextDecoder();
			let buffer = "";
			let contentBlockIndex = -1;
			let thinkingBlockIndex = -1;
			const toolCallsState: Array<Record<string, unknown>> = [];
			const thinkingEnabled = options?.reasoning !== false && options?.reasoning !== "off";
			const thinkingParser = thinkingEnabled ? new ThinkingTagParser(output, stream) : null;
			stream.push({ type: "start", partial: output });
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				while (true) {
					const lineEnd = buffer.indexOf("\n");
					if (lineEnd === -1) break;
					const line = buffer.substring(0, lineEnd).trim();
					buffer = buffer.substring(lineEnd + 1);
					if (!line.startsWith("data:")) continue;
					const dataStr = line.substring(5).trim();
					if (dataStr === "[DONE]") {
						break;
					}
					try {
						const envelope = JSON.parse(dataStr) as { statusCodeValue?: number; body?: string };
						if (envelope.statusCodeValue && envelope.statusCodeValue !== 200) {
							throw new Error(`Upstream status ${envelope.statusCodeValue}: ${envelope.body}`);
						}
						const innerStr = envelope.body;
						if (!innerStr || innerStr === "[DONE]") continue;
						const inner = JSON.parse(innerStr) as {
							choices?: Array<{
								delta?: {
									reasoning_content?: string;
									content?: string;
									tool_calls?: Array<{
										index?: number;
										id?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
								finish_reason?: string;
							}>;
						};
						if (inner.choices && inner.choices.length > 0) {
							const choice = inner.choices[0];
							const delta = choice.delta;
							if (delta) {
								if (delta.reasoning_content) {
									if (thinkingBlockIndex === -1) {
										thinkingBlockIndex = output.content.length;
										output.content.push({ type: "thinking", thinking: "" });
										stream.push({ type: "thinking_start", contentIndex: thinkingBlockIndex, partial: output });
									}
									const block = output.content[thinkingBlockIndex] as { thinking: string };
									block.thinking += delta.reasoning_content;
									stream.push({
										type: "thinking_delta",
										contentIndex: thinkingBlockIndex,
										delta: delta.reasoning_content,
										partial: output,
									});
								}
								if (delta.content) {
									if (thinkingBlockIndex !== -1) {
										const block = output.content[thinkingBlockIndex] as { thinking: string };
										stream.push({
											type: "thinking_end",
											contentIndex: thinkingBlockIndex,
											content: block.thinking,
											partial: output,
										});
										thinkingBlockIndex = -1;
									}
									if (thinkingParser) {
										thinkingParser.processChunk(delta.content);
									} else {
										if (contentBlockIndex === -1) {
											contentBlockIndex = output.content.length;
											output.content.push({ type: "text", text: "" });
											stream.push({ type: "text_start", contentIndex: contentBlockIndex, partial: output });
										}
										const block = output.content[contentBlockIndex] as { text: string };
										block.text += delta.content;
										stream.push({
											type: "text_delta",
											contentIndex: contentBlockIndex,
											delta: delta.content,
											partial: output,
										});
									}
								}
								if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
									for (const tc of delta.tool_calls) {
										const idx = tc.index ?? 0;
										if (!toolCallsState[idx]) {
											toolCallsState[idx] = { arguments: "", id: "", name: "", contentIndex: 0 };
										}
										const state = toolCallsState[idx];
										if (tc.id) state.id = tc.id;
										if (tc.function?.name) state.name = tc.function.name;
										if (tc.function?.arguments) {
											const argDelta = tc.function.arguments;
											state.arguments = `${state.arguments}${argDelta}`;
											if (state.emittedStart === undefined) {
												state.emittedStart = true;
												state.contentIndex = output.content.length;
												const block = { type: "toolCall", id: state.id, name: state.name, arguments: {} };
												output.content.push(block);
												stream.push({
													type: "toolcall_start",
													contentIndex: state.contentIndex,
													partial: output,
												});
											}
											stream.push({
												type: "toolcall_delta",
												contentIndex: state.contentIndex,
												delta: argDelta,
												partial: output,
											});
										}
									}
								}
							}
							if (choice.finish_reason) {
								output.stopReason = choice.finish_reason as AssistantMessage["stopReason"];
							}
						}
					} catch {
						// skip malformed envelope, same as the package
					}
				}
			}
			if (thinkingParser) {
				thinkingParser.finalize();
			}
			if (thinkingBlockIndex !== -1) {
				const block = output.content[thinkingBlockIndex] as { thinking: string };
				stream.push({
					type: "thinking_end",
					contentIndex: thinkingBlockIndex,
					content: block.thinking,
					partial: output,
				});
			}
			for (const state of toolCallsState) {
				if (state?.emittedStart && !state.emittedEnd) {
					state.emittedEnd = true;
					let args: unknown = {};
					try {
						args = JSON.parse(String(state.arguments || "{}"));
					} catch {
						// keep {}
					}
					const block = output.content[Number(state.contentIndex)] as {
						id?: string;
						name?: string;
						arguments?: unknown;
					};
					block.arguments = args;
					stream.push({
						type: "toolcall_end",
						contentIndex: Number(state.contentIndex),
						toolCall: {
							type: "toolCall",
							id: String(state.id),
							name: String(state.name),
							arguments: args,
						},
						partial: output,
					});
				}
			}
			if (toolCallsState.length > 0) {
				output.stopReason = "toolUse";
			} else {
				output.stopReason = "stop";
			}
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (e) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = e instanceof Error ? e.message : String(e);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			try {
				stream.end();
			} catch {
				// already ended
			}
		}
	})();
	return stream;
}
