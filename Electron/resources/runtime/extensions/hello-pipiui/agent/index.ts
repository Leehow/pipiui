import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "hello-pipiui";
const BRIDGE_PORT = process.env.PIPIUI_BRIDGE_PORT;
const SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;

function settingsSnapshot(): unknown {
  const token = EXTENSION_ID.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  const raw = process.env[`PIPIUI_EXT_SETTINGS_${token || "EXT"}`];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * D4 agent → app: POST the namespaced `ext.emit` envelope to the host bridge.
 * Requires capability `bridge.emit`, a minted sessionCapability, and this id mounted on the session.
 * Do not open a fourth transport; do not talk to the renderer directly.
 */
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
    // Bridge is observability; tool/command results are the source of truth.
  }
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: EXTENSION_ID,
    label: "hello-pipiui",
    description: "Sample tool from the create-pipiui-extension skeleton. Replace with real work.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const payload = { ok: true, greeting: settingsSnapshot() ?? "hello" };
      await emit("hello", payload);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        details: payload,
      };
    },
  });

  // App → agent: host `invokeExtension(id, method, params)` is answered here.
  // Return ExtInvokeResult: { ok: true, data } | { ok: false, error: { code, message } }.
  pi.registerCommand(EXTENSION_ID, {
    description: "Sample invoke target for hello-pipiui",
    handler: async (args) => {
      const data = { args: args ?? "", settings: settingsSnapshot() };
      await emit("invoked", data);
      return { ok: true, data };
    },
  });
}
