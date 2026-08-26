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
