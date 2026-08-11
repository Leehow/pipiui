/** Privacy-preserving, versioned local-only Memory Center telemetry. */
export const MEMORY_RUNTIME_METRICS_VERSION = 1 as const;
export type MemoryRuntimeMetric = {
  version: typeof MEMORY_RUNTIME_METRICS_VERSION; at: number; triggered: boolean; skipped: boolean; abstain: boolean;
  resultCount: number; latencyMs: number; candidate: number; promotion: number; reject: number; supersede: number; stale: number; "delete": number; degraded: boolean;
};
export type MemoryRuntimeMetricsDTO = { version: typeof MEMORY_RUNTIME_METRICS_VERSION; platform: string; sampleCount: number; p95LatencyMs: number; totals: Record<Exclude<keyof MemoryRuntimeMetric, "version" | "at" | "latencyMs">, number> };
export class MemoryRuntimeMetricsCollector {
  private readonly events: MemoryRuntimeMetric[] = [];
  private readonly now: () => number;
  private readonly platform: string;
  constructor(now: () => number = Date.now, platform: string = process.platform) { this.now = now; this.platform = platform; }
  record(value: Partial<Omit<MemoryRuntimeMetric, "version" | "at">>): void {
    // Deliberately no query/body/token/typed-text field exists in this DTO.
    this.events.push({ version: 1, at: this.now(), triggered: false, skipped: false, abstain: false, resultCount: 0, latencyMs: 0, candidate: 0, promotion: 0, reject: 0, supersede: 0, stale: 0, "delete": 0, degraded: false, ...value });
  }
  summary(): MemoryRuntimeMetricsDTO {
    const samples = this.events.map((e) => e.latencyMs).sort((a, b) => a - b); const n = samples.length;
    const p95LatencyMs = n ? samples[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]! : 0;
    const total = (key: keyof MemoryRuntimeMetric) => this.events.reduce((sum, e) => sum + (typeof e[key] === "boolean" ? Number(e[key]) : Number(e[key] ?? 0)), 0);
    return { version: 1, platform: this.platform, sampleCount: n, p95LatencyMs, totals: { triggered: total("triggered"), skipped: total("skipped"), abstain: total("abstain"), resultCount: total("resultCount"), candidate: total("candidate"), promotion: total("promotion"), reject: total("reject"), supersede: total("supersede"), stale: total("stale"), "delete": total("delete"), degraded: total("degraded") } };
  }
}
