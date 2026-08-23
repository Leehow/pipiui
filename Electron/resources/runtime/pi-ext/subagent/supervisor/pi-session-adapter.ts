/**
 * Production AgentSession adapter (S4).
 *
 * Maps S2 create options onto injected Pi `createAgentSession` +
 * `SessionManager.create(projectScopedPath)`. Never opens or copies a Boss
 * session. `prompt()` on the real AgentSession returns void — assistant JSON
 * is extracted from session messages / subscribe events.
 */

import { isProviderQualifiedModelRef } from "../model-ref.ts";
import {
	SUPERVISOR_NO_TOOLS,
	SUPERVISOR_THINKING_LEVEL,
	SupervisorSessionRuntimeError,
	type SupervisorPiCreateOptions,
	type SupervisorPiSessionFactory,
	type SupervisorPiSessionHandle,
} from "./session-runtime.ts";

export interface PiAgentSessionLike {
	prompt(text: string, options?: unknown): Promise<unknown>;
	dispose?: () => void | Promise<void>;
	abort?: () => void | Promise<void>;
	subscribe?: (listener: (event: unknown) => void) => () => void;
	readonly sessionId?: string;
	readonly sessionFile?: string;
	readonly messages?: unknown;
	readonly agent?: { state?: { messages?: unknown } };
}

export interface PiCreateAgentSessionResult {
	session: PiAgentSessionLike;
}

export interface PiSessionManagerApi {
	create(cwd: string, sessionDir?: string): unknown;
	open?: (...args: never[]) => unknown;
	continueRecent?: (...args: never[]) => unknown;
}

export interface PiResourceLoaderLike {
	reload?: () => Promise<void> | void;
}

export function supervisorResourceLoaderFlags(systemPrompt: string): {
	noExtensions: true;
	noSkills: true;
	noPromptTemplates: true;
	noThemes: true;
	noContextFiles: true;
	appendSystemPrompt: readonly [];
	appendSystemPromptOverride: () => readonly [];
	systemPromptOverride: () => string;
} {
	return {
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		appendSystemPrompt: [],
		appendSystemPromptOverride: () => [],
		systemPromptOverride: () => systemPrompt,
	};
}

export function isResolvedSupervisorModel(model: unknown): boolean {
	if (typeof model === "string") return isProviderQualifiedModelRef(model);
	if (!model || typeof model !== "object" || Array.isArray(model)) return false;
	const record = model as { provider?: unknown; id?: unknown };
	return typeof record.provider === "string" && record.provider.trim().length > 0
		&& typeof record.id === "string" && record.id.trim().length > 0;
}

export interface PiSupervisorAdapterDeps {
	createAgentSession: (options: Record<string, unknown>) => Promise<PiCreateAgentSessionResult>;
	SessionManager: PiSessionManagerApi;
	/** Optional: resolve `provider/id` to a Pi Model object. */
	resolveModel?: (ref: string) => unknown | Promise<unknown>;
	modelRuntime?: unknown;
	agentDir?: string;
	createResourceLoader?: (systemPrompt: string) => PiResourceLoaderLike | Promise<PiResourceLoaderLike>;
}

export function extractAssistantTextFromSession(session: PiAgentSessionLike, collected = ""): string {
	const messages = messagesOf(session);
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!isRecord(message) || message.role !== "assistant") continue;
		const text = textFromContent(message.content);
		if (text.trim()) return text;
	}
	if (collected.trim()) return collected;
	throw new SupervisorSessionRuntimeError(
		"prompt_failed",
		"AgentSession produced no assistant JSON (prompt() does not return the reply)",
	);
}

