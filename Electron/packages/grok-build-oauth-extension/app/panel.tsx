import type { ExtensionHostAPI } from "@pipiui/extension-api";

/**
 * M1 panel placeholder — no OAuth flow, no image request.
 * Controlled component: only injected `api` (settings/invoke/subscribeExt) may be used.
 */
export default function Panel(props: { api?: ExtensionHostAPI }) {
  const api = props.api;
  return (
    <section style={{ padding: 12 }}>
      <h2 style={{ margin: "0 0 8px" }}>Grok Build</h2>
      <p style={{ margin: "0 0 12px", opacity: 0.7 }}>
        M1 skeleton — OAuth / Images transport ships in later phases. This panel only verifies
        the extension loader, settings schema, and bridge wiring.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            void api?.invoke?.("ping", { skeleton: true });
          }}
        >
          Ping agent (skeleton)
        </button>
        <button
          type="button"
          onClick={() => {
            void api?.settings?.get?.();
          }}
        >
          Read settings
        </button>
      </div>
      <p style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
        id: grok-build-oauth · scope: app · capabilities: settings.read/write, bridge.emit, invoke.agent, stream.render
      </p>
    </section>
  );
}
