import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import { IMAGE_DESCRIBE_PROMPT_FINGERPRINT } from "../src/vision-describe.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type RecordedRpc = { command: Record<string, unknown> };

async function fixture(failDescribe = false) {
  root = await mkdtemp(join(tmpdir(), "pipi-vision-describe-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "s1.jsonl"), JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
  const rpcs: RecordedRpc[] = [];
  const create = () => createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, args, options) => {
      if (failDescribe && args.includes("--no-session")) {
        // Isolated side channels (title + describe) die without producing any
        // assistant text; the main session keeps working.
        return spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 50)"], options) as any;
      }
      const child = spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any;
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (data: any, ...rest: any[]) => {
        for (const line of String(data).split("\n")) {
          if (!line.trim()) continue;
          try { rpcs.push({ command: JSON.parse(line) }); } catch { /* ignore */ }
        }
        return write(data, ...rest);
      };
      return child;
    },
  });
  return { agentDir, sessionsRoot, cwd, create, rpcs };
}

/** Main-session prompt commands carry a random UUID id; title/describe side channels use fixed ids. */
function mainPrompts(rpcs: RecordedRpc[]) {
  return rpcs.filter(r => r.command.type === "prompt" && r.command.id !== "title-prompt" && r.command.id !== "describe-prompt");
}
/** The describe side-channel's RPC stream: set_model with the vision ref + the describe prompt. */
function describeRpc(rpcs: RecordedRpc[]) {
  const setModel = rpcs.find(r => r.command.type === "set_model" && r.command.provider === "anthropic" && r.command.modelId === "claude-sonnet-4")?.command;
  const prompt = rpcs.find(r => r.command.id === "describe-prompt")?.command;
  return { setModel, prompt };
}

async function enableVisionRouting(backend: Awaited<ReturnType<typeof createPiHostBackend>>) {
  await backend.handle("setVisionModel", ["anthropic/claude-sonnet-4"]);
  await backend.handle("setVisionEnabled", [true]);
}

describe("vision-model describe routing", () => {
  it("describes attachments through the vision model when the main model is non-multimodal, injects the text, and strips body.images", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await enableVisionRouting(backend);
    await backend.handle("setModel", ["s1", "deepseek", "deepseek-chat"]);
    const send = await backend.handle("sendPrompt", ["s1", "what does this show", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "shot.png" }]]) as any;
    expect(send).toMatchObject({ outcome: "direct" });

    // Attachment files were persisted under <cwd>/.pi/attachments.
    const files = await readdir(join(setup.cwd, ".pi", "attachments"));
    expect(files).toEqual(["shot.png"]);

    // The isolated describe spawn targeted the selected vision model and asked
    // it to describe the attached image (no main-session file involvement).
    const describe = describeRpc(setup.rpcs);
    expect(describe.setModel).toMatchObject({ type: "set_model", provider: "anthropic", modelId: "claude-sonnet-4" });
    expect(describe.prompt).toMatchObject({
      type: "prompt",
      id: "describe-prompt",
      images: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    expect(String(describe.prompt!.message)).toContain(IMAGE_DESCRIBE_PROMPT_FINGERPRINT);
    expect(String(describe.prompt!.message)).toContain("what does this show");

    // The main session prompt received the vision-model description text and NO images.
    const main = mainPrompts(setup.rpcs).at(-1);
    expect(main).toBeDefined();
    expect(main!.command).toMatchObject({ type: "prompt", message: expect.stringContaining("Attached image file") });
    expect(String(main!.command.message)).toContain("hello"); // fake-pi's assistant text = the description
    expect(main!.command).not.toHaveProperty("images");
    await backend.close();
  });

  it("keeps today's multimodal embedding when the main model accepts images", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await enableVisionRouting(backend);
    await backend.handle("setModel", ["s1", "openai", "gpt-4o"]);
    await backend.handle("sendPrompt", ["s1", "look", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "a.png" }]]);

    expect(describeRpc(setup.rpcs).prompt).toBeUndefined();
    const main = mainPrompts(setup.rpcs).at(-1);
    expect(main!.command).toMatchObject({
      type: "prompt",
      images: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    expect(String(main!.command.message)).toContain("Images are also embedded multimodally");
    await backend.close();
  });

  it("keeps today's multimodal embedding when vision routing is disabled or no vision model is selected", async () => {
    const setup = await fixture();
    const backend = setup.create();
    await backend.handle("setModel", ["s1", "deepseek", "deepseek-chat"]);

    // Vision enabled but no model selected → today's behavior.
    await backend.handle("setVisionEnabled", [true]);
    await backend.handle("sendPrompt", ["s1", "look", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "b.png" }]]);
    expect(describeRpc(setup.rpcs).prompt).toBeUndefined();
    expect(mainPrompts(setup.rpcs).at(-1)!.command).toHaveProperty("images");

    // Vision model selected but disabled → today's behavior.
    await backend.handle("setVisionModel", ["anthropic/claude-sonnet-4"]);
    await backend.handle("setVisionEnabled", [false]);
    await backend.handle("sendPrompt", ["s1", "look", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "c.png" }]]);
    expect(describeRpc(setup.rpcs).prompt).toBeUndefined();
    expect(mainPrompts(setup.rpcs).at(-1)!.command).toHaveProperty("images");
    await backend.close();
  });

  it("falls back to today's behavior when the describe side channel returns nothing", async () => {
    const setup = await fixture(true);
    const backend = setup.create();
    await enableVisionRouting(backend);
    await backend.handle("setModel", ["s1", "deepseek", "deepseek-chat"]);
    // The describe spawn dies without assistant text → description undefined →
    // images embedded, message still sent (never fails the user's send).
    await backend.handle("sendPrompt", ["s1", "look", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "d.png" }]]);
    const main = mainPrompts(setup.rpcs).at(-1);
    expect(main).toBeDefined();
    expect(main!.command).toHaveProperty("images");
    expect(String(main!.command.message)).toContain("Attached image file");
    await backend.close();
  });
});
