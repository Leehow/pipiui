import { useEffect, useState } from "react";

type ExtInvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

type PanelApi = {
  invoke?: (method: string, params: unknown) => Promise<ExtInvokeResult>;
};

type IndexState = "ready" | "degraded" | "未启用" | "loading";

/**
 * toolPanel 索引状态占位面板。Reads invokeExtension("status") and shows
 * ready / degraded / 未启用. Skeleton sidecar always reports degraded.
 */
export default function Panel(props: { api?: PanelApi; id?: string; title?: string }) {
  const api = props.api;
  const [state, setState] = useState<IndexState>("loading");
  const [reason, setReason] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const invoke = api?.invoke;
    if (!invoke) {
      setState("未启用");
      setReason("invoke.agent 不可用");
      return;
    }
    void invoke("status", {}).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        const code = result.error.code;
        if (code === "disabled" || code === "not_found" || code === "no_session") {
          setState("未启用");
        } else {
          setState("degraded");
        }
        setReason(result.error.message);
        return;
      }
      const data = (result.data ?? {}) as Record<string, unknown>;
      const inner = (data.data ?? data) as Record<string, unknown>;
      if (inner.ready === true && inner.degraded !== true) {
        setState("ready");
      } else {
        setState("degraded");
      }
      setReason(typeof inner.reason === "string" ? inner.reason : "");
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <section data-testid="code-retrieval-panel">
      <h2>{props.title ?? "索引"}</h2>
      <p>
        状态：<strong>{state}</strong>
      </p>
      {reason ? <p>{reason}</p> : null}
    </section>
  );
}
