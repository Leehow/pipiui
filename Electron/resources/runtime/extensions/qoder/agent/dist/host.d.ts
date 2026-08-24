/**
 * Stable host library entry (`agent/dist/host.js`).
 *
 * The host generically loads `createAuthProvider` from the provider module.
 * This file re-exports the same factory so both hosts consume one source.
 */
export { AUTH_PROVIDER_ID, QODER_CN_PROVIDER_ID, QODER_PROVIDER_ID, createAuthProvider, createQoderProvider, } from "./provider.js";
export declare const HOST_LIBRARY_VERSION = "0.3.0";
