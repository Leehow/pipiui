import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
/**
 * Static usage / pricing panel for DeepSeek (phase-2 app half).
 * Mirrors grok `app/image-card.tsx` registration + inline style tokens.
 * Data is embedded — no live billing, no agent-half bridge.
 */
const VISION_MODEL = "deepseek-v4-flash-vision-exp";
const TIERS = [
    { id: "cached", label: "缓存输入", price: "$0.007" },
    { id: "miss", label: "未命中输入", price: "$0.22" },
    { id: "output", label: "输出", price: "$0.66" },
];
export default function UsagePanel(props) {
    const title = props.title?.trim() || "用量";
    return (_jsxs("div", { style: { border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, padding: 12 }, "data-testid": "deepseek-usage-panel", children: [_jsxs("div", { style: { fontWeight: 600, marginBottom: 6, display: "flex", gap: 8, alignItems: "baseline" }, children: [_jsxs("span", { children: ["DeepSeek ", title] }), _jsx("span", { style: { fontWeight: 400, opacity: 0.6, fontSize: 12 }, children: VISION_MODEL })] }), _jsx("p", { style: { margin: "0 0 8px", opacity: 0.8, fontSize: 13 }, children: "1M ctx / 384K out \u00B7 \u4EF7\u76EE\u6309\u6BCF 1M tokens\uFF08\u4E0E V4 Flash \u975E\u9AD8\u5CF0\u6863\u4E00\u81F4\uFF09" }), _jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: TIERS.map((tier) => (_jsxs("div", { style: {
                        border: "1px solid var(--border, #eee)",
                        borderRadius: 6,
                        padding: "8px 10px",
                        minWidth: 112,
                    }, children: [_jsx("div", { style: { fontSize: 12, opacity: 0.7 }, children: tier.label }), _jsx("div", { style: { fontWeight: 600, marginTop: 2 }, children: tier.price }), _jsx("div", { style: { fontSize: 11, opacity: 0.45 }, children: "/ 1M tokens" })] }, tier.id))) }), _jsxs("p", { style: { margin: "8px 0 0", fontSize: 12, opacity: 0.7 }, children: ["\u5185\u7F6E\u641C\u7D22\uFF1A\u8BF7\u6C42\u5E26 ", _jsxs("code", { children: ["tools: [", `{ "type": "web_search" }`, "]"] }), "\uFF1B\u53EF\u7528 ", _jsx("code", { children: `tool_choice: { "type": "web_search" }` }), " \u5F3A\u5236\u3002\u4E00\u671F\u4EC5\u5C55\u793A\u9759\u6001\u4EF7\u76EE\uFF0C\u975E\u5B9E\u65F6\u8BA1\u8D39\u3002"] })] }));
}
