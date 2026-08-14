import type { ChildProcessWithoutNullStreams } from "node:child_process";

export const IMAGE_DESCRIBE_PROMPT_FINGERPRINT = "Describe each attached image";

export type VisionDescribeImage = { dataBase64: string; mimeType: string };

/** One-shot describe prompt: same-language, ordered paragraphs, text-only output. */
export function imageDescribePrompt(userText?: string): string {
  const body = userText?.trim() ? [...userText.trim()].slice(0, 500).join("") : undefined;
  const lines = [
    `${IMAGE_DESCRIBE_PROMPT_FINGERPRINT}.\nRules: same language as the user's message; one short paragraph per image, in attachment order; output ONLY the description text.`,
  ];
  if (body) lines.push(`User message:\n\"\"\"\n${body}\n\"\"\"`);
  return lines.join("\n");
}

/** Accepts any non-empty assistant text; rejects echoes of the prompt itself. */
export function parseImageDescription(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value.includes(IMAGE_DESCRIBE_PROMPT_FINGERPRINT)) return undefined;
  return value;
}

export type VisionDescribeSpawn = (
  executable: string,
  args: string[],
  options: Record<string, unknown>,
) => ChildProcessWithoutNullStreams;

/**
 * Describe the given images through an isolated no-session/no-tools Pi process
 * running the selected vision model. Never touches the user's session file or
 * any shared profile state; a failed/slow side channel resolves `undefined` and
 * the caller keeps the message flowing.
 */
export async function describeImages(options: {
  spawn: VisionDescribeSpawn;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  model: { provider: string; id: string };
  images: VisionDescribeImage[];
  userText?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  if (!options.images.length || options.signal?.aborted) return undefined;
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
      child.stdin.write(JSON.stringify({
        id: "describe-prompt",
        type: "prompt",
        message: imageDescribePrompt(options.userText),
        images: options.images.map(image => ({
          type: "image",
          data: image.dataBase64,
          mimeType: image.mimeType,
        })),
      }) + "\n");
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
          if (event.type === "response" && event.id === "describe-model") sendPrompt();
          if (event.type === "response" && event.id === "describe-prompt" && event.success === false) finish(undefined);
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
          if (event.type === "agent_settled") finish(parseImageDescription(assistantText));
        } catch {
          // Pi diagnostics belong on stderr; malformed stdout lines are ignored.
        }
      }
    });
    child.on("error", () => finish(undefined));
    child.on("close", () => finish(parseImageDescription(assistantText)));
    if (options.model.provider !== "unknown" && options.model.id !== "unknown") {
      child.stdin.write(JSON.stringify({
        id: "describe-model",
        type: "set_model",
        provider: options.model.provider,
        modelId: options.model.id,
      }) + "\n");
    } else {
      sendPrompt();
    }
  });
}
