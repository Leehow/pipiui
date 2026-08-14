import type { ChildProcessWithoutNullStreams } from "node:child_process";

export const SESSION_TITLE_PROMPT_FINGERPRINT = "Write a short session title for this user message";

const PLACEHOLDER_TITLES = new Set(["", "New session", "Session", "新会话"]);

export function isPlaceholderSessionTitle(value?: string): boolean {
  return PLACEHOLDER_TITLES.has(value?.trim() ?? "");
}

const LEADING_FILLERS = [
  "有个问题，", "有个问题", "我想问一下，", "我想问", "请问一下，", "请问", "问一下，",
  "是这样的，", "对了，", "帮我看下，", "帮我", "能帮我", "那个", "嗯，", "如下：", "如下",
  "can you ", "could you ", "please ", "hey ", "hi ", "hello ", "so ",
  "i want to ", "i need to ", "how do i ", "what about ",
];

function stripLeadingFiller(value: string): string {
  let result = value.trim();
  let changed = true;
  while (changed && result) {
    changed = false;
    const lower = result.toLocaleLowerCase();
    for (const filler of LEADING_FILLERS) {
      const normalized = filler.toLocaleLowerCase();
      if (lower.startsWith(normalized)) {
        result = result.slice(filler.length).trim();
        changed = true;
        break;
      }
      if (normalized.endsWith(" ") && lower === normalized.trimEnd()) {
        result = "";
        changed = true;
        break;
      }
    }
  }
  return result;
}

function isCjk(character: string): boolean {
  const value = character.codePointAt(0) ?? 0;
  return (value >= 0x4e00 && value <= 0x9fff)
    || (value >= 0x3400 && value <= 0x4dbf)
    || (value >= 0xf900 && value <= 0xfaff)
    || (value >= 0x3040 && value <= 0x30ff)
    || (value >= 0xac00 && value <= 0xd7af);
}

function mostlyCjk(value: string): boolean {
  const significant = [...value].filter(character => !/\s/u.test(character));
  return significant.length > 0 && significant.filter(isCjk).length / significant.length >= 0.5;
}

export function provisionalSessionTitle(userMessage: string, maxChars = 16): string | undefined {
  let value = userMessage.trim().split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const attachment = value.toLocaleLowerCase().indexOf("attached image");
  if (attachment >= 0) value = value.slice(0, attachment).trim();
  if (value.includes("PipiUI internal")) return undefined;
  value = stripLeadingFiller(value.replace(/\s+/gu, " "));
  if ([...value].length < 2) return undefined;
  if (mostlyCjk(value)) {
    const characters = [...value];
    let end = Math.min(characters.length, Math.max(1, maxChars));
    for (let index = 1; index < end; index += 1) {
      if (index >= 4 && /[\p{P}，。！？、；：…—·「」『』【】（）()]/u.test(characters[index])) {
        end = index;
        break;
      }
    }
    return characters.slice(0, end).join("").trim() || undefined;
  }
  const words = value.split(" ").filter(Boolean);
  const taken: string[] = [];
  for (const word of words.slice(0, 5)) {
    const candidate = [...taken, word].join(" ");
    if (taken.length && candidate.length > 40) break;
    taken.push(word);
    if (candidate.length >= 40) break;
  }
  return taken.join(" ").slice(0, 24).trim() || undefined;
}

export function parseModelSessionTitle(raw: string, maxChars = 40): string | undefined {
  let value = raw.trim().split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const wrappers: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["「", "」"], ["『", "』"]];
  for (const [start, end] of wrappers) {
    if (value.length >= 2 && value.startsWith(start) && value.endsWith(end)) {
      value = value.slice(start.length, -end.length).trim();
      break;
    }
  }
  value = value.replace(/^(?:标题[：:]|title:)\s*/iu, "").trim();
  if (!value || [...value].length > maxChars || isPlaceholderSessionTitle(value)) return undefined;
  if ([...value].length <= 1 || value.includes("PipiUI internal") || value.includes(SESSION_TITLE_PROMPT_FINGERPRINT)) return undefined;
  if (/^(?:\*\*|#)/u.test(value) || value.includes("/") || value.includes(".jsonl") || value.includes("docs/")) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}/u.test(value)) return undefined;
  return value;
}

export function sessionTitlePrompt(userMessage: string): string {
  const body = [...userMessage.trim()].slice(0, 500).join("");
  return `${SESSION_TITLE_PROMPT_FINGERPRINT}.\nRules: 8–16 characters if Chinese (or a short English phrase); same language as the user; no quotes; no prefix; output ONLY the title line.\n\nUser message:\n\"\"\"\n${body}\n\"\"\"`;
}

export type SessionTitleSpawn = (
  executable: string,
  args: string[],
  options: Record<string, unknown>,
) => ChildProcessWithoutNullStreams;

export async function generateModelSessionTitle(options: {
  spawn: SessionTitleSpawn;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  userMessage: string;
  model?: { provider: string; id: string };
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  if (!options.userMessage.trim() || options.signal?.aborted) return undefined;
  return new Promise(resolve => {
    let done = false;
    let lineBuffer = "";
    let assistantText = "";
    let promptSent = false;
    let child: ChildProcessWithoutNullStreams;
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => finish(undefined);
    const finish = (value?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (child && child.exitCode === null && !child.signalCode) child.kill();
      resolve(value);
    };
    const sendPrompt = () => {
      if (promptSent || done) return;
      promptSent = true;
      child.stdin.write(JSON.stringify({ id: "title-prompt", type: "prompt", message: sessionTitlePrompt(options.userMessage) }) + "\n");
    };
    timer = setTimeout(() => finish(undefined), options.timeoutMs ?? 45_000);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      child = options.spawn(options.executable, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      finish(undefined);
      return;
    }
    child.stdout.on("data", chunk => {
      lineBuffer += chunk.toString();
      let newline = lineBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = lineBuffer.slice(0, newline).replace(/\r$/u, "");
        lineBuffer = lineBuffer.slice(newline + 1);
        newline = lineBuffer.indexOf("\n");
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "response" && event.id === "title-model") sendPrompt();
          if (event.type === "response" && event.id === "title-prompt" && event.success === false) finish(undefined);
          const update = event.assistantMessageEvent;
          if (event.type === "message_update" && update?.type === "text_delta") assistantText += update.delta ?? "";
          const message = event.message;
          if (["message_start", "message_update", "message_end"].includes(event.type) && message?.role === "assistant") {
            const content = typeof message.content === "string"
              ? message.content
              : Array.isArray(message.content)
                ? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text ?? "").join("\n")
                : "";
            if (content) assistantText = content;
          }
          if (event.type === "agent_settled") finish(parseModelSessionTitle(assistantText));
        } catch {
          // Pi diagnostics belong on stderr; malformed stdout lines are ignored.
        }
      }
    });
    child.on("error", () => finish(undefined));
    child.on("close", () => finish(parseModelSessionTitle(assistantText)));
    if (options.model && options.model.provider !== "unknown" && options.model.id !== "unknown") {
      child.stdin.write(JSON.stringify({ id: "title-model", type: "set_model", provider: options.model.provider, modelId: options.model.id }) + "\n");
    } else {
      sendPrompt();
    }
  });
}
