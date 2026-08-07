import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from "react";
import type { Components } from "react-markdown";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, TextArea, Toast } from "antd-mobile";

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

function isToolOrThinking(message: any): boolean {
  return message?.kind === "tool" || message?.kind === "thinking";
}

/** Thinking body from DTO; empty for old hosts / still-streaming placeholder. */
function thinkingBody(message: any): string {
  return typeof message?.text === "string" ? message.text.trim() : "";
}

function stepShortLabel(message: any): string {
  if (message?.kind === "thinking") return "思考";
  const name = typeof message?.toolName === "string" && message.toolName
    ? message.toolName
    : "tool";
  return name;
}

function stepExpandedLabel(message: any): string {
  if (message?.kind === "thinking") {
    // Body present → stable chip; empty (old app / streaming) → 思考中.
    return thinkingBody(message) ? "💭 思考" : "💭 思考中";
  }
  const name = typeof message?.toolName === "string" && message.toolName
    ? message.toolName
    : "tool";
  const summary = typeof message?.toolSummary === "string" && message.toolSummary
    ? message.toolSummary
    : "";
  return summary ? `⚙︎ ${name} · ${summary}` : `⚙︎ ${name}`;
}

function ThinkingStepBody({ message }: { message: any }) {
  const body = thinkingBody(message);
  return (
    <div className="thinking-step">
      <div className="thinking-step-label">{stepExpandedLabel(message)}</div>
      {body ? <div className="thinking-body">{body}</div> : null}
    </div>
  );
}

/** Collapsed chip text: lone row keeps detail; groups use `N 步 · first · …`. */
export function toolGroupSummary(items: any[]): string {
  if (items.length === 0) return "⚙︎ 0 步";
  if (items.length === 1) return stepExpandedLabel(items[0]);
  const first = stepShortLabel(items[0]);
  return `⚙︎ ${items.length} 步 · ${first} · …`;
}

export type TranscriptRow =
  | { type: "message"; message: any; index: number }
  | {
    type: "toolGroup";
    messages: any[];
    startIndex: number;
    endIndex: number;
    live: boolean;
  };

/** Group consecutive tool/thinking messages into collapsible rows. */
export function buildTranscriptRows(
  messages: any[],
  liveTail: boolean,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i];
    if (!isToolOrThinking(message)) {
      rows.push({ type: "message", message, index: i });
      i += 1;
      continue;
    }
    const start = i;
    const group: any[] = [];
    while (i < messages.length && isToolOrThinking(messages[i])) {
      group.push(messages[i]);
      i += 1;
    }
    const endIndex = i - 1;
    const live = Boolean(liveTail && endIndex === messages.length - 1);
    rows.push({
      type: "toolGroup",
      messages: group,
      startIndex: start,
      endIndex,
      live,
    });
  }
  return rows;
}

function formatTimestamp(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return time;
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (d.getFullYear() === now.getFullYear()) return `${mon}-${day} ${time}`;
  return `${d.getFullYear()}-${mon}-${day} ${time}`;
}

/** ~3 visual lines or a long body → offer 展开/收起. */
export function shouldClampUserText(text: string): boolean {
  if (!text) return false;
  if (text.length > 140) return true;
  const lines = text.split("\n");
  return lines.length > 3;
}

