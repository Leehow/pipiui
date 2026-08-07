import type { CSSProperties, ComponentPropsWithoutRef } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function roleLabel(role: string): string {
  return role === "user" ? "你" : role === "assistant" ? "助手" : "系统";
}

type CellTag = "th" | "td";

/**
 * GFM table alignment arrives as React `style={{ textAlign }}` via
 * hast-util-to-jsx-runtime (align attr → style). CSP style-src has no
 * 'unsafe-inline', so strip style and map to a class instead.
 */
function alignedCell(tag: CellTag): NonNullable<Components[CellTag]> {
  return function MarkdownTableCell({
    children,
    className,
    style,
    ...props
  }: ComponentPropsWithoutRef<CellTag> & { style?: CSSProperties }) {
    void style;
    const align = style && typeof style === "object" ? style.textAlign : undefined;
    const alignValue = typeof align === "string" ? align : undefined;
    const alignClass =
      alignValue === "left" || alignValue === "center" || alignValue === "right"
        ? `md-align-${alignValue}`
        : undefined;
    const merged = [className, alignClass].filter(Boolean).join(" ") || undefined;
    const Tag = tag;
    return (
      <Tag className={merged} {...props}>
        {children}
      </Tag>
    );
  };
}

/** GFM + CSP-safe defaults. react-markdown does not render raw HTML. */
const markdownComponents: Components = {
  a({ href, children }) {
    return (
      <a href={href} rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  th: alignedCell("th"),
  td: alignedCell("td"),
};

export function MessageView({ message, live }: { message: any; live: boolean }) {
  if (message.kind === "tool" || message.kind === "thinking") {
    return (
      <div className={`tool-entry${live ? " live" : ""}`}>
        {message.kind === "thinking"
          ? "💭 思考中"
          : `⚙︎ ${message.toolName || "tool"}${message.toolSummary ? ` · ${message.toolSummary}` : ""}`}
      </div>
    );
  }
  const role = message.role || "system";
  const text = typeof message.text === "string" ? message.text : "";
  return (
    <div className={`message ${role}`}>
      <span className="role">{roleLabel(role)}</span>
      {role === "assistant" ? (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      ) : (
        <span>{text}</span>
      )}
    </div>
  );
}
