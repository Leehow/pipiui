import type { ToolRenderProps } from "@pipiui/extension-api";

/**
 * M1 tool renderer placeholder for `image_gen` / `image_edit`.
 * Real renderer will decode `b64_json` and show the落盘 file.
 * This placeholder only proves the `toolRenderers` + `stream.render` + `details` wiring.
 */
export default function ImageCard(props: ToolRenderProps) {
  const data = props.details as Record<string, unknown> | undefined;
  const pretty = data ? JSON.stringify(data, null, 2) : props.content;
  const isSkeleton = Boolean(data && (data as { skeleton?: boolean }).skeleton);
  return (
    <div style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {isSkeleton ? "Grok Build — M1 skeleton" : "Grok Build image"}
      </div>
      {isSkeleton ? (
        <p style={{ margin: "0 0 8px", opacity: 0.7, fontSize: 12 }}>
          No image request was made. Full generation lands after OAuth phases.
        </p>
      ) : null}
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>{pretty}</pre>
    </div>
  );
}
