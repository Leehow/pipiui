/**
 * Stable host library entry (`agent/dist/host.js`).
 *
 * The host generically loads `createAuthProvider` from the provider module.
 * This file re-exports the same factory so both hosts consume one source.
 */

export {
  AUTH_PROVIDER_ID,
  FLAPCODE_MODELS,
  FLAPCODE_PROVIDER_ID,
  FLAPCODE_PROVIDER_NAME,
  createAuthProvider,
  createFlapcodeProvider,
  flapcodeManifestModels,
} from "./provider.js";

export const HOST_LIBRARY_VERSION = "1.0.0";
