import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readUserMcpServers, summarizeMcpServers } from "../src/user-mcp-servers.js";

describe("summarizeMcpServers", () => {
  it("returns empty when mcpServers is missing or empty", () => {
    expect(summarizeMcpServers(undefined)).toEqual([]);
    expect(summarizeMcpServers({})).toEqual([]);
    expect(summarizeMcpServers({ mcpServers: {} })).toEqual([]);
  });

  it("summarizes stdio officecli without env", () => {
    const rows = summarizeMcpServers({
      mcpServers: {
        officecli: {
          transport: "stdio",
          command: "/Users/haoli/.local/bin/officecli",
          args: ["mcp"],
          env: { OFFICECLI_TOKEN: "secret" },
        },
      },
    });
    expect(rows).toEqual([{ name: "officecli", transport: "stdio", summary: "officecli mcp" }]);
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
      JSON.stringify({ mcpServers: { officecli: { transport: "stdio", command: "officecli", args: ["mcp"] } } }),
    );
    expect(await readUserMcpServers(path)).toEqual([
      { name: "officecli", transport: "stdio", summary: "officecli mcp" },
    ]);
  });
});
