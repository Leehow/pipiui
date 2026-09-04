import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectMcpCatalog } from "../src/mcp-catalog.js";
import { createPiHostBackend } from "../src/index.js";

describe("collectMcpCatalog", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("lists the builtin host, bundled MCP clients, and project connections with descriptions", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-mcp-catalog-"));
    await mkdir(join(root, "extensions"), { recursive: true });
    await writeFile(join(root, "extensions", "pipiui-glm-search-mcp.ts"), "export default async function () {}\n");
    const catalog = collectMcpCatalog({
      runtimeRoot: root,
      projectServers: [{ name: "context7", transport: "stdio", summary: "npx -y @upstash/context7-mcp" }],
    });
    expect(catalog.map((item) => item.name)).toEqual(["pi-mcp-extension", "zhipu_search", "glm-vision", "context7"]);
    expect(catalog.find((item) => item.name === "pi-mcp-extension")).toMatchObject({
      origin: "builtin",
      sourceId: "pi-mcp-extension",
      available: true,
    });
    expect(catalog.find((item) => item.name === "zhipu_search")).toMatchObject({
      origin: "extension",
      sourceId: "glm-search-mcp",
      available: true,
    });
    expect(catalog.find((item) => item.name === "zhipu_search")?.tools[0]?.name).toBe("mcp_zhipu_search_*");
    expect(catalog.find((item) => item.name === "glm-vision")?.tools[0]?.name).toBe("image_analysis");
    expect(catalog.find((item) => item.name === "context7")).toMatchObject({
      origin: "project",
      transport: "stdio",
      description: "当前项目 MCP 连接（stdio）：npx -y @upstash/context7-mcp",
    });
    expect(JSON.stringify(catalog)).not.toContain(root);
  });
});

describe("listMcpCatalog host method", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("returns the builtin host without project servers when projectId is omitted", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-mcp-catalog-host-"));
    const host = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const catalog = await host.handle("listMcpCatalog" as never, []) as Array<{ name: string; origin: string }>;
    expect(catalog.some((item) => item.name === "pi-mcp-extension" && item.origin === "builtin")).toBe(true);
    expect(catalog.some((item) => item.origin === "project")).toBe(false);
    await host.close?.();
  });
});
