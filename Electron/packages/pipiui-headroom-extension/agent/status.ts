import type { RuntimeSnapshot } from "./types.js";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatStatus(snapshot: RuntimeSnapshot, detailed = false): string {
  const compact = snapshot.fallbackReason
    ? "Headroom fallback · context-fold active"
    : snapshot.ownsPrimary
      ? snapshot.tokensSaved > 0
        ? `Headroom primary · saved ${number.format(snapshot.tokensSaved)} unique tokens`
        : "Headroom primary · online"
      : snapshot.enabled
        ? snapshot.config.managed && snapshot.worker.state === "warming"
          ? "Headroom preparing · context-fold active"
          : `Headroom ${snapshot.worker.state} · context-fold active`
        : "Headroom off · context-fold active";
  if (!detailed) return compact;
  return [
    compact,
    `upstream baseline ${snapshot.upstreamVersion}`,
    `engine ${snapshot.config.managed ? "managed by PipiUI" : "external"} · endpoint ${snapshot.config.baseUrl}`,
    `model ${snapshot.modelId}`,
    `worker ${snapshot.worker.state} · queue ${snapshot.worker.queued} · active ${snapshot.worker.active}`,
    `prepared ${snapshot.worker.accepted} accepted · ${snapshot.worker.rejected} rejected · ${snapshot.worker.skipped} noop`,
    `unique applied ${snapshot.uniqueSubstitutions} · context applications ${snapshot.substitutions} · unique tokens saved ${number.format(snapshot.tokensSaved)} · bytes saved ${number.format(snapshot.bytesSaved)}`,
    `rewrite gate ${snapshot.rewriteGate?.activeTurn ? "active" : snapshot.rewriteGate?.armed ? "armed" : "waiting"} · threshold ${number.format((snapshot.rewriteGate?.usageFraction ?? 0.45) * 100)}% + ${number.format((snapshot.rewriteGate?.quietDelayMs ?? 240_000) / 60_000)}m quiet`,
    `cache ${number.format(snapshot.cache.bytes)}/${number.format(snapshot.cache.maxBytes)} bytes`,
    `retrievals ${snapshot.retrievals}`,
    `fallback ${snapshot.fallbackReason ?? "none"}`,
    `warnings ${snapshot.warnings.length ? snapshot.warnings.join(" | ") : "none"}`,
  ].join("\n");
}

export function formatStats(snapshot: RuntimeSnapshot): string {
  return [
    formatStatus(snapshot),
    `candidates ${snapshot.worker.candidates}`,
    `accepted ${snapshot.worker.accepted}`,
    `rejected ${snapshot.worker.rejected}`,
    `dropped ${snapshot.worker.dropped}`,
    `unique substitutions ${snapshot.uniqueSubstitutions}`,
    `context applications ${snapshot.substitutions}`,
    `unique tokens saved ${snapshot.tokensSaved}`,
    `bytes saved ${snapshot.bytesSaved}`,
    `retrievals ${snapshot.retrievals}`,
  ].join("\n");
}
