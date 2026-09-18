import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFlapcodeBootstrap } from "./bootstrap.js";
import { stripUnsupportedFlapcodeParams } from "./client.js";
import { resolveFlapcodeApiKey } from "./config.js";
import { createFlapcodeProvider, FLAPCODE_PROVIDER_ID } from "./provider.js";
import { captureFlapcodeRateLimitHeaders } from "./quota.js";
// TEMPORARY DIAGNOSTIC — remove before landing.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
let dumpSeq = 0;
function dumpPayload(payload: unknown): void {
  const dir = process.env.PI_CODING_AGENT_DIR;
  if (!dir || !existsSync(join(dir, "flapcode-debug"))) return;
  try {
    writeFileSync(join(dir, `flapcode-req-${String(dumpSeq++ % 6).padStart(2, "0")}.json`), JSON.stringify(payload) + "\n");
  } catch { /* diagnostic only */ }
}

/** Minimal shape of the hook context this extension reads. */
type FlapcodeHookContext = {
  model?: { provider?: string };
  modelRegistry?: { getApiKeyForProvider?(provider: string): Promise<string | undefined> };
};

function isFlapcodeModel(model: { provider?: string } | undefined): boolean {
  return (model?.provider || "").toLowerCase() === FLAPCODE_PROVIDER_ID;
}

export default function (pi: ExtensionAPI): void {
  const registration = createFlapcodeProvider();
  pi.registerProvider(FLAPCODE_PROVIDER_ID, registration as never);

  // Subscription snapshot for the quota pill. The relay itself stays pinned;
  // see bootstrap.ts for why no gateway discovery runs here.
  const bootstrap = createFlapcodeBootstrap();

  // The relay 400s on parameters pi always sends (live-probed:
  // max_output_tokens, prompt_cache_retention); strip them on the wire.
  pi.on(
    "before_provider_request",
    (event: { payload?: unknown }, ctx: FlapcodeHookContext) => {
      if (!isFlapcodeModel(ctx.model)) return;
      // First Flapcode traffic is also the first context that can hand us the
      // key pi resolved, including a provider login stored in auth.json.
      const registry = ctx.modelRegistry;
      if (registry?.getApiKeyForProvider) {
        bootstrap.runWith(() => registry.getApiKeyForProvider!(FLAPCODE_PROVIDER_ID));
      }
      dumpPayload(event.payload);
      return stripUnsupportedFlapcodeParams(event.payload);
    },
  );

  // The relay forwards the ChatGPT Codex x-codex-* rate-limit headers on every
  // response; persist them for the host quota pill (there is no standalone
  // usage endpoint to probe).
  pi.on(
    "after_provider_response",
    (event: { headers?: Record<string, unknown> }, ctx: FlapcodeHookContext) => {
      if (!isFlapcodeModel(ctx.model)) return;
      captureFlapcodeRateLimitHeaders(event.headers, Date.now());
    },
  );

  // Vault/settings key: bootstrap right away, before any model is selected.
  bootstrap.run(resolveFlapcodeApiKey());
}
