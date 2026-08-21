import { closeSync, constants as fsConstants, existsSync, openSync, renameSync, statSync, writeSync } from "node:fs";

/** Post-mortem tag for the 2026-08-21 main-process 100% CPU freeze. Grep this; remove with the probe. */
export const FREEZE_PROBE_PREFIX = "[DEBUG-h129]";
export const FREEZE_PROBE_FILE = "pipiui-debug-h129.jsonl";
const LINE_CAP = 1_999;
const FILE_ROTATE_BYTES = 6 * 1024 * 1024;

export type FreezeProbeFields = Record<string, string | number | boolean | undefined>;

type ProbeSink = (line: string) => void;

let sink: ProbeSink | undefined;
let historyScanInflight = 0;
let historyScanPeak = 0;
let historyIpcInflight = 0;
let historyIpcPeak = 0;

export function resetFreezeProbeForTests(): void {
  sink = undefined;
  historyScanInflight = 0;
  historyScanPeak = 0;
  historyIpcInflight = 0;
  historyIpcPeak = 0;
}

export function historyScanInflightCount(): number {
  return historyScanInflight;
}

export function historyScanPeakCount(): number {
  return historyScanPeak;
}

export function historyIpcInflightCount(): number {
  return historyIpcInflight;
}

export function formatFreezeProbeLine(kind: string, fields: FreezeProbeFields, now = Date.now()): string {
  const parts = [`kind=${kind}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${String(value).replace(/\s+/g, "_").slice(0, 180)}`);
  }
  return `${FREEZE_PROBE_PREFIX} t=${now} ${parts.join(" ")}`.slice(0, LINE_CAP);
}

export function installFreezeProbe(filePath: string, writeLine?: ProbeSink): void {
  if (!writeLine) {
    try {
      if (existsSync(filePath) && statSync(filePath).size > FILE_ROTATE_BYTES) {
        renameSync(filePath, `${filePath}.prev`);
      }
    } catch {
      /* probe must never affect host startup */
    }
  }
  sink = writeLine ?? ((line) => appendProbeLine(filePath, line));
}

export function freezeProbe(kind: string, fields: FreezeProbeFields = {}): string {
  const line = formatFreezeProbeLine(kind, fields);
  // File gets every event. Stderr only when overlapping or slow, so tests stay quiet.
  const noisy = Number(fields.inflight ?? 0) > 1
    || Number(fields.peak ?? 0) > 1
    || Number(fields.ms ?? 0) >= 100
    || Number(fields.stringifyMs ?? 0) >= 50
    || Number(fields.parseMs ?? 0) >= 50;
  if (noisy) console.warn(line);
  try { sink?.(line); } catch { /* probe must not throw */ }
  return line;
}

export function freezeProbeHistoryIpcStart(fields: FreezeProbeFields): void {
  historyIpcInflight += 1;
  if (historyIpcInflight > historyIpcPeak) historyIpcPeak = historyIpcInflight;
  freezeProbe("history_ipc_start", { ...fields, inflight: historyIpcInflight, peak: historyIpcPeak });
}

export function freezeProbeHistoryIpcEnd(fields: FreezeProbeFields): void {
  historyIpcInflight = Math.max(0, historyIpcInflight - 1);
  freezeProbe("history_ipc_end", { ...fields, inflight: historyIpcInflight, peak: historyIpcPeak });
}

export function freezeProbeHistoryScanStart(fields: FreezeProbeFields): void {
  historyScanInflight += 1;
  if (historyScanInflight > historyScanPeak) historyScanPeak = historyScanInflight;
  freezeProbe("history_scan_start", { ...fields, inflight: historyScanInflight, peak: historyScanPeak });
}

export function freezeProbeHistoryScanEnd(fields: FreezeProbeFields): void {
  historyScanInflight = Math.max(0, historyScanInflight - 1);
  freezeProbe("history_scan_end", { ...fields, inflight: historyScanInflight, peak: historyScanPeak });
}

function appendProbeLine(filePath: string, line: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT, 0o600);
    writeSync(descriptor, `${line}\n`, undefined, "utf8");
  } catch {
    /* a missing sink must not affect the host */
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* best-effort */ }
    }
  }
}
