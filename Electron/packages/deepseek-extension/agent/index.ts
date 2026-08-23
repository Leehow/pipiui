import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rewriteDeepSeekPayloadAsync } from "./client.js";
import { createDeepSeekProvider, DEEPSEEK_PROVIDER_ID } from "./provider.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeepSeekModel(model: { provider?: string } | undefined): boolean {
  return (model?.provider || "").toLowerCase() === DEEPSEEK_PROVIDER_ID;
}

export default function (pi: ExtensionAPI): void {
  pi.registerProvider(DEEPSEEK_PROVIDER_ID, createDeepSeekProvider() as never);

  pi.on(
    "before_provider_request",
    async (event: { payload?: unknown }, ctx: { model?: { provider?: string } }) => {
      if (!isDeepSeekModel(ctx.model)) return;
      if (!isRecord(event.payload)) return;
      return rewriteDeepSeekPayloadAsync(event.payload);
    },
  );
}
