export const RESIDENT_RPC_SHUTDOWN_WAKE_STATUS_PREFIX = "pipiui-resident-rpc-wake:";

/** The opaque token is attempt-scoped and remains on the private RPC transport only. */
export function residentRpcShutdownWakeStatusKey(token: string): string {
	return `${RESIDENT_RPC_SHUTDOWN_WAKE_STATUS_PREFIX}${token}`;
}

type RpcStatusEvent = {
	type?: unknown;
	method?: unknown;
	statusKey?: unknown;
};

type RpcWritableStdin = {
	destroyed?: boolean;
	writable?: boolean;
	writableEnded?: boolean;
	write(chunk: string, callback?: (error?: Error | null) => void): unknown;
};

export interface ResidentRpcShutdownWakerOptions {
	statusKey: string;
	requestId: string;
	stdin: () => RpcWritableStdin | null | undefined;
	isResidentIdle: () => boolean;
	isClosed: () => boolean;
}

/**
 * Consumes only this attempt's shutdown-ready status and issues one read-only RPC
 * command. The bundled RPC runtime checks its already-set shutdown flag after every
 * command, so get_state closes an otherwise idle resident without a model turn.
 */
export function createResidentRpcShutdownWaker(options: ResidentRpcShutdownWakerOptions): {
	consume(event: unknown): boolean;
	dispose(): void;
} {
	let sent = false;
	let disposed = false;

	return {
		consume(event: unknown): boolean {
			const status = event as RpcStatusEvent | null;
			if (
				disposed ||
				sent ||
				options.isClosed() ||
				!options.isResidentIdle() ||
				status?.type !== "extension_ui_request" ||
				status.method !== "setStatus" ||
				status.statusKey !== options.statusKey
			) return false;

			const stdin = options.stdin();
			if (!stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable) return false;
			try {
				stdin.write(`${JSON.stringify({ id: options.requestId, type: "get_state" })}\n`, () => {
					// A closed pipe is already a terminal transport; never retry or prompt.
				});
				sent = true;
				return true;
			} catch {
				return false;
			}
		},
		dispose(): void {
			disposed = true;
		},
	};
}
