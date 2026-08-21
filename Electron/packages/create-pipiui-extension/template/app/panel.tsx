import type { ExtensionApi } from "@pipiui/extension-api";

/**
 * Controlled panel (L1). Injected services exist only for declared capabilities.
 * Never read `window.pipiHost` — that is the full host API, not the extension public API.
 */
export default function Panel(props: { api?: ExtensionApi }) {
  const api = props.api;
  return (
    <section>
      <h2>__NAME__</h2>
      <p>Replace this panel. Call only injected services (settings / invoke / notify).</p>
      <button
        type="button"
        onClick={() => {
          void api?.invoke?.("hello", {});
        }}
      >
        Ping agent
      </button>
    </section>
  );
}
