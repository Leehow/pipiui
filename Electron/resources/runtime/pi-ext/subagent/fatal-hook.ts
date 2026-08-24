/**
 * Fail-closed hook errors (PipiUI).
 *
 * BUG BEING FIXED
 * ---------------
 * Official `ExtensionRunner.emitBeforeProviderRequest` swallows every handler
 * throw (`@earendil-works/pi-coding-agent` `dist/core/extensions/runner.js`)
 * and still returns the current payload. A Structured Output pending request
 * whose hook cannot take / normalize / apply therefore degrades into a normal
 * send. Host `assertReadyToSend` only gates capability / Responses API.
 *
 * THIS LAYER
 * ----------
 * Replaces `emitBeforeProviderRequest` with the same loop + `emitError`
 * isolation, then rethrows only errors tagged `pipiuiFatalHook` /
 * `PipiUIFatalHookError`. Ordinary third-party hook throws stay swallowed.
 * node_modules is not patched; fetch-pi-runtime cannot overwrite this wrap.
 */

const INSTALLED = Symbol.for("pipiui.fatalHook.installed");
const LOG_PREFIX = "[pipiui-fatal-hook]";

export const PIPIUI_FATAL_HOOK_ERROR = "PipiUIFatalHookError";

export type FatalHookRunner = {
	prototype: {
		emitBeforeProviderRequest: (payload: unknown) => Promise<unknown>;
		createContext?: () => unknown;
		emitError?: (error: {
			extensionPath: string;
			event: string;
			error: string;
			stack?: string;
		}) => void;
		extensions?: Array<{
			path: string;
			handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
		}>;
	};
};

export function isPipiUIFatalHookError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const value = error as { name?: unknown; pipiuiFatalHook?: unknown };
	return value.pipiuiFatalHook === true || value.name === PIPIUI_FATAL_HOOK_ERROR;
}

export function installFatalHookPropagation(runnerClass: FatalHookRunner): boolean {
	const proto = runnerClass.prototype as FatalHookRunner["prototype"] & {
		[INSTALLED]?: boolean;
		createContext: () => unknown;
		emitError: (error: {
			extensionPath: string;
			event: string;
			error: string;
			stack?: string;
		}) => void;
		extensions: Array<{
			path: string;
			handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
		}>;
	};
	if (proto[INSTALLED]) return false;

	proto.emitBeforeProviderRequest = async function emitBeforeProviderRequestFailClosed(
		payload: unknown,
	): Promise<unknown> {
		const ctx = this.createContext();
		let currentPayload = payload;
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("before_provider_request");
			if (!handlers || handlers.length === 0) continue;
			for (const handler of handlers) {
				try {
					const handlerResult = await handler(
						{ type: "before_provider_request", payload: currentPayload },
						ctx,
					);
					if (handlerResult !== undefined) currentPayload = handlerResult;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "before_provider_request",
						error: message,
						stack,
					});
					if (isPipiUIFatalHookError(err)) throw err;
				}
			}
		}
		return currentPayload;
	};
	proto[INSTALLED] = true;
	return true;
}

/**
 * Extension entry: patch `ExtensionRunner.prototype` once.
 *
 * Must receive the live class from an ESM import. `@earendil-works/pi-coding-agent`
 * is ESM-only (`exports.import` only), so `createRequire` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` and the guard never installs.
 */
export function registerFatalHookPropagation(runnerClass?: FatalHookRunner): void {
	try {
		if (!runnerClass) {
			console.error(`${LOG_PREFIX} ExtensionRunner not found; fatal hook propagation not installed`);
			return;
		}
		installFatalHookPropagation(runnerClass);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} install failed: ${message}`);
	}
}
