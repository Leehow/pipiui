import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  normalizeExperienceCandidate,
  type MemoryExperienceCandidate,
} from "#memory-broker-contract";
import { MEMORY_BROKER_HTTP_VERSION } from "./protocol.ts";
import type { MemoryBrokerServer } from "./server.ts";

const VERSION = 1;
const MANIFEST_KIND = "pipiui-controlled-memory-import-manifest";
const ENTRY_KIND = "pipiui-controlled-memory-import-entry";
const MAX_IMPORT_BYTES = 256 * 1024;
const MAX_IMPORT_ENTRIES = 512;

type Manifest = {
  version: number;
  kind: typeof MANIFEST_KIND;
  migrationID: string;
  count: number;
  contentHash: string;
};

type LegacyEntry = {
  version: number;
  kind: typeof ENTRY_KIND;
  migrationID: string;
  id: string;
  scope: "user" | "project";
  projectPath?: string | null;
  content: string;
};

type Receipt = {
  version: number;
  migrationID: string;
  count: number;
  contentHash: string;
  success: boolean;
  detail?: string;
};

type Progress = {
  version: number;
  migrationID: string;
  count: number;
  contentHash: string;
  completedIDs: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "memory import failed");
  return text.replace(/[\u0000\r\n]/gu, " ").trim().slice(0, 240) || "memory import failed";
}

function parseImport(raw: string): { manifest: Manifest; entries: LegacyEntry[] } {
  if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES) throw new Error("legacy memory import is too large");
  const values = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
  const [manifestRaw, ...entryRaw] = values;
  if (!isRecord(manifestRaw)
    || manifestRaw.version !== VERSION
    || manifestRaw.kind !== MANIFEST_KIND
    || typeof manifestRaw.migrationID !== "string"
    || typeof manifestRaw.count !== "number"
    || typeof manifestRaw.contentHash !== "string") {
    throw new Error("legacy memory import manifest is invalid");
  }
  const manifest = manifestRaw as Manifest;
  if (!Number.isInteger(manifest.count) || manifest.count < 0 || manifest.count > MAX_IMPORT_ENTRIES
    || !/^[a-f0-9]{64}$/u.test(manifest.contentHash)) {
    throw new Error("legacy memory import manifest is invalid");
  }
  const entries = entryRaw.map((value) => {
    if (!isRecord(value)
      || value.version !== VERSION
      || value.kind !== ENTRY_KIND
      || value.migrationID !== manifest.migrationID
      || typeof value.id !== "string"
      || (value.scope !== "user" && value.scope !== "project")
      || typeof value.content !== "string"
      || (value.projectPath !== undefined && value.projectPath !== null && typeof value.projectPath !== "string")) {
      throw new Error("legacy memory import entry is invalid");
    }
    return value as LegacyEntry;
  });
  if (entries.length !== manifest.count || new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("legacy memory import count is invalid");
  }
  const hash = contentHash(entries);
  if (hash !== manifest.contentHash) throw new Error("legacy memory import hash is invalid");
  return { manifest, entries };
}

/** Deterministic cross-host identity order: raw UTF-8 bytes, never locale. */
function compareUTF8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function contentHash(entries: LegacyEntry[]): string {
  const payload = [...entries]
    .sort((left, right) => compareUTF8Bytes(left.id, right.id))
    .map((entry) => [entry.id, entry.scope, entry.projectPath ?? "", entry.content].join("\u001f"))
    .join("\u001e");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Legacy content conversion is package-owned. It is deliberately a single
 * non-secret, durable main candidate per approved entry; the Swift host merely
 * transports the versioned legacy records and never recreates broker policy.
 */
function candidateFromLegacyEntry(entry: LegacyEntry, migrationID: string): MemoryExperienceCandidate {
  return normalizeExperienceCandidate({
    kind: "experience",
    claimKind: "observation",
    claim: entry.content,
    scope: "project",
    provenance: "outcome",
    outcome: "success",
    evidence: [{ summary: `Imported approved Controlled Memory entry ${entry.id} (${entry.scope}).` }],
    sourceRuns: [`controlled-memory-import:${migrationID}`],
  });
}

async function writeJSON(path: string, value: Receipt | Progress): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readMatchingJSON<T extends Receipt | Progress>(
  path: string,
  manifest: Manifest,
): Promise<T | undefined> {
  try {
    const value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
    if (!isRecord(value)
      || value.version !== VERSION
      || value.migrationID !== manifest.migrationID
      || value.count !== manifest.count
      || value.contentHash !== manifest.contentHash) return undefined;
    return value as T;
  } catch {
    return undefined;
  }
}

/** Main-only import. A receipt is written only after every durable candidate is read back. */
export async function importControlledMemoryIfRequested(
  server: MemoryBrokerServer,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const importPath = env.PIPIUI_MEMORY_BROKER_IMPORT_FILE?.trim();
  const receiptPath = env.PIPIUI_MEMORY_BROKER_IMPORT_RECEIPT_FILE?.trim();
  if (!importPath || !receiptPath) return;
  let manifest: Manifest | undefined;
  try {
    const parsed = parseImport(await readFile(resolve(importPath), "utf8"));
    manifest = parsed.manifest;
    const existingReceipt = await readMatchingJSON<Receipt>(receiptPath, parsed.manifest);
    if (existingReceipt?.success) return;
    const progressPath = `${receiptPath}.progress`;
    const existingProgress = await readMatchingJSON<Progress>(progressPath, parsed.manifest);
    const completedIDs = new Set(existingProgress?.completedIDs ?? []);
    for (const entry of parsed.entries) {
      if (completedIDs.has(entry.id)) continue;
      const candidate = candidateFromLegacyEntry(entry, parsed.manifest.migrationID);
      const response = await server.handleMainRequest({
        version: MEMORY_BROKER_HTTP_VERSION,
        operation: "experience.submit",
        candidate,
        promote: true,
      });
      if (!response.ok || !response.acceptedDedupeKey) {
        throw new Error(response.error || "legacy memory import was rejected");
      }
      if (!await server.verifyMainImportedCandidate(candidate)) {
        throw new Error("legacy memory import readback did not verify");
      }
      completedIDs.add(entry.id);
      await writeJSON(progressPath, {
        version: VERSION,
        migrationID: parsed.manifest.migrationID,
        count: parsed.manifest.count,
        contentHash: parsed.manifest.contentHash,
        completedIDs: [...completedIDs].sort(),
      });
    }
    await writeJSON(receiptPath, {
      version: VERSION,
      migrationID: parsed.manifest.migrationID,
      count: parsed.manifest.count,
      contentHash: parsed.manifest.contentHash,
      success: true,
    });
  } catch (error) {
    if (manifest && receiptPath) {
      await writeJSON(receiptPath, {
        version: VERSION,
        migrationID: manifest.migrationID,
        count: manifest.count,
        contentHash: manifest.contentHash,
        success: false,
        detail: boundedError(error),
      }).catch(() => {});
    }
  }
}
