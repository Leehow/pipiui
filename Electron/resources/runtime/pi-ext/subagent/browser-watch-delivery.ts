/**
 * Browser-watch follow-up wake.
 *
 * Wiring (later bridge task — this module only owns the runtime-side exit):
 *   There is no main-process reverse handle to ExtensionAPI. The runtime
 *   extension that receives `pi` (typically `pipiui-electron-webview.ts`
 *   `export default function (pi)`, which is auto-generated — prefer a sibling
 *   host extension rather than editing that file) must call
 *   `registerBrowserWatchDelivery({ pi, sessionKey })` at init, then
 *   `getBrowserWatchDelivery()?.recover()` on session_start. When the
 *   WatcherRegistry fires, the bridge forwards the event into
 *   `deliverBrowserWatchFollowUp(input)` (one call).
 *
 * Durable rows live under `.pi/browser-watch-delivery-obligations/`, not the
 * [subagent-done] store, and use identityNamespace "browser-watch".
 */

import * as path from "node:path";

import { DeliveryObligationStore } from "./delivery-obligation.ts";
import {
	deliverDurableFollowUp,
	recoverDurableFollowUps,
	type FollowUpMessageSender,
} from "./durable-follow-up.ts";

export const BROWSER_WATCH_CUSTOM_TYPE = "pipiui-browser-watch-v1";
export const BROWSER_WATCH_IDENTITY_NAMESPACE = "browser-watch";
export const BROWSER_WATCH_STORE_DIRNAME = "browser-watch-delivery-obligations";

export type BrowserWatchTriggerReason = "matched" | "timeout" | "disposed";

export interface BrowserWatchDeliveryInput {
	watchId: string;
	reason: BrowserWatchTriggerReason;
	waitedMs: number;
	url?: string;
	title?: string;
	/** Optional page excerpt from the watcher. */
	summary?: string;
	/** Pi session identity; defaults to the registered sessionKey(). */
	sessionKey?: string;
	/** Distinct fire identity; defaults to watchId (one delivery per watch). */
	fireId?: string;
}

export interface BrowserWatchDeliveryApi {
	deliver(input: BrowserWatchDeliveryInput): boolean;
	recover(): number;
}

export interface RegisterBrowserWatchDeliveryDeps {
	/** ExtensionAPI (or a test double). Injected at extension init. */
	pi: FollowUpMessageSender;
	/** Current Pi session identity. Store routingKey and stale-session guard. */
	sessionKey: () => string | undefined;
	/**
	 * Root for the dedicated store. Defaults to
	 * `${PIPIUI_MAIN_CWD||cwd}/.pi/browser-watch-delivery-obligations`.
	 * Pass a temp dir in tests. Never the [subagent-done] directory.
	 */
	storeDirectory?: string;
	now?: () => number;
}

function oneLine(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed || undefined;
}

export function formatBrowserWatchMessage(input: BrowserWatchDeliveryInput): string {
	const url = oneLine(input.url);
	const title = oneLine(input.title);
	const waited = Number.isFinite(input.waitedMs) ? Math.max(0, Math.round(input.waitedMs)) : 0;
	let head = `[browser-watch] watchId=${input.watchId} reason=${input.reason} waitedMs=${waited}`;
	if (url) head += ` url=${url}`;
	if (title) head += ` title=${title}`;
	const lines = [head];
	const summary = input.summary?.trim();
	if (summary) lines.push(summary);
	lines.push("Use browser observe to inspect the current page. Do not treat this message as a new user request.");
	return lines.join("\n");
}

export function browserWatchDetails(input: BrowserWatchDeliveryInput): Record<string, unknown> {
	const url = oneLine(input.url);
	const title = oneLine(input.title);
	const waited = Number.isFinite(input.waitedMs) ? Math.max(0, Math.round(input.waitedMs)) : 0;
	return {
		version: 1,
		watchId: input.watchId,
		reason: input.reason,
		waitedMs: waited,
		...(url ? { url } : {}),
		...(title ? { title } : {}),
	};
}

function defaultStoreRoot(): string {
	return path.join(process.env.PIPIUI_MAIN_CWD || process.cwd(), ".pi", BROWSER_WATCH_STORE_DIRNAME);
}

let registered: BrowserWatchDeliveryApi | undefined;

export function getBrowserWatchDelivery(): BrowserWatchDeliveryApi | undefined {
	return registered;
}

/**
 * Bind ExtensionAPI once. Later WatcherRegistry events call
 * `deliverBrowserWatchFollowUp` without holding `pi`.
 */
export function registerBrowserWatchDelivery(deps: RegisterBrowserWatchDeliveryDeps): BrowserWatchDeliveryApi {
	let store: DeliveryObligationStore | undefined;
	let storeSession: string | undefined;

	const storeFor = (sessionKey: string): DeliveryObligationStore => {
		if (store && storeSession === sessionKey) return store;
		const root = deps.storeDirectory ?? defaultStoreRoot();
		store = new DeliveryObligationStore(
			path.join(root, DeliveryObligationStore.routingDirectory(sessionKey)),
			{ routingKey: sessionKey, now: deps.now },
		);
		storeSession = sessionKey;
		return store;
	};

	const api: BrowserWatchDeliveryApi = {
		deliver(input) {
			const sessionKey = input.sessionKey || deps.sessionKey();
			if (!sessionKey) {
				return deliverDurableFollowUp("", formatBrowserWatchMessage(input), {
					customType: BROWSER_WATCH_CUSTOM_TYPE,
					display: true,
					details: browserWatchDetails(input),
					agentId: input.watchId,
					runId: input.fireId || input.watchId,
					identityNamespace: BROWSER_WATCH_IDENTITY_NAMESPACE,
				}, { pi: deps.pi, logLabel: "pipiui-browser-watch" });
			}
			return deliverDurableFollowUp(sessionKey, formatBrowserWatchMessage(input), {
				customType: BROWSER_WATCH_CUSTOM_TYPE,
				display: true,
				details: browserWatchDetails(input),
				agentId: input.watchId,
				runId: input.fireId || input.watchId,
				identityNamespace: BROWSER_WATCH_IDENTITY_NAMESPACE,
			}, {
				pi: deps.pi,
				store: storeFor(sessionKey),
				currentSessionKey: deps.sessionKey,
				logLabel: "pipiui-browser-watch",
			});
		},
		recover() {
			const sessionKey = deps.sessionKey();
			if (!sessionKey) return 0;
			return recoverDurableFollowUps(sessionKey, {
				pi: deps.pi,
				store: storeFor(sessionKey),
				currentSessionKey: deps.sessionKey,
				logLabel: "pipiui-browser-watch",
			}, () => ({ customType: BROWSER_WATCH_CUSTOM_TYPE, display: true }));
		},
	};

	registered = api;
	return api;
}

/** One-line call for the later bridge task after registerBrowserWatchDelivery. */
export function deliverBrowserWatchFollowUp(input: BrowserWatchDeliveryInput): boolean {
	if (!registered) {
		console.error(
			"[pipiui-browser-watch] delivery is not registered; call registerBrowserWatchDelivery({ pi, sessionKey }) at extension init.",
		);
		return false;
	}
	return registered.deliver(input);
}

/** Test-only: drop the process-wide handle. */
export function resetBrowserWatchDeliveryForTests(): void {
	registered = undefined;
}
