import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * M1 tool renderer placeholder for `image_gen` / `image_edit`.
 * Real renderer will decode `b64_json` and show the落盘 file.
 * This placeholder only proves the `toolRenderers` + `stream.render` + `details` wiring.
 */
export default function ImageCard(props) {
    const data = props.details;
    const pretty = data ? JSON.stringify(data, null, 2) : props.content;
    const isSkeleton = Boolean(data && data.skeleton);
    return (_jsxs("div", { style: { border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, padding: 12 }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: 6 }, children: isSkeleton ? "Grok Build — M1 skeleton" : "Grok Build image" }), isSkeleton ? (_jsx("p", { style: { margin: "0 0 8px", opacity: 0.7, fontSize: 12 }, children: "No image request was made. Full generation lands after OAuth phases." })) : null, _jsx("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }, children: pretty })] }));
}
