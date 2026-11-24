// PipiUI memory-extension agent half.
//
// The loopback memory broker package (`resources/runtime/pi-ext/packages/
// memory-broker`) stays the single implementation and the worker identity
// root: children remount the broker's own fail-closed package identity, and
// the Hermes adapter (pi-hermes-memory 0.11.0) remains an internal
// compatibility layer behind it — not an extension API contract. This
// manifest extension is the distribution wrapper that makes the memory
// system a standalone, discoverable extension package. The Electron host
// keeps project identity binding, spawn environment sanitization, subagent
// capability issuance, and model credentials.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installMemoryBrokerExtension } from "../../../pi-ext/packages/memory-broker/extensions/memory-broker.ts";

export * from "../../../pi-ext/packages/memory-broker/extensions/memory-broker.ts";

export default async function installMemoryExtension(pi: ExtensionAPI): Promise<void> {
  await installMemoryBrokerExtension(pi);
}
