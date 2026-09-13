/**
 * Live discovery of the account's actual Flapcode relay gateway.
 *
 * Established by probing with a real key (2026-09): the documented
 * `codex.flapcode.com` gateway rejects every TLS handshake
 * (unrecognized_name), while each account's working relay URL is served by
 * `https://flapcode.com/api/cli/config?provider=codex` — the same endpoint
 * the official Flapcode CLI uses, authenticated with the same relay API key.
 * Observed shape:
 *   { "api_token": "sk-flapcode-…", "account_email": "…",
 *     "base_url": "https://codex.takemoon.com/v1",
 *     "provider_name": "flapcode", "model": "gpt-5.6-sol" }
 */

import { normalizeBaseUrl } from "./config.js";

export const FLAPCODE_CONFIG_URL = "https://flapcode.com/api/cli/config?provider=codex";

export type FlapcodeAccountConfig = {
  api_token?: string;
  account_email?: string;
  base_url?: string;
  provider_name?: string;
  model?: string;
};

const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Returns the account's relay base URL (HTTPS-validated), or undefined when
 * the key is rejected, the endpoint is unreachable, or the payload has no
 * usable `base_url`. Never throws: discovery failure must not break
 * registration — the provider simply stays on its default gateway.
 */
export async function discoverFlapcodeBaseUrl(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(FLAPCODE_CONFIG_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as FlapcodeAccountConfig;
    if (typeof data?.base_url !== "string" || !data.base_url.trim()) return undefined;
    return normalizeBaseUrl(data.base_url);
  } catch {
    return undefined;
  }
}