async function copyText(text: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
    Toast.show({ content: "已复制", duration: 1500 });
  } catch {
    // Hide failures gracefully — no toast on denied/unavailable clipboard.
  }
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={expanded ? "tool-group-chevron open" : "tool-group-chevron"}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ToolThinkingGroup({
  items,
  live,
}: {
  items: any[];
  live: boolean;
}) {
  const [expanded, setExpanded] = useState(live);
  useEffect(() => {
    if (live) setExpanded(true);
  }, [live]);

  if (items.length === 0) return null;
  const summary = toolGroupSummary(items);

  return (
    <div className={`tool-group${live ? " live" : ""}${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="tool-group-chip"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="tool-group-summary">{summary}</span>
        <ChevronIcon expanded={expanded} />
      </button>
      {expanded ? (
        <div className="tool-group-steps">
          {items.map((item, index) => (
            <div
              key={index}
              className={`tool-entry nested${live && index === items.length - 1 ? " live" : ""}${item?.kind === "thinking" ? " thinking" : ""}`}
            >
              {item?.kind === "thinking"
                ? <ThinkingStepBody message={item} />
                : stepExpandedLabel(item)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type MessageActionsProps = {
  /** Disable edit/resend while generating/stopping/disconnected. */
  actionsDisabled?: boolean;
  onResend?: (entryId: string) => void | Promise<void>;
  onEdit?: (entryId: string, text: string) => void | Promise<void>;
};

function MessageMeta({
  role,
  timestamp,
}: {
  role: string;
  timestamp?: unknown;
}) {
  const timeLabel = formatTimestamp(timestamp);
  return (
    <div className="message-meta">
      <span className="role">{roleLabel(role)}</span>
      {timeLabel ? <span className="message-time">{timeLabel}</span> : null}
    </div>
  );
}

function MessageActionBar({ children }: { children: ReactNode }) {
  return <div className="message-actions">{children}</div>;
}

export function MessageView({
  message,
  live,
  actionsDisabled = false,
  onResend,
  onEdit,
}: {
  message: any;
  live: boolean;
} & MessageActionsProps) {
  // Standalone tool/thinking (used if rendered outside TranscriptMessages).
  if (isToolOrThinking(message)) {
    return <ToolThinkingGroup items={[message]} live={live} />;
  }

  const role = typeof message.role === "string" ? message.role : "system";
  const text = typeof message.text === "string" ? message.text : "";
  const entryId = typeof message.entryId === "string" && message.entryId
    ? message.entryId
    : undefined;
  // entryId absent (old host) → hide; generating/disconnected → show disabled.
  const showMutate = role === "user" && Boolean(entryId);
  const canMutate = showMutate && !actionsDisabled;
  const showCopy = (role === "user" || role === "assistant") && text.length > 0;

  const [userExpanded, setUserExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [saving, setSaving] = useState(false);

  // Keep edit draft in sync when snapshot replaces the message while not editing.
  useEffect(() => {
    if (!editing) setEditText(text);
  }, [text, editing]);

  const needsClamp = role === "user" && shouldClampUserText(text);
  const showClampToggle = needsClamp && !editing;

  const beginEdit = () => {
    if (!canMutate) return;
    setEditText(text);
    setEditing(true);
    setUserExpanded(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditText(text);
  };

  const saveEdit = async () => {
    if (!canMutate || !entryId || !onEdit) return;
    const next = editText.trim();
    if (!next) {
      Toast.show({ content: "内容不能为空", duration: 1500 });
      return;
    }
    setSaving(true);
    try {
      await onEdit(entryId, next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleResend = () => {
    if (!canMutate || !entryId || !onResend) return;
    void onResend(entryId);
  };

  return (
    <div className={`message ${role}${editing ? " editing" : ""}`}>
      <MessageMeta role={role} timestamp={message.timestamp} />

      {editing ? (
        <div className="message-edit">
          <TextArea
            value={editText}
            onChange={setEditText}
            autoSize={{ minRows: 2, maxRows: 10 }}
            rows={3}
          />
          <div className="message-edit-actions">
            <Button size="mini" fill="outline" onClick={cancelEdit} disabled={saving}>
              取消
            </Button>
            <Button
              size="mini"
              color="primary"
              onClick={() => void saveEdit()}
              disabled={saving || !editText.trim()}
              loading={saving}
            >
              保存
            </Button>
          </div>
        </div>
      ) : role === "assistant" ? (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      ) : (
        <div
          className={
            showClampToggle && !userExpanded
              ? "message-text clamped"
              : "message-text"
          }
        >
          {text}
        </div>
      )}

      {showClampToggle ? (
        <button
          type="button"
          className="message-clamp-toggle"
          onClick={() => setUserExpanded((v) => !v)}
        >
          {userExpanded ? "收起" : "展开"}
        </button>
      ) : null}

      {!editing && (showCopy || showMutate) ? (
        <MessageActionBar>
          {showCopy ? (
            <button
              type="button"
              className="message-action-btn"
              aria-label="复制"
              title="复制"
              onClick={() => void copyText(text)}
            >
              <CopyIcon />
            </button>
          ) : null}
          {showMutate ? (
            <>
              <button
                type="button"
                className="message-action-btn text"
                disabled={!canMutate}
                onClick={beginEdit}
              >
                编辑
              </button>
              <button
                type="button"
                className="message-action-btn text"
                disabled={!canMutate}
                onClick={handleResend}
              >
                重发
              </button>
            </>
          ) : null}
        </MessageActionBar>
      ) : null}
    </div>
  );
}

export function TranscriptMessages({
  messages,
  liveTail,
  actionsDisabled = false,
  onResend,
  onEdit,
}: {
  messages: any[];
  liveTail: boolean;
  actionsDisabled?: boolean;
  onResend?: (entryId: string) => void | Promise<void>;
  onEdit?: (entryId: string, text: string) => void | Promise<void>;
}) {
  const rows = useMemo(
    () => buildTranscriptRows(messages, liveTail),
    [messages, liveTail],
  );

  return (
    <>
      {rows.map((row) => {
        if (row.type === "toolGroup") {
          return (
            <ToolThinkingGroup
              key={`tg-${row.startIndex}-${row.endIndex}`}
              items={row.messages}
              live={row.live}
            />
          );
        }
        return (
          <MessageView
            key={`m-${row.index}`}
            message={row.message}
            live={false}
            actionsDisabled={actionsDisabled}
            onResend={onResend}
            onEdit={onEdit}
          />
        );
      })}
    </>
  );
}
