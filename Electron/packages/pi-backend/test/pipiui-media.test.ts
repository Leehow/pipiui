import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const EXTENSION = pathToFileURL(join(import.meta.dirname, "../../../resources/runtime/extensions/pipiui-media.ts")).href;
const TOKEN = "test-xai-token-not-secret";
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_1x1 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Af//Z";

type Tool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => Promise<any>;
};

let root = "";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipiui-media-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const home = join(root, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  return { cwd, agentDir, home };
}

async function loadTools(opts: {
  agentDir: string;
  home: string;
  token?: string | false;
  envToken?: string;
  auth?: unknown;
}) {
  vi.resetModules();
  vi.stubEnv("HOME", opts.home);
  vi.stubEnv("PI_CODING_AGENT_DIR", opts.agentDir);
  if (opts.envToken) vi.stubEnv("XAI_API_KEY", opts.envToken);
  else vi.stubEnv("XAI_API_KEY", "");

  if (opts.auth !== undefined) {
    await writeFile(join(opts.agentDir, "auth.json"), JSON.stringify(opts.auth));
  } else if (opts.token) {
    await writeFile(join(opts.agentDir, "auth.json"), JSON.stringify({
      xai: { type: "oauth", access: opts.token, refresh: "refresh-not-used", expires: Date.now() + 60_000 },
    }));
  } else {
    await writeFile(join(opts.agentDir, "auth.json"), JSON.stringify({}));
  }

  const tools = new Map<string, Tool>();
  const extension = (await import(EXTENSION)).default;
  extension({
    registerTool: (definition: Tool) => {
      tools.set(definition.name, definition);
    },
  } as never);
  return tools;
}