export function createPiSupervisorSessionFactory(deps: PiSupervisorAdapterDeps): SupervisorPiSessionFactory {
	if (!deps?.createAgentSession || typeof deps.createAgentSession !== "function") {
		throw new SupervisorSessionRuntimeError("invalid_config", "createAgentSession is required");
	}
	if (!deps.SessionManager || typeof deps.SessionManager.create !== "function") {
		throw new SupervisorSessionRuntimeError("invalid_config", "SessionManager.create is required");
	}

	return {
		async create(options: SupervisorPiCreateOptions): Promise<SupervisorPiSessionHandle> {
			const sessionManager = deps.SessionManager.create(options.cwd, options.projectScopedPath);
			let model: unknown;
			try {
				model = deps.resolveModel ? await deps.resolveModel(options.model) : options.model;
			} catch (error) {
				if (error instanceof SupervisorSessionRuntimeError) throw error;
				const detail = error instanceof Error ? error.message : String(error);
				throw new SupervisorSessionRuntimeError("no_model", `Supervisor model resolution failed: ${detail}`, error);
			}
			if (!isResolvedSupervisorModel(model)) {
				throw new SupervisorSessionRuntimeError(
					"no_model",
					"Supervisor model did not resolve to a provider-qualified model",
				);
			}
			const resourceLoader = deps.createResourceLoader
				? await deps.createResourceLoader(options.systemPrompt)
				: undefined;
			if (resourceLoader && typeof resourceLoader.reload === "function") {
				await resourceLoader.reload();
			}

			let created: PiCreateAgentSessionResult;
			try {
				created = await deps.createAgentSession({
					cwd: options.cwd,
					sessionManager,
					model,
					thinkingLevel: options.thinkingLevel ?? SUPERVISOR_THINKING_LEVEL,
					tools: [...options.tools],
					customTools: [...options.customTools],
					noTools: options.noTools ?? SUPERVISOR_NO_TOOLS,
					...(resourceLoader ? { resourceLoader } : {}),
					...(deps.modelRuntime !== undefined ? { modelRuntime: deps.modelRuntime } : {}),
					...(deps.agentDir ? { agentDir: deps.agentDir } : {}),
					systemPrompt: options.systemPrompt,
				});
			} catch (error) {
				throw wrap("create_failed", "Supervisor AgentSession creation failed", error);
			}

			const session = created?.session;
			if (!session || typeof session.prompt !== "function") {
				throw new SupervisorSessionRuntimeError("create_failed", "createAgentSession did not return a session");
			}

			return bindSupervisorPiHandle(session);
		},
	};
}

export function bindSupervisorPiHandle(session: PiAgentSessionLike): SupervisorPiSessionHandle {
	return {
		sessionId: session.sessionId,
		sessionFile: session.sessionFile,
		async prompt(text: string): Promise<string> {
			let collected = "";
			const unsubscribe = session.subscribe?.((event) => {
				collected = collectAssistantDelta(event, collected);
			});
			try {
				const returned = await session.prompt(text);
				if (typeof returned === "string" && returned.trim()) return returned;
				return extractAssistantTextFromSession(session, collected);
			} catch (error) {
				if (error instanceof SupervisorSessionRuntimeError) throw error;
				throw wrap("prompt_failed", "Supervisor AgentSession prompt failed", error);
			} finally {
				try { unsubscribe?.(); } catch { /* ignore */ }
			}
		},
		async dispose() {
			if (typeof session.dispose === "function") await session.dispose();
		},
		async abort() {
			if (typeof session.abort === "function") await session.abort();
		},
	};
}

function messagesOf(session: PiAgentSessionLike): unknown[] {
	if (Array.isArray(session.messages)) return session.messages;
	const nested = session.agent?.state?.messages;
	return Array.isArray(nested) ? nested : [];
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			parts.push(part);
			continue;
		}
		if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("");
}

function collectAssistantDelta(event: unknown, previous: string): string {
	if (!isRecord(event)) return previous;
	if (event.type === "message_update" && isRecord(event.assistantMessageEvent)) {
		const delta = event.assistantMessageEvent;
		if (delta.type === "text_delta" && typeof delta.delta === "string") {
			return previous + delta.delta;
		}
	}
	if (event.type === "turn_end" && isRecord(event.message)) {
		const text = textFromContent(event.message.content);
		if (text.trim()) return text;
	}
	if (event.type === "agent_end" && Array.isArray(event.messages)) {
		for (let i = event.messages.length - 1; i >= 0; i--) {
			const message = event.messages[i];
			if (!isRecord(message) || message.role !== "assistant") continue;
			const text = textFromContent(message.content);
			if (text.trim()) return text;
		}
	}
	if (event.type === "message_end" && isRecord(event.message)) {
		const text = textFromContent(event.message.content);
		if (text.trim()) return text;
	}
	return previous;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wrap(
	code: "create_failed" | "prompt_failed",
	message: string,
	error: unknown,
): SupervisorSessionRuntimeError {
	if (error instanceof SupervisorSessionRuntimeError) return error;
	const detail = error instanceof Error ? error.message : String(error);
	return new SupervisorSessionRuntimeError(code, `${message}: ${detail}`, error);
}
