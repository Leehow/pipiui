import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readUserMcpServers, removeUserMcpServer, summarizeMcpServers, writeUserMcpServer } from "../src/user-mcp-servers.js";

describe("summarizeMcpServers", () => {
  it("returns empty when mcpServers is missing or empty", () => {
    expect(summarizeMcpServers(undefined)).toEqual([]);
    expect(summarizeMcpServers({})).toEqual([]);
    expect(summarizeMcpServers({ mcpServers: {} })).toEqual([]);
  });

  it("summarizes a stdio server without leaking env", () => {
    const rows = summarizeMcpServers({
      mcpServers: {
        "sample-server": {
          transport: "stdio",
          command: "/opt/tools/sample-server",
          args: ["serve"],
          env: { SAMPLE_TOKEN: "secret" },
        },
      },
    });
    expect(rows).toEqual([{ name: "sample-server", transport: "stdio", summary: "sample-server serve" }]);
    expect(JSON.stringify(rows)).not.toContain("secret");
  });
});

describe("readUserMcpServers", () => {
  it("returns empty when the file is missing", async () => {
    expect(await readUserMcpServers(join(tmpdir(), "pipiui-no-mcp", "mcp.json"))).toEqual([]);
  });

  it("reads a written mcp.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    const path = join(dir, "mcp.json");
    await writeFile(
      path,
      JSON.stringify({ mcpServers: { "sample-mcp": { transport: "stdio", command: "sample-mcp", args: ["serve"] } } }),
    );
    expect(await readUserMcpServers(path)).toEqual([
      { name: "sample-mcp", transport: "stdio", summary: "sample-mcp serve" },
    ]);
  });
});

describe("writeUserMcpServer", () => {
  it("creates mcp.json with the pi default settings and mode 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    const path = join(dir, "nested", "mcp.json");
    const rows = await writeUserMcpServer(path, "context7", { command: "npx", args: ["-y", "@upstash/context7-mcp"] });
    expect(rows).toEqual([{ name: "context7", transport: "stdio", summary: "npx -y @upstash/context7-mcp" }]);
    const doc = JSON.parse(await readFile(path, "utf8")) as { settings: unknown; mcpServers: Record<string, unknown> };
    expect(doc.settings).toEqual({ toolPrefix: "mcp" });
    expect(doc.mcpServers.context7).toEqual({ command: "npx", args: ["-y", "@upstash/context7-mcp"] });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("merges by name and keeps existing servers, settings and secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    const path = join(dir, "mcp.json");
    await writeFile(path, JSON.stringify({
      settings: { toolPrefix: "mcp" },
      mcpServers: { local: { transport: "stdio", command: "local-mcp", env: { TOKEN: "secret" } } },
    }));
    await writeUserMcpServer(path, "remote", { transport: "streamable-http", url: "https://mcp.example.com/mcp" });
    expect(await readUserMcpServers(path)).toEqual([
      { name: "local", transport: "stdio", summary: "local-mcp" },
      { name: "remote", transport: "streamable-http", summary: "mcp.example.com/mcp" },
    ]);
    const doc = JSON.parse(await readFile(path, "utf8")) as { mcpServers: Record<string, { env?: Record<string, string> }> };
    expect(doc.mcpServers.local.env).toEqual({ TOKEN: "secret" });
    // Same-name import replaces only that entry.
    await writeUserMcpServer(path, "local", { command: "local-mcp", args: ["serve"] });
    const replaced = JSON.parse(await readFile(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(replaced.mcpServers)).toEqual(["local", "remote"]);
    expect(replaced.mcpServers.local).toEqual({ command: "local-mcp", args: ["serve"] });
  });

  it("rejects names and specs that cannot be a server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    const path = join(dir, "mcp.json");
    await expect(writeUserMcpServer(path, "  ", { command: "true" })).rejects.toThrow("名称不能为空");
    await expect(writeUserMcpServer(path, "bad", { foo: 1 })).rejects.toThrow("command");
    await expect(writeUserMcpServer(path, "bad", "npx")).rejects.toThrow("JSON 对象");
    await expect(readUserMcpServers(path)).resolves.toEqual([]);
  });
});

describe("removeUserMcpServer", () => {
  it("removes only the named server and keeps the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    const path = join(dir, "mcp.json");
    await writeUserMcpServer(path, "a", { command: "a" });
    await writeUserMcpServer(path, "b", { url: "https://b.example.com" });
    const rows = await removeUserMcpServer(path, "a");
    expect(rows.map((row) => row.name)).toEqual(["b"]);
    expect(await readUserMcpServers(path)).toEqual([{ name: "b", transport: "http", summary: "b.example.com" }]);
  });

  it("is a no-op for unknown names or missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    expect(await removeUserMcpServer(join(dir, "mcp.json"), "ghost")).toEqual([]);
    const path = join(dir, "mcp.json");
    await writeUserMcpServer(path, "a", { command: "a" });
    await removeUserMcpServer(path, "ghost");
    expect((await readUserMcpServers(path)).map((row) => row.name)).toEqual(["a"]);
  });

  it("repairs a corrupted file instead of failing the removal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-mcp-"));
    const path = join(dir, "mcp.json");
    await writeFile(path, "{ not json");
    expect(await removeUserMcpServer(path, "a")).toEqual([]);
    expect(await readUserMcpServers(path)).toEqual([]);
  });
});