function grokCtx(cwd: string) {
  return { cwd, model: { provider: "xai", id: "grok-4.5", name: "Grok" } };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function dump(value: unknown): string {
  return JSON.stringify(value);
}

describe("pipiui-media image_gen / image_edit", () => {
  it("refuses confirmed=false without sending HTTP", async () => {
    const { cwd, agentDir, home } = await fixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tools = await loadTools({ agentDir, home, token: TOKEN });

    for (const name of ["image_gen", "image_edit"] as const) {
      const result = await tools.get(name)!.execute("id", {
        prompt: "a fox",
        confirmed: false,
        image: join(cwd, "missing.png"),
      }, undefined, undefined, grokCtx(cwd));
      expect(result.isError, name).toBe(true);
      expect(result.content[0].text).toContain("confirmed=false");
      expect(result.content[0].text).toContain("code");
      expect(result.content[0].text).toContain("image_edit");
      expect(result.content[0].text).toContain(".pi/attachments/");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tools.has("generate_image")).toBe(false);
  });

  it("posts image_gen to official Imagine with aspect_ratio and a non-local bearer", async () => {
    const { cwd, agentDir, home } = await fixture();
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ b64_json: PNG_1x1, mime_type: "image/png" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tools = await loadTools({ agentDir, home, token: TOKEN });

    const result = await tools.get("image_gen")!.execute("id", {
      prompt: "a red fox",
      confirmed: true,
      aspect_ratio: "16:9",
    }, undefined, undefined, grokCtx(cwd));

    expect(result.isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.x.ai/v1/images/generations");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.authorization).not.toBe("Bearer local");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "grok-imagine-image-2.0",
      prompt: "a red fox",
      n: 1,
      response_format: "b64_json",
      aspect_ratio: "16:9",
    });
    expect(result.details).toEqual({
      path: result.details.path,
      backend: "Grok Imagine",
      model: "grok-imagine-image-2.0",
    });
    expect(dump(result)).not.toContain(TOKEN);
  });

  it("posts image_edit with a data-URI reference and ignores invalid aspect_ratio", async () => {
    const { cwd, agentDir, home } = await fixture();
    const refPath = join(cwd, "ref.png");
    await writeFile(refPath, Buffer.from(PNG_1x1, "base64"));
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ b64_json: JPEG_1x1, mime_type: "image/jpeg" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tools = await loadTools({ agentDir, home, token: TOKEN });

    const result = await tools.get("image_edit")!.execute("id", {
      prompt: "make it night",
      confirmed: true,
      image: refPath,
      aspect_ratio: "not-a-ratio",
    }, undefined, undefined, grokCtx(cwd));

    expect(result.isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.x.ai/v1/images/edits");
    const body = JSON.parse(init.body as string);
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.image.url).toMatch(/^data:image\/png;base64,/);
    expect(body.image.url).toContain(PNG_1x1);
    expect(result.content.find((part: { type: string }) => part.type === "image")?.mimeType).toBe("image/jpeg");
    expect(result.details.path).toMatch(/\.jpg$/);
    const files = await readdir(join(cwd, ".pi", "attachments"));
    expect(files.some((name) => name.endsWith(".jpg"))).toBe(true);
    expect(dump(result)).not.toContain(TOKEN);
  });

  it("uses the grok relay with Bearer local when no token is available", async () => {
    const { cwd, agentDir, home } = await fixture();
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ b64_json: PNG_1x1 }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tools = await loadTools({ agentDir, home });

    const result = await tools.get("image_gen")!.execute("id", {
      prompt: "relay fox",
      confirmed: true,
    }, undefined, undefined, grokCtx(cwd));

    expect(result.isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:18891/v1/images/generations");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer local");
    expect(JSON.parse(init.body as string).model).toBe("grok-imagine-image-quality");
    expect(result.details.backend).toBe("Grok Imagine Relay");
    expect(result.details.model).toBe("grok-imagine-image-quality");
    expect(dump(result)).not.toContain(TOKEN);
  });

  it("falls back to the relay after official 401 and not after official 400", async () => {
    const { cwd, agentDir, home } = await fixture();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("api.x.ai")) {
        return jsonResponse(401, { error: "unauthorized" });
      }
      return jsonResponse(200, { data: [{ b64_json: PNG_1x1, mime_type: "image/png" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tools = await loadTools({ agentDir, home, token: TOKEN });

    const ok = await tools.get("image_gen")!.execute("id", {
      prompt: "retry fox",
      confirmed: true,
    }, undefined, undefined, grokCtx(cwd));
    expect(ok.isError).toBeFalsy();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://api.x.ai/v1/images/generations",
      "http://127.0.0.1:18891/v1/images/generations",
    ]);
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).authorization).toBe("Bearer local");
    expect(dump(ok)).not.toContain(TOKEN);

    fetchMock.mockImplementation(async () => jsonResponse(400, { error: "bad prompt" }));
    const blocked = await tools.get("image_gen")!.execute("id", {
      prompt: "blocked fox",
      confirmed: true,
    }, undefined, undefined, grokCtx(cwd));
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("HTTP 400");
    expect(blocked.content[0].text).not.toContain("Is the relay running?");
    expect(blocked.content[0].text).not.toContain(TOKEN);
    expect(fetchMock.mock.calls.slice(2).map((call) => String(call[0]))).toEqual([
      "https://api.x.ai/v1/images/generations",
    ]);
  });

  it("treats an expired access-only auth.json entry as no ticket and never leaks the token", async () => {
    const { cwd, agentDir, home } = await fixture();
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [{ b64_json: PNG_1x1 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const tools = await loadTools({
      agentDir,
      home,
      auth: { xai: { type: "oauth", access: TOKEN, expires: 1 } },
    });

    const result = await tools.get("image_gen")!.execute("id", {
      prompt: "expired",
      confirmed: true,
    }, undefined, undefined, grokCtx(cwd));
    expect(result.isError).toBeFalsy();
    expect(String(fetchMock.mock.calls[0][0])).toContain("127.0.0.1:18891");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).authorization).toBe("Bearer local");
    expect(dump(result)).not.toContain(TOKEN);
    expect(await readFile(join(agentDir, "auth.json"), "utf8")).toContain(TOKEN);
  });
});
