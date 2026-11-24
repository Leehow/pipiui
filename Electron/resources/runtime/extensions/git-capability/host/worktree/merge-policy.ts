/** Durable, monotonic merge policy for a logical worker (shared by all its runs). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorktreeMergePolicyV1 } from "./schema.ts";

function policyFile(mainCwd: string, agentId: string): string {
	return join(mainCwd, ".pi", "worktree-policies", `${encodeURIComponent(agentId)}.json`);
}

/** Missing legacy records mean auto; unreadable/invalid records must not permit merging. */
export function readWorktreeMergePolicyV1(mainCwd: string, agentId: string): WorktreeMergePolicyV1 {
	let raw: string;
	try {
		raw = readFileSync(policyFile(mainCwd, agentId), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "auto";
		throw error;
	}
	const record = JSON.parse(raw);
	if (record?.schemaVersion !== 1 || record.agentId !== agentId || record.mergePolicy !== "never") {
		throw new Error(`invalid retained worktree merge policy for ${agentId}`);
	}
	return "never";
}

/** A never declaration cannot be downgraded, including by an explicit later auto. */
export function retainWorktreeMergePolicyV1(
	mainCwd: string,
	agentId: string,
	requested?: WorktreeMergePolicyV1,
): WorktreeMergePolicyV1 {
	if (requested !== undefined && requested !== "auto" && requested !== "never") {
		throw new TypeError("mergePolicy must be auto or never");
	}
	const current = readWorktreeMergePolicyV1(mainCwd, agentId);
	if (current === "never" || requested !== "never") return current;
	const file = policyFile(mainCwd, agentId);
	mkdirSync(dirname(file), { recursive: true });
	try {
		writeFileSync(file, JSON.stringify({ schemaVersion: 1, agentId, mergePolicy: "never" }) + "\n", { flag: "wx", mode: 0o600 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		return readWorktreeMergePolicyV1(mainCwd, agentId);
	}
	return "never";
}
