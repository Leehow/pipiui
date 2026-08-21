import type { ToolRenderProps } from "@pipiui/extension-api";

/**
 * Typed image renderer for `image_gen` / `image_edit` (US-18): renders the
 * actual generated image — the typed `{type:"image"}` blocks delivered with the
 * tool result — plus the saved file path and backend/model metadata. Falls back
 * to path/metadata text when no image payload is present (e.g. tier gate).
 */
export default function ImageCard(props: ToolRenderProps) {
  const details = props.details as Record<string, unknown> | undefined;
  const images = props.images ?? [];
  const path = typeof details?.path === "string" ? details.path : undefined;
  const mime = typeof details?.mime === "string" ? details.mime : undefined;
  const model = typeof details?.model === "string" ? details.model : undefined;
  const backend = typeof details?.backend === "string" ? details.backend : undefined;
  const code = typeof details?.code === "string" ? details.code : undefined;
  const deprecated = details?.deprecated === true;
  const text = typeof props.content === "string" && props.content.trim() ? props.content.trim() : undefined;

  return (
    <div
      style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, padding: 12 }}
      data-testid="grok-image-card"
    >
      <div style={{ fontWeight: 600, marginBottom: 6, display: "flex", gap: 8, alignItems: "baseline" }}>
        <span>{deprecated ? "Grok Build image（deprecated 兼容路径）" : "Grok Build image"}</span>
        {model && <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 12 }}>{model}</span>}
        {backend && <span style={{ fontWeight: 400, opacity: 0.4, fontSize: 11 }}>via {backend}</span>}
      </div>

      {images.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {images.map((image, index) => (
            <img
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={path ? `生成图片 ${index + 1}` : `生成图片 ${index + 1}`}
              loading="lazy"
              style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 6, border: "1px solid var(--border, #eee)" }}
            />
          ))}
        </div>
      ) : code === "tier_restricted" ? (
        <p style={{ margin: "0 0 8px", opacity: 0.8, fontSize: 13 }}>{text}</p>
      ) : (
        <p style={{ margin: "0 0 8px", opacity: 0.6, fontSize: 12 }}>
          {text ?? "无图像数据（请求被短路或未产生图像）"}
        </p>
      )}

      {path && (
        <p style={{ margin: "4px 0 0", fontSize: 12, wordBreak: "break-all", opacity: 0.7 }} data-testid="grok-image-path">
          已保存：{path}
          {mime ? `（${mime}）` : null}
        </p>
      )}
    </div>
  );
}
