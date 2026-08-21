import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * M1 canonical skeleton — no OAuth/Images business logic.
 * Provider / tools wiring is intentionally deferred (Phase 2+).
 *
 * This module only establishes:
 * - a stable agent entry (loader verifies `agent/dist/index.js` exists)
 * - placeholder invoke handler + bridge emit so the app half can verify
 *   the `invoke.agent` / `bridge.emit` capabilities without real transport.
 *
 * Real provider `grok-build` and `image_gen`/`image_edit` tools will be
 * added in later phases. Do not call OAuth or images endpoints here.
 */
const EXTENSION_ID = "grok-build-oauth";
const BRIDGE_PORT = process.env.PIPIUI_BRIDGE_PORT;
const SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;

function settingsSnapshot(): unknown {
  const key = `PIPIUI_EXT_SETTINGS_${EXTENSION_ID.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function emit(event: string, payload?: unknown): Promise<void> {
  if (!BRIDGE_PORT || !SESSION_CAPABILITY) return;
  try {
    await fetch(`http://127.0.0.1:${BRIDGE_PORT}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: SESSION_CAPABILITY,
        action: "ext.emit",
        extensionId: EXTENSION_ID,
        event,
        payload,
      }),
    });
  } catch {
    // best-effort, no throw
  }
}

export default function (pi: ExtensionAPI): void {
  // Placeholder invoke handler — M1 only verifies `invoke.agent` wiring.
  // Real `login`/`logout`/`status` handlers arrive in Phase 2.
  pi.registerCommand(EXTENSION_ID, {
    description: "Grok Build OAuth (M1 skeleton, no transport)",
    handler: async (args) => {
      const data = {
        skeleton: true,
        phase: "m1",
        args: args ?? null,
        settings: settingsSnapshot(),
      };
      await emit("skeleton.invoke", data);
    },
  });

  // Placeholder tool: keeps `stream.render` wiring verifiable without calling xAI.
  pi.registerTool({
    name: "image_gen",
    label: "Grok Build image_gen (skeleton)",
    description: "Placeholder — real image generation ships after OAuth phases.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt" },
        aspect_ratio: { type: "string", description: "Aspect ratio (e.g. 16:9, auto)" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const payload = {
        skeleton: true,
        message: "grok-build-oauth M1 skeleton — no image request was made",
        params,
        settings: settingsSnapshot(),
      };
      await emit("skeleton.image_gen", payload);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        details: payload,
      };
    },
  });
}
