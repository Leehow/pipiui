// shared/policy.js
var DATA_ROOT = ".pi/agent/openai-fast";
var FLAPCODE_OPENAI_MODELS = Object.freeze([
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.5"
]);
function visible(model) {
  return model?.provider === "openai-codex" || model?.provider === "flapcode" && FLAPCODE_OPENAI_MODELS.includes(model.id);
}
function capable(model) {
  return visible(model) && (model.provider === "openai-codex" ? !model.api || model.api === "openai-codex-responses" : !model.api || model.api === "openai-responses");
}
function modelKey(model) {
  return `${model.provider}/${model.id}`;
}
function validSessionIdentity(sessionId) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId || "");
}
function preferencePath(sessionId, model) {
  if (!validSessionIdentity(sessionId)) throw Error("Invalid session identity");
  const component = (value) => encodeURIComponent(value).replaceAll(".", "%2E");
  return `${DATA_ROOT}/${sessionId}_${component(model.provider)}_${component(model.id)}.json`;
}
function parsePreference(text) {
  if (!text) return { version: 1, enabled: false, revision: null };
  const data = JSON.parse(text);
  if (data?.version !== 1 || typeof data.enabled !== "boolean" || typeof data.revision !== "string")
    throw Error("Invalid Fast preference");
  return { version: 1, enabled: data.enabled, revision: data.revision };
}

// app/control-source.js
function createComposerAction(React) {
  const { createElement: h, useEffect, useState, useRef } = React;
  return function FastControl({ api, sessionId, model, disabled }) {
    const key = model && visible(model) ? `${sessionId}:${modelKey(model)}` : "";
    const [state, setState] = useState(null), [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const current = useRef(key);
    current.current = key;
    const operation = useRef(0), refreshOrder = useRef(0), writing = useRef(null);
    useEffect(() => {
      let disposed = false;
      setState(null);
      setError("");
      setPending(false);
      operation.current++;
      refreshOrder.current++;
      writing.current = null;
      if (!key) return;
      if (!validSessionIdentity(sessionId)) {
        setState({ key, preference: { version: 1, enabled: false, revision: null }, observation: null });
        return;
      }
      const path = preferencePath(sessionId, model);
      async function refresh() {
        if (writing.current?.key === key) return;
        const version = operation.current, order = ++refreshOrder.current;
        const valid = () => !disposed && current.current === key && operation.current === version && refreshOrder.current === order && writing.current?.key !== key;
        try {
          if (!api.data?.read || !api.data?.write) throw Error("Fast control is unavailable");
          const prefFile = await api.data.read(path, { allowMissing: true, tailBytes: 4096 });
          if (prefFile.truncated) throw Error("Invalid Fast preference");
          const preference = parsePreference(prefFile.content);
          if (!valid()) return;
          const observed = await api.data.read(path + ".status.json", { allowMissing: true, tailBytes: 4096 });
          const observation2 = observed.content && !observed.truncated ? JSON.parse(observed.content) : null;
          if (valid())
            setState({ key, preference, observation: observation2?.model === modelKey(model) ? observation2 : null });
        } catch (err) {
          if (valid()) setError(err.message || "Fast control is unavailable");
        }
      }
      void refresh();
      const timer = setInterval(refresh, 1500);
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    }, [api, key]);
    if (!key) return null;
    const ready = state?.key === key && !pending && capable(model) && validSessionIdentity(sessionId);
    const enabled = state?.key === key && !!state.preference.enabled;
    const observation = state?.key === key ? state.observation : null;
    const latest = observation && observation.revision === state.preference.revision;
    const status = latest ? observation.status : null;
    const suffix = state?.key !== key ? "loading" : !enabled ? "off" : status === "effective" ? "effective" : status === "default" ? "standard" : status === "unsupported" ? "unsupported" : status === "unknown" ? "unconfirmed" : "requested";
    const help = [
      "Fast requests priority for this session and model; higher usage may apply.",
      "Off requests default. Current requests keep their captured choice; changes apply to the next request.",
      enabled ? "Priority requested; server adoption is not guaranteed." : "Fast is off.",
      observation ? `Last response: ${observation.effectiveTier || "unreported"}.` : "No server tier has been observed.",
      observation?.costBasis?.includes("price-unverified") ? "Tier price is unverified; the pinned SDK catalog estimate is not a verified charge." : "",
      model.provider === "flapcode" ? "Relay acceptance/charging is unverified; default means Fast was not adopted." : "Costs are catalog estimates, not subscription consumption.",
      !validSessionIdentity(sessionId) ? "Create a session before saving a Fast preference." : "",
      !capable(model) ? "This model API does not support the Fast request contract." : ""
    ].join(" ");
    async function toggle() {
      if (!ready || disabled || writing.current?.key === key) return;
      const version = ++operation.current;
      writing.current = { key, version };
      setPending(true);
      setError("");
      const preference = { version: 1, enabled: !enabled, revision: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      try {
        await api.data.write(preferencePath(sessionId, model), JSON.stringify(preference));
        if (current.current === key && operation.current === version) setState({ key, preference, observation: null });
      } catch (err) {
        if (current.current === key && operation.current === version) setError(err.message || "Fast preference could not be saved");
      } finally {
        if (current.current === key && operation.current === version) {
          operation.current++;
          writing.current = null;
          setPending(false);
        }
      }
    }
    return h(
      "span",
      { className: "fast-control", style: { display: "inline-flex", alignItems: "center", gap: "4px" } },
      h("button", {
        type: "button",
        className: "thinking-chip fast-chip",
        "data-testid": "fast-chip",
        "aria-label": `Fast ${suffix}`,
        "aria-pressed": enabled,
        disabled: disabled || !ready,
        title: help,
        onClick: toggle,
        style: { color: enabled ? "var(--accent)" : void 0 }
      }, `\u26A1 Fast \xB7 ${suffix}`),
      error && h(
        "span",
        { role: "alert", style: { fontSize: "11px" } },
        error,
        h("button", { type: "button", "aria-label": "Dismiss Fast error", onClick: () => setError("") }, "\xD7")
      )
    );
  };
}
export {
  createComposerAction
};
