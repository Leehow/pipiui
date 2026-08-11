import { mkdir, readFile, rename as renameFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PortableStateStorageAdapterV1 } from "./persistence.ts";

function errorCode(error: unknown): unknown {
	if (error !== null && typeof error === "object" && "code" in error) return (error as { code?: unknown }).code;
	return undefined;
}

/**
 * Node/Electron-main adapter. Reducers and generic persistence stay free of Node
 * imports; Electron can instead inject any adapter implementing the same contract.
 */
export function createNodeFsStorageAdapterV1(): PortableStateStorageAdapterV1 {
	return {
		async readText(path: string): Promise<string | undefined> {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				if (errorCode(error) === "ENOENT") return undefined;
				throw error;
			}
		},
		async writeText(path: string, text: string): Promise<void> {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
		},
		rename: renameFile,
	};
}
