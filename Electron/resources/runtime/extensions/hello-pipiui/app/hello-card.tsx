import type { ToolRendererProps } from "@pipiui/extension-api";

/**
 * Tool card for exact tool name match. Receives `{ content, details? }`.
 * If a `piui:v1` envelope in `content` cannot be parsed, the host falls back to the default card.
 */
export default function HelloCard(props: ToolRendererProps) {
  const text = typeof props.details === "object" && props.details !== null
    ? JSON.stringify(props.details)
    : props.content;
  return <pre>{text}</pre>;
}
