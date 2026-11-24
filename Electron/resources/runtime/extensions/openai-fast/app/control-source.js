import { capable, visible, modelKey, preferencePath, parsePreference, validSessionIdentity } from "../shared/policy.js";

export function createComposerAction(React) {
  const {createElement: h, useEffect, useState, useRef} = React;
  return function FastControl({api, sessionId, model, disabled}) {
    const key = model && visible(model) ? `${sessionId}:${modelKey(model)}` : "";
    const [state, setState] = useState(null), [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const current = useRef(key); current.current = key;
    const operation = useRef(0), refreshOrder = useRef(0), writing = useRef(null);
    useEffect(() => {
      let disposed = false;
      setState(null); setError(""); setPending(false); operation.current++; refreshOrder.current++; writing.current = null;
      if (!key) return;
      if (!validSessionIdentity(sessionId)) {
        setState({key, preference: {version: 1, enabled: false, revision: null}, observation: null});
        return;
      }
      const path = preferencePath(sessionId, model);
      async function refresh() {
        if (writing.current?.key === key) return;
        const version = operation.current, order = ++refreshOrder.current;
        const valid = () => !disposed && current.current === key && operation.current === version &&
          refreshOrder.current === order && writing.current?.key !== key;
        try {
          if (!api.data?.read || !api.data?.write) throw Error("Fast control is unavailable");
          const prefFile = await api.data.read(path, {allowMissing: true, tailBytes: 4096});
          if (prefFile.truncated) throw Error("Invalid Fast preference");
          const preference = parsePreference(prefFile.content);
          if (!valid()) return;
          const observed = await api.data.read(path + ".status.json", {allowMissing: true, tailBytes: 4096});
          const observation = observed.content && !observed.truncated ? JSON.parse(observed.content) : null;
          if (valid())
            setState({key, preference, observation: observation?.model === modelKey(model) ? observation : null});
        } catch (err) {
          if (valid()) setError(err.message || "Fast control is unavailable");
        }
      }
      void refresh();
      const timer = setInterval(refresh, 1500);
      return () => { disposed = true; clearInterval(timer); };
    }, [api, key]);
    if (!key) return null;
    const ready = state?.key === key && !pending && capable(model) && validSessionIdentity(sessionId);
    const enabled = state?.key === key && !!state.preference.enabled;
    const observation = state?.key === key ? state.observation : null;
    const latest = observation && observation.revision === state.preference.revision;
    const status = latest ? observation.status : null;
    const suffix = state?.key !== key ? "loading" : !enabled ? "off" : status === "effective" ? "effective"
      : status === "default" ? "standard" : status === "unsupported" ? "unsupported"
      : status === "unknown" ? "unconfirmed" : "requested";
    const help = ["Fast requests priority for this session and model; higher usage may apply.",
      "Off requests default. Current requests keep their captured choice; changes apply to the next request.",
      enabled ? "Priority requested; server adoption is not guaranteed." : "Fast is off.",
      observation ? `Last response: ${observation.effectiveTier || "unreported"}.` : "No server tier has been observed.",
      observation?.costBasis?.includes("price-unverified") ? "Tier price is unverified; the pinned SDK catalog estimate is not a verified charge." : "",
      model.provider === "flapcode" ? "Relay acceptance/charging is unverified; default means Fast was not adopted." : "Costs are catalog estimates, not subscription consumption.",
      !validSessionIdentity(sessionId) ? "Create a session before saving a Fast preference." : "",
      !capable(model) ? "This model API does not support the Fast request contract." : ""].join(" ");
    async function toggle() {
      if (!ready || disabled || writing.current?.key === key) return;
      const version = ++operation.current;
      writing.current = {key, version};
      setPending(true); setError("");
      const preference = {version: 1, enabled: !enabled, revision: `${Date.now()}-${Math.random().toString(36).slice(2)}`};
      try {
        await api.data.write(preferencePath(sessionId, model), JSON.stringify(preference));
        if (current.current === key && operation.current === version) setState({key, preference, observation: null});
      } catch (err) {
        if (current.current === key && operation.current === version) setError(err.message || "Fast preference could not be saved");
      } finally {
        if (current.current === key && operation.current === version) {
          // Invalidate every read begun around this write, including reads before React rendered pending.
          operation.current++; writing.current = null; setPending(false);
        }
      }
    }
    return h("span", {className: "fast-control", style: {display: "inline-flex", alignItems: "center", gap: "4px"}},
      h("button", {type: "button", className: "thinking-chip fast-chip", "data-testid": "fast-chip",
        "aria-label": `Fast ${suffix}`, "aria-pressed": enabled,
        disabled: disabled || !ready, title: help, onClick: toggle,
        style: {color: enabled ? "var(--accent)" : undefined}}, `⚡ Fast · ${suffix}`),
      error && h("span", {role: "alert", style: {fontSize: "11px"}}, error,
        h("button", {type: "button", "aria-label": "Dismiss Fast error", onClick: () => setError("")}, "×")));
  };
}
