import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetchFlapcodeAccount, writeFlapcodeAccountSnapshot } from "./accounts.js";
import { stripUnsupportedFlapcodeParams } from "./client.js";
import { resolveFlapcodeApiKey, settingsSnapshot, SETTINGS_BASE_URL } from "./config.js";
import { discoverFlapcodeBaseUrl } from "./discovery.js";
import { createFlapcodeProvider, FLAPCODE_PROVIDER_ID } from "./provider.js";
import { captureFlapcodeRateLimitHeaders } from "./quota.js";

function isFlapcodeModel(model: { provider?: string } | undefined): boolean {
  return (model?.provider || "").toLowerCase() === FLAPCODE_PROVIDER_ID;
}

export default function (pi: ExtensionAPI): void {
  const registration = createFlapcodeProvider();
  pi.registerProvider(FLAPCODE_PROVIDER_ID, registration as never);

  // The relay 400s on parameters pi always sends (live-probed:
  // max_output_tokens, prompt_cache_retention); strip them on the wire.
  pi.on(
    "before_provider_request",
    (event: { payload?: unknown }, ctx: { model?: { provider?: string } }) => {
      if (!isFlapcodeModel(ctx.model)) return;
      return stripUnsupportedFlapcodeParams(event.payload);
    },
  );

  // The relay forwards the ChatGPT Codex x-codex-* rate-limit headers on every
  // response; persist them for the host quota pill (there is no standalone
  // usage endpoint to probe).
  pi.on(
    "after_provider_response",
    (event: { headers?: Record<string, unknown> }, ctx: { model?: { provider?: string } }) => {
      if (!isFlapcodeModel(ctx.model)) return;
      captureFlapcodeRateLimitHeaders(event.headers, Date.now());
    },
  );

  // Live probing established that the documented codex.flapcode.com gateway is
  // dead and each account's real relay URL comes from the Flapcode account API
  // (same endpoint the official CLI uses). Register immediately with the
  // default, then re-register with the discovered gateway when it differs.
  // pi applies post-load registerProvider calls immediately (no /reload).
  // A user-set ext.flapcode.baseUrl always wins, so discovery is skipped then.
  const apiKey = resolveFlapcodeApiKey();
  if (!apiKey) return;
  // Subscription surface for the quota pill (plan name + expiry); the relay
  // headers only carry the Codex plan type, not the flapcode 套餐/到期时间.
  void fetchFlapcodeAccount(apiKey).then((info) => {
    if (info) writeFlapcodeAccountSnapshot(info, Date.now());
  });
  if (settingsSnapshot()?.[SETTINGS_BASE_URL]) return;
  void discoverFlapcodeBaseUrl(apiKey).then((discovered) => {
    if (!discovered || discovered === registration.baseUrl) return;
    pi.registerProvider(
      FLAPCODE_PROVIDER_ID,
      createFlapcodeProvider({ baseUrl: discovered, apiKey }) as never,
    );
  });
}
