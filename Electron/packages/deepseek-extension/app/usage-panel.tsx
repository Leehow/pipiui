import type { PanelProps } from "@pipiui/extension-api";

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
] as const;

export default function UsagePanel(props: PanelProps) {
  const title = props.title?.trim() || "用量";

  return (
    <div
      style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, padding: 12 }}
      data-testid="deepseek-usage-panel"
    >
      <div style={{ fontWeight: 600, marginBottom: 6, display: "flex", gap: 8, alignItems: "baseline" }}>
        <span>DeepSeek {title}</span>
        <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 12 }}>{VISION_MODEL}</span>
      </div>

      <p style={{ margin: "0 0 8px", opacity: 0.8, fontSize: 13 }}>
        1M ctx / 384K out · 价目按每 1M tokens（与 V4 Flash 非高峰档一致）
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TIERS.map((tier) => (
          <div
            key={tier.id}
            style={{
              border: "1px solid var(--border, #eee)",
              borderRadius: 6,
              padding: "8px 10px",
              minWidth: 112,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>{tier.label}</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{tier.price}</div>
            <div style={{ fontSize: 11, opacity: 0.45 }}>/ 1M tokens</div>
          </div>
        ))}
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.7 }}>
        内置搜索：请求带 <code>tools: [{`{ "type": "web_search" }`}]</code>
        ；可用 <code>{`tool_choice: { "type": "web_search" }`}</code> 强制。一期仅展示静态价目，非实时计费。
      </p>
    </div>
  );
}
