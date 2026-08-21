import type { ToolRenderProps } from "@pipiui/extension-api";
/**
 * Typed image renderer for `image_gen` / `image_edit` (US-18): renders the
 * actual generated image — the typed `{type:"image"}` blocks delivered with the
 * tool result — plus the saved file path and backend/model metadata. Falls back
 * to path/metadata text when no image payload is present (e.g. tier gate).
 */
export default function ImageCard(props: ToolRenderProps): import("react").JSX.Element;
