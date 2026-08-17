import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const installed = join(homedir(), "Library/Application Support/@pipiui/electron/runtime/extensions/pipiui-coding-tools.ts");
const codingToolsExtension = (await import(installed)).default as (pi: unknown) => void;

describe("installed Application Support read wrapper", () => {
  it("strips paging footnotes on a bounded App.tsx read and refuses a bare oversize file", async () => {
    let tool: { name: string; description: string; execute: Function } | undefined;
    const activeTools = ["read", "bash", "edit", "write"];
    codingToolsExtension({
      getActiveTools: () => [...activeTools],
      setActiveTools: (names: string[]) => {
        activeTools.splice(0, activeTools.length, ...names);
      },
      on: () => {},
      registerTool: (definition: { name: string; description: string; execute: Function }) => {
        tool = definition;
      },
    });
    expect(tool?.name).toBe("read");
    expect(tool!.description).not.toMatch(/continue with offset until complete/i);
    expect(tool!.description).toMatch(/grep/i);

    const cwd = "/Users/haoli/leehow/code/pipiui";
    const bounded = await tool!.execute(
      "live-1",
      { path: "Electron/packages/ui/src/App.tsx", offset: 240, limit: 80 },
      undefined,
      undefined,
      { cwd },
    );
    const boundedText = String(bounded.content[0].text);
    expect(boundedText).not.toMatch(/Use offset=\d+ to continue/);
    expect(boundedText).not.toMatch(/more lines in file/);
    expect(boundedText.length).toBeGreaterThan(200);

    const tmp = await mkdtemp(join(tmpdir(), "pipi-live-big-"));
    await writeFile(join(tmp, "big.ts"), Array.from({ length: 2500 }, (_, i) => `line ${i + 1} ${"x".repeat(48)}`).join("\n") + "\n");
    const bare = await tool!.execute("live-2", { path: "big.ts" }, undefined, undefined, { cwd: tmp });
    const bareText = String(bare.content[0].text);
    expect(bareText).not.toMatch(/Use offset=\d+ to continue/);
    expect(bareText).toMatch(/grep/i);
    expect(bareText).toMatch(/read cap/i);
  });
});
