/**
 * Storage is deliberately small and promise-based so Electron can inject its own
 * app-data, encrypted, or IPC-backed implementation. Callers always choose the
 * path; this slice never derives a project/user-repository location.
 */
export type PortableStateStorageAdapterV1 = {
	readText(path: string): Promise<string | undefined>;
	writeText(path: string, text: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
};

export type VersionedStateDecodeResultV1<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

export type VersionedStateCodecV1<T> = {
	schemaVersion: number;
	createEmpty(): T;
	decode(raw: unknown): VersionedStateDecodeResultV1<T>;
	encode(state: T): unknown;
};

export type PortableStateLoadStatusV1 =
	| "loaded"
	| "missing"
	| "corrupt"
	| "future_schema"
	| "unsupported_schema"
	| "storage_error";

export type PortableStateLoadResultV1<T> = {
	status: PortableStateLoadStatusV1;
	state: T;
	/** False means a later save must not replace the file without explicit migration. */
	writable: boolean;
	error?: string;
};

export type PortableStateSaveResultV1 =
	| { ok: true; stagingPath: string }
	| {
			ok: false;
			reason: "invalid_state" | "corrupt_existing" | "future_schema" | "unsupported_schema" | "storage_error";
			error?: string;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsedJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
	}
}

function schemaVersionOf(value: unknown): number | undefined {
	if (!isRecord(value) || typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion)) return undefined;
	return value.schemaVersion;
}

/**
 * Loads only the current schema. A malformed or newer file is left untouched and
 * returns an empty in-memory state so a UI can remain available without risking
 * destructive overwrite of user data.
 */
export async function loadVersionedStateV1<T>(
	storage: PortableStateStorageAdapterV1,
	path: string,
	codec: VersionedStateCodecV1<T>,
): Promise<PortableStateLoadResultV1<T>> {
	let text: string | undefined;
	try {
		text = await storage.readText(path);
	} catch (error) {
		return {
			status: "storage_error",
			state: codec.createEmpty(),
			writable: false,
			error: error instanceof Error ? error.message : "storage read failed",
		};
	}
	if (text === undefined) return { status: "missing", state: codec.createEmpty(), writable: true };

	const parsed = parsedJson(text);
	if (!parsed.ok) return { status: "corrupt", state: codec.createEmpty(), writable: false, error: parsed.error };
	const version = schemaVersionOf(parsed.value);
	if (version === undefined) {
		return { status: "corrupt", state: codec.createEmpty(), writable: false, error: "missing integer schemaVersion" };
	}
	if (version > codec.schemaVersion) {
		return { status: "future_schema", state: codec.createEmpty(), writable: false, error: `schemaVersion ${version} is newer than ${codec.schemaVersion}` };
	}
	if (version !== codec.schemaVersion) {
		return { status: "unsupported_schema", state: codec.createEmpty(), writable: false, error: `unsupported schemaVersion ${version}` };
	}
	const decoded = codec.decode(parsed.value);
	if (!decoded.ok) return { status: "corrupt", state: codec.createEmpty(), writable: false, error: decoded.error };
	return { status: "loaded", state: decoded.value, writable: true };
}

/**
 * Writes via a same-directory staging file then rename. Before writing, the target
 * is re-read: corrupt, unsupported, and future schema files are protected rather
 * than silently replaced. This check also protects a future Electron process that
 * updated the state after the caller's earlier load.
 */
export async function saveVersionedStateV1<T>(
	storage: PortableStateStorageAdapterV1,
	path: string,
	codec: VersionedStateCodecV1<T>,
	state: T,
): Promise<PortableStateSaveResultV1> {
	const encoded = codec.encode(state);
	const validated = codec.decode(encoded);
	if (!validated.ok) return { ok: false, reason: "invalid_state", error: validated.error };

	let current: string | undefined;
	try {
		current = await storage.readText(path);
	} catch (error) {
		return { ok: false, reason: "storage_error", error: error instanceof Error ? error.message : "storage read failed" };
	}
	if (current !== undefined) {
		const parsed = parsedJson(current);
		if (!parsed.ok) return { ok: false, reason: "corrupt_existing", error: parsed.error };
		const version = schemaVersionOf(parsed.value);
		if (version === undefined) return { ok: false, reason: "corrupt_existing", error: "missing integer schemaVersion" };
		if (version > codec.schemaVersion) return { ok: false, reason: "future_schema" };
		if (version !== codec.schemaVersion) return { ok: false, reason: "unsupported_schema" };
		const currentState = codec.decode(parsed.value);
		if (!currentState.ok) return { ok: false, reason: "corrupt_existing", error: currentState.error };
	}

	const stagingPath = `${path}.staging`;
	try {
		await storage.writeText(stagingPath, `${JSON.stringify(validated.value, null, 2)}\n`);
		await storage.rename(stagingPath, path);
		return { ok: true, stagingPath };
	} catch (error) {
		return { ok: false, reason: "storage_error", error: error instanceof Error ? error.message : "storage write failed" };
	}
}
