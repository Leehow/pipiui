import type { ToolRenderProps } from "@pipiui/extension-api";
/**
 * M1 tool renderer placeholder for `image_gen` / `image_edit`.
 * Real renderer will decode `b64_json` and show the落盘 file.
 * This placeholder only proves the `toolRenderers` + `stream.render` + `details` wiring.
 */
export default function ImageCard(props: ToolRenderProps): import("react").JSX.Element;
