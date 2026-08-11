// PipiUI bundled local Pi package entrypoint. Main mode composes the pinned
// upstream Hermes package; worker/operator modes remain client-only.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installMemoryBrokerExtension } from "../src/extension.ts";

export * from "../src/extension.ts";

export default async function installMemoryBroker(pi: ExtensionAPI): Promise<void> {
  await installMemoryBrokerExtension(pi);
}
