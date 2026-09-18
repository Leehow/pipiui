/**
 * Canonical `flapcode` provider config (single source).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers it via `pi.registerProvider`;
 * - the host generically loads `createAuthProvider` from this module for any
 *   extension that declares `auth.provider` (no Flapcode-named special case).
 *
 * The API key lives in the extension secret vault and reaches this process as
 * `EXT_FLAPCODE_APIKEY`; this module only carries code and non-secret config.
 */

import { randomUUID } from "node:crypto";
import { resolveFlapcodeConfig } from "./config.js";
import {
  AUTH_PROVIDER_ID,
  FLAPCODE_PROVIDER_ID,
  FLAPCODE_PROVIDER_NAME,
  flapcodeManifestModels,
  type FlapcodeModel,
} from "./models.js";

export { AUTH_PROVIDER_ID, FLAPCODE_PROVIDER_ID, FLAPCODE_PROVIDER_NAME };
export {
  FLAPCODE_BASE_URL,
  FLAPCODE_DEFAULT_MODEL_ID,
  FLAPCODE_MODELS,
  flapcodeManifestModels,
  type FlapcodeModel,
} from "./models.js";
export { API_KEY_ENV, resolveFlapcodeApiKey, resolveFlapcodeConfig } from "./config.js";
export { stripUnsupportedFlapcodeParams } from "./client.js";

export type FlapcodeProviderOptions = {
  baseUrl?: string;
  /** Explicit/test key override. Never read from ~/.pi or auth.json. */
  apiKey?: string;
  /** Explicit/test session id override; defaults to one UUID per call. */
  sessionId?: string;
};

/**
 * Build the provider registration payload. The shape matches pi's extension
 * `registerProvider` contract; the host ModelRuntime's `registerProvider`
 * accepts the same fields.
 *
 * Two Flapcode relay quirks, both established by live probing:
 * - `authHeader: true` puts the resolved key on `Authorization: Bearer`.
 * - The relay 400s every request without a `session-id` header (hyphenated —
 *   pi's own `session_id` / `x-session-id` affinity headers are rejected), so
 *   we pin one random UUID per provider instance. A static header is fine:
 *   the relay uses it for account-session routing, not conversation state.
 */
export function createFlapcodeProvider(options: FlapcodeProviderOptions = {}): {
  name: string;
  api: "openai-responses";
  baseUrl: string;
  authHeader: true;
  headers: Record<string, string>;
  apiKey?: string;
  models: FlapcodeModel[];
} {
  const cfg = resolveFlapcodeConfig(options);
  return {
    name: FLAPCODE_PROVIDER_NAME,
    api: "openai-responses",
    baseUrl: cfg.baseUrl,
    authHeader: true,
    headers: { "session-id": options.sessionId ?? randomUUID() },
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    models: flapcodeManifestModels(),
  };
}

/** Generic host/loader export — same factory, no Flapcode-named import required. */
export const createAuthProvider = createFlapcodeProvider;
