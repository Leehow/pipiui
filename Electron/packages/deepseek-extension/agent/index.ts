import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeHostedWebSearchTool, rewriteDeepSeekPayloadAsync } from "./client.js";
import { modelSupportsHostedWebSearch } from "./models.js";
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
    async (event: { payload?: unknown }, ctx: { model?: { provider?: string; id?: unknown } }) => {
      if (!isDeepSeekModel(ctx.model)) return;
      if (!isRecord(event.payload)) return;
      // Server-native search is enabled from declared model capabilities only:
      // supported models get the official Responses built-in `{type:"web_search"}`
      // (never a local function tool); unsupported models are left untouched.
      const payload = mergeHostedWebSearchTool(event.payload, modelSupportsHostedWebSearch(ctx.model?.id));
      return rewriteDeepSeekPayloadAsync(payload);
    },
  );
}
