/**
 * Runtime-side reverse /rpc for browser-watch triggers.
 *
 * Main process has no ExtensionAPI. After subscribe, it POSTs
 * action=browser_watch_trigger to this loopback server; we call
 * deliverBrowserWatchFollowUp.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
	deliverBrowserWatchFollowUp,
	type BrowserWatchDeliveryInput,
	type BrowserWatchTriggerReason,
} from "./browser-watch-delivery.ts";

export const BROWSER_WATCH_TRIGGER_ACTION = "browser_watch_trigger";

export type BrowserWatchCallbackServer = {
	port: number;
	close(): Promise<void>;
};

function readBody(request: IncomingMessage, limit = 64 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) {
				request.destroy();
				reject(new Error("payload too large"));
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

function reply(response: ServerResponse, status: number, payload: unknown): void {
	if (response.writableEnded) return;
	const data = Buffer.from(JSON.stringify(payload));
	response.writeHead(status, { "content-type": "application/json", "content-length": data.length });
	response.end(data);
}

function parseTrigger(event: Record<string, unknown>): BrowserWatchDeliveryInput | undefined {
	const watchId = typeof event.watchId === "string" ? event.watchId.trim() : "";
	const reason = event.reason;
	if (!watchId) return undefined;
	if (reason !== "matched" && reason !== "timeout" && reason !== "disposed") return undefined;
	const waitedMs = typeof event.waitedMs === "number" && Number.isFinite(event.waitedMs) ? event.waitedMs : 0;
	return {
		watchId,
		reason: reason as BrowserWatchTriggerReason,
		waitedMs,
		...(typeof event.url === "string" ? { url: event.url } : {}),
		...(typeof event.title === "string" ? { title: event.title } : {}),
	};
}

export async function startBrowserWatchCallbackServer(options: {
	secret: string;
	deliver?: (input: BrowserWatchDeliveryInput) => boolean;
}): Promise<BrowserWatchCallbackServer> {
	const deliver = options.deliver ?? deliverBrowserWatchFollowUp;
	const server: Server = createServer((request, response) => {
		void (async () => {
			if (request.method !== "POST" || (request.url ?? "").split("?")[0] !== "/rpc") {
				reply(response, 404, { ok: false, error: "not found" });
				request.resume();
				return;
			}
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				reply(response, 400, { ok: false, error: "invalid JSON body" });
				return;
			}
			if (!body || typeof body !== "object") {
				reply(response, 400, { ok: false, error: "invalid JSON body" });
				return;
			}
			const rec = body as Record<string, unknown>;
			if (rec.schemaVersion !== 1 || rec.sessionCapability !== options.secret) {
				reply(response, 403, { ok: false, error: "unauthorized bridge capability" });
				return;
			}
			if (rec.action !== BROWSER_WATCH_TRIGGER_ACTION) {
				reply(response, 400, { ok: false, error: `unsupported action ${String(rec.action)}` });
				return;
			}
			const event = rec.event;
			if (!event || typeof event !== "object") {
				reply(response, 400, { ok: false, error: "missing event" });
				return;
			}
			const input = parseTrigger(event as Record<string, unknown>);
			if (!input) {
				reply(response, 400, { ok: false, error: "invalid browser_watch_trigger" });
				return;
			}
			const ok = deliver(input);
			reply(response, ok ? 200 : 503, { ok });
		})().catch(() => {
			reply(response, 500, { ok: false, error: "callback failed" });
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (typeof address === "string" || address === null) {
		server.close();
		throw new Error("browser-watch callback failed to bind");
	}
	return {
		port: address.port,
		close: () => new Promise(resolve => server.close(() => resolve())),
	};
}
