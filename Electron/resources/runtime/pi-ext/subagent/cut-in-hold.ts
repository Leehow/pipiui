import { readFileSync, unlinkSync } from "node:fs";

export const CUT_IN_HOLD_MS = 15_000;

type CutInMarker = { at?: unknown; pendingUserInput?: unknown; ownerPid?: unknown };

function readMarker(file: string | null): CutInMarker | undefined {
	if (!file) return undefined;
	try {
		const value: unknown = JSON.parse(readFileSync(file, "utf8"));
		return value && typeof value === "object" ? value as CutInMarker : undefined;
	} catch {
		return undefined;
	}
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

/** Host queue markers last until the queue drains, not just the first 15s of a long turn. */
export function cutInHoldActive(
	file: string | null,
	now = Date.now(),
	isAlive: (pid: number) => boolean = processAlive,
): boolean {
	const marker = readMarker(file);
	if (!marker) return false;
	if (marker.pendingUserInput === true) {
		return Number.isInteger(marker.ownerPid) && (marker.ownerPid as number) > 0
			&& isAlive(marker.ownerPid as number);
	}
	return typeof marker.at === "number" && Number.isFinite(marker.at)
		&& now - marker.at >= 0 && now - marker.at < CUT_IN_HOLD_MS;
}

/** Only the host may clear its queue projection; a user input can release legacy cut-in holds. */
export function releaseCutInHold(file: string | null): void {
	if (!file || readMarker(file)?.pendingUserInput === true) return;
	try {
		unlinkSync(file);
	} catch {
		/* already gone */
	}
}
