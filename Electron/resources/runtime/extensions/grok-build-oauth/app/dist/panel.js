import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
function formatExpiry(expiresAtMs) {
    const remaining = expiresAtMs - Date.now();
    if (!Number.isFinite(remaining))
        return "有效期未知";
    if (remaining <= 0)
        return "已过期";
    const minutes = Math.floor(remaining / 60_000);
    if (minutes < 60)
        return `剩余 ${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48)
        return `剩余 ${hours} 小时`;
    return `剩余 ${Math.floor(hours / 24)} 天`;
}
export default function Panel(props) {
    const api = props.api;
    const [settings, setSettings] = useState({});
    const [status, setStatus] = useState(undefined);
    const [statusError, setStatusError] = useState(undefined);
    const [statusErrorDismissed, setStatusErrorDismissed] = useState(false);
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        if (!api)
            return;
        try {
            const values = await api.settings?.get?.();
            if (values)
                setSettings(values);
        }
        catch {
            /* settings unreadable — keep previous snapshot */
        }
        const result = await api.invoke?.("status", {}).catch(() => undefined);
        if (result?.ok && result.data && typeof result.data === "object") {
            setStatus(result.data);
            setStatusError(undefined);
            setStatusErrorDismissed(false);
        }
        else {
            setStatus(undefined);
            const code = result && !result.ok ? result.error.code : "no_session";
            setStatusError(code === "no_session"
                ? "暂无活跃会话，无法查询实时凭证状态；打开一个会话后重试。"
                : "实时状态查询失败（需要在会话中挂载本扩展）。");
        }
    }, [api]);
    useEffect(() => {
        void refresh();
        if (!api)
            return;
        const unsubscribe = api.subscribeExt((event) => {
            if (event.type === "token_refreshed" || event.type === "auth_error")
                void refresh();
        });
        return unsubscribe;
    }, [api, refresh]);
    const compatFromSettings = settings["ext.grok-build-oauth.compatFallback"] === true;
    const compat = status?.compatFallback ?? compatFromSettings;
    const toggleCompat = async (next) => {
        setBusy(true);
        try {
            await api?.settings?.update?.({ "ext.grok-build-oauth.compatFallback": next });
            setSettings((prev) => ({ ...prev, "ext.grok-build-oauth.compatFallback": next }));
        }
        finally {
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
    return (_jsxs("section", { style: { padding: 12 }, "data-testid": "grok-build-panel", children: [_jsx("h2", { style: { margin: "0 0 8px" }, children: "Grok Build" }), _jsx("table", { style: { borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }, children: _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { style: { padding: "2px 12px 2px 0", opacity: 0.7 }, children: "\u767B\u5F55\u72B6\u6001" }), _jsx("td", { "data-testid": "grok-build-login-state", children: loginState })] }), status?.expiresAtMs !== undefined && (_jsxs("tr", { children: [_jsx("td", { style: { padding: "2px 12px 2px 0", opacity: 0.7 }, children: "\u5230\u671F\u65F6\u95F4" }), _jsxs("td", { "data-testid": "grok-build-expiry", children: [new Date(status.expiresAtMs).toLocaleString(), "\uFF08", formatExpiry(status.expiresAtMs), "\uFF09"] })] })), source && (_jsxs("tr", { children: [_jsx("td", { style: { padding: "2px 12px 2px 0", opacity: 0.7 }, children: "\u51ED\u8BC1\u6765\u6E90" }), _jsx("td", { "data-testid": "grok-build-source", children: source })] })), _jsxs("tr", { children: [_jsx("td", { style: { padding: "2px 12px 2px 0", opacity: 0.7 }, children: "\u8BF7\u6C42\u8DEF\u5F84" }), _jsx("td", { style: { wordBreak: "break-all" }, children: status?.baseUrl ?? settings["ext.grok-build-oauth.xaiApiBaseUrl"] ?? "https://api.x.ai/v1" })] }), _jsxs("tr", { children: [_jsx("td", { style: { padding: "2px 12px 2px 0", opacity: 0.7 }, children: "\u56FE\u50CF\u6A21\u578B" }), _jsx("td", { children: status?.model ?? settings["ext.grok-build-oauth.defaultModel"] ?? "grok-imagine-image-quality" })] }), (status?.tier ?? settings["ext.grok-build-oauth.tier"]) && (_jsxs("tr", { children: [_jsx("td", { style: { padding: "2px 12px 2px 0", opacity: 0.7 }, children: "\u8BA2\u9605 tier\uFF08\u4EC5\u63D0\u793A\uFF09" }), _jsx("td", { children: String(status?.tier ?? settings["ext.grok-build-oauth.tier"]) })] }))] }) }), statusError && !statusErrorDismissed && (_jsxs("p", { style: { margin: "0 0 8px", fontSize: 12, opacity: 0.7, display: "flex", gap: 8, alignItems: "center" }, "data-testid": "grok-build-status-note", children: [_jsx("span", { style: { flex: 1 }, children: statusError }), _jsx("button", { type: "button", "aria-label": "\u5173\u95ED\u72B6\u6001\u63D0\u793A", title: "\u5173\u95ED\u72B6\u6001\u63D0\u793A", "data-testid": "grok-build-status-note-close", onClick: () => setStatusErrorDismissed(true), children: "\u00D7" })] })), _jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8 }, children: [_jsx("input", { type: "checkbox", "data-testid": "grok-build-compat-toggle", checked: compat, disabled: busy, onChange: (event) => void toggleCompat(event.target.checked) }), _jsxs("span", { children: ["compat fallback\uFF08deprecated\uFF0C\u9ED8\u8BA4\u5173\u95ED\uFF09", _jsx("br", {}), _jsx("span", { style: { fontSize: 12, opacity: 0.7 }, children: "\u4EC5\u5F53 grok-build \u672A\u767B\u5F55\u6216\u51ED\u8BC1\u8FC7\u671F\u4E14\u65E0 refresh \u65F6\uFF0C\u624D\u56DE\u9000\u65E7 xAI API key / loopback relay \u517C\u5BB9\u8DEF\u5F84\uFF1B\u5BF9\u65B0\u4F1A\u8BDD\u751F\u6548\u3002" })] })] }), _jsx("div", { style: { display: "flex", gap: 8, marginBottom: 8 }, children: _jsx("button", { type: "button", onClick: () => void refresh(), children: "\u5237\u65B0\u72B6\u6001" }) }), _jsxs("p", { style: { margin: 0, fontSize: 12, opacity: 0.7 }, children: ["\u767B\u5F55 / \u91CD\u65B0\u767B\u5F55\uFF1A\u8BBE\u7F6E > \u6DFB\u52A0\u6A21\u578B/\u4F9B\u5E94\u5546 \u4E2D\u9009\u62E9 Grok Build\uFF0C\u6216\u5728\u4F1A\u8BDD\u5185\u6267\u884C", _jsx("code", { children: "/login grok-build" }), "\uFF1B\u9000\u51FA\u767B\u5F55\u6267\u884C ", _jsx("code", { children: "/logout grok-build" }), "\u3002 \u51ED\u8BC1\u4FDD\u5B58\u5728\u5F53\u524D\u9879\u76EE Pi \u5BB6\u7684 auth.json\uFF08provider auth\uFF09\uFF0C\u4E0D\u5199\u5165\u8BBE\u7F6E JSON\u3002"] })] }));
}
