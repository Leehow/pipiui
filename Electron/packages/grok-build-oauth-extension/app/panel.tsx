import { useCallback, useEffect, useState } from "react";
import type { ExtensionHostAPI, ExtInvokeResult } from "@pipiui/extension-api";

/**
 * M5 Grok Build panel (controlled component — only the injected `api`).
 * Shows: 登录状态 / 过期时间 / 凭证来源 / base+model / tier 提示 / compat fallback 开关.
 * Live status comes from the agent half via `invoke("status")` when a session is
 * mounted; without a session it degrades to settings-derived info + guidance.
 * Credential values never reach this surface (metadata only).
 */

type StatusData = {
  loggedIn?: boolean;
  expired?: boolean;
  expiresAtMs?: number;
  hasRefresh?: boolean;
  credentialSource?: "oauth" | "env";
  baseUrl?: string;
  model?: string;
  tier?: string;
  tierSource?: "override" | "credential" | "unknown";
  tierRaw?: string;
  compatFallback?: boolean;
};

function formatExpiry(expiresAtMs: number): string {
  const remaining = expiresAtMs - Date.now();
  if (!Number.isFinite(remaining)) return "有效期未知";
  if (remaining <= 0) return "已过期";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return `剩余 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `剩余 ${hours} 小时`;
  return `剩余 ${Math.floor(hours / 24)} 天`;
}

export default function Panel(props: { api?: ExtensionHostAPI }) {
  const api = props.api;
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<StatusData | undefined>(undefined);
  const [statusError, setStatusError] = useState<string | undefined>(undefined);
  const [statusErrorDismissed, setStatusErrorDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const values = await api.settings?.get?.();
      if (values) setSettings(values);
    } catch {
      /* settings unreadable — keep previous snapshot */
    }
    const result: ExtInvokeResult | undefined = await api.invoke?.("status", {}).catch(() => undefined);
    if (result?.ok && result.data && typeof result.data === "object") {
      setStatus(result.data as StatusData);
      setStatusError(undefined);
      setStatusErrorDismissed(false);
    } else {
      setStatus(undefined);
      const code = result && !result.ok ? result.error.code : "no_session";
      setStatusError(
        code === "no_session"
          ? "暂无活跃会话，无法查询实时凭证状态；打开一个会话后重试。"
          : "实时状态查询失败（需要在会话中挂载本扩展）。",
      );
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    if (!api) return;
    const unsubscribe = api.subscribeExt((event) => {
      if (event.type === "token_refreshed" || event.type === "auth_error") void refresh();
    });
    return unsubscribe;
  }, [api, refresh]);

  const compatFromSettings = settings["ext.grok-build-oauth.compatFallback"] === true;
  const compat = status?.compatFallback ?? compatFromSettings;
  // Presentation only — tier resolution stays env > settings > undefined
  // (agent images/config.ts). Unknown/empty is never hidden: an explicit empty
  // string is gated as the free tier (restricted), undefined means "unknown"
  // and the server stays the final authority (fail-open).
  const settingsTier = settings["ext.grok-build-oauth.tier"];
  // Live tier evidence: the session's own resolution actually found tier data —
  // a mapped name (tier), an unmapped raw claim (tierRaw), or an explicit
  // override/credential source. A live tier=undefined with ONLY a raw claim is
  // still credential evidence (unmapped JWT claim → unknown name, fail-open):
  // the value shows unknown/raw while the source stays “登录凭证” — it is never
  // relabeled 未知/设置 just because the claim had no official mapping. A
  // session reporting NO tier evidence at all (tierSource "unknown") is not
  // evidence and still falls back to the settings slot below.
  const liveTier =
    status !== undefined &&
    (status.tier !== undefined ||
      status.tierRaw !== undefined ||
      status.tierSource === "override" ||
      status.tierSource === "credential");
  const tierValue: string | undefined = liveTier
    ? status?.tier
    : typeof settingsTier === "string"
      ? settingsTier
      : undefined;
  const tierLabel =
    tierValue === undefined
      ? status?.tierRaw !== undefined
        ? `unknown（claim=${status.tierRaw}，fail-open）`
        : "unknown（未配置；受限与否由服务端最终裁决）"
      : tierValue.trim() === ""
        ? "空（受限 — 按官方 free tier 处理）"
        : tierValue;
  const tierSourceLabel = liveTier
    ? status?.tierSource === "override"
      ? "手动配置"
      : status?.tierSource === "credential"
        ? "登录凭证"
        : "未知"
    : // No live tier evidence (no session, or a session that itself reports
      // none): the value shown above came from the settings slot — label it
      // as such instead of "未知". Unknown (no value anywhere) and an
      // explicitly EMPTY (restricted) tier stay visible as before.
      typeof settingsTier === "string"
      ? "设置"
      : "未知";

  const toggleCompat = async (next: boolean) => {
    setBusy(true);
    try {
      await api?.settings?.update?.({ "ext.grok-build-oauth.compatFallback": next });
      setSettings((prev) => ({ ...prev, "ext.grok-build-oauth.compatFallback": next }));
    } finally {
      setBusy(false);
    }
  };

  const loginState = status
    ? status.loggedIn
      ? status.expired
        ? "已登录（凭证已过期）"
        : "已登录"
      : "未登录"
    : "未知";
  const source = status?.credentialSource
    ? status.credentialSource === "oauth"
      ? "OAuth（grok-build provider）"
      : "环境变量 XAI_API_KEY（deprecated 兼容，仅 compatFallback 开启时使用）"
    : undefined;

  return (
    <section style={{ padding: 12 }} data-testid="grok-build-panel">
      <h2 style={{ margin: "0 0 8px" }}>Grok Build</h2>
      <table style={{ borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.7 }}>登录状态</td>
            <td data-testid="grok-build-login-state">{loginState}</td>
          </tr>
          {status?.expiresAtMs !== undefined && (
            <tr>
              <td style={{ padding: "2px 12px 2px 0", opacity: 0.7 }}>到期时间</td>
              <td data-testid="grok-build-expiry">
                {new Date(status.expiresAtMs).toLocaleString()}（{formatExpiry(status.expiresAtMs)}）
              </td>
            </tr>
          )}
          {source && (
            <tr>
              <td style={{ padding: "2px 12px 2px 0", opacity: 0.7 }}>凭证来源</td>
              <td data-testid="grok-build-source">{source}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.7 }}>请求路径</td>
            <td style={{ wordBreak: "break-all" }}>
              {status?.baseUrl ?? (settings["ext.grok-build-oauth.xaiApiBaseUrl"] as string | undefined) ?? "https://api.x.ai/v1"}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.7 }}>图像模型</td>
            <td>{status?.model ?? (settings["ext.grok-build-oauth.defaultModel"] as string | undefined) ?? "grok-imagine-image-quality"}</td>
          </tr>
          <tr>
            <td style={{ padding: "2px 12px 2px 0", opacity: 0.7 }}>订阅 tier（仅提示）</td>
            <td data-testid="grok-build-tier">
              {tierLabel}（来源：{tierSourceLabel}）
            </td>
          </tr>
        </tbody>
      </table>

      {statusError && !statusErrorDismissed && (
        <p
          style={{ margin: "0 0 8px", fontSize: 12, opacity: 0.7, display: "flex", gap: 8, alignItems: "center" }}
          data-testid="grok-build-status-note"
        >
          <span style={{ flex: 1 }}>{statusError}</span>
          <button
            type="button"
            aria-label="关闭状态提示"
            title="关闭状态提示"
            data-testid="grok-build-status-note-close"
            onClick={() => setStatusErrorDismissed(true)}
          >
            ×
          </button>
        </p>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8 }}>
        <input
          type="checkbox"
          data-testid="grok-build-compat-toggle"
          checked={compat}
          disabled={busy}
          onChange={(event) => void toggleCompat(event.target.checked)}
        />
        <span>
          compat fallback（deprecated，默认关闭）
          <br />
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            仅当 grok-build 未登录或凭证过期且无 refresh 时，才回退旧 xAI API key / loopback relay 兼容路径；对新会话生效。
          </span>
        </span>
      </label>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => void refresh()}>
          刷新状态
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
        登录 / 重新登录：设置 &gt; 添加模型/供应商 中选择 Grok Build，或在会话内执行
        <code>/login grok-build</code>；退出登录执行 <code>/logout grok-build</code>。
        凭证保存在当前项目 Pi 家的 auth.json（provider auth），不写入设置 JSON。
      </p>
    </section>
  );
}
