import { describe, expect, it, vi } from "vitest";
import {
  encodePipiuiUpdateEvaluationIntent,
  PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX,
  type PipiuiUpdateEvaluationIntentFields,
} from "@pipi/host-api";

const EXTENSION = "../../../resources/runtime/extensions/pipiui-update-center.ts";
type InputHandler = (event: { type: "input"; text: string; images?: unknown[]; source: "interactive" | "rpc" | "extension" }) => unknown;

async function loadInputHandler(): Promise<{ handler: InputHandler; on: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  let handler: InputHandler | undefined;
  const on = vi.fn((event: string, candidate: InputHandler) => {
    if (event === "input") handler = candidate;
  });
  const extension = (await import(EXTENSION)).default;
  extension({ on } as never);
  if (!handler) throw new Error("update center input handler was not registered");
  return { handler, on };
}

function intent(overrides: Partial<PipiuiUpdateEvaluationIntentFields> = {}): string {
  return encodePipiuiUpdateEvaluationIntent({
    id: "pi",
    name: "Pi",
    packageName: "@earendil-works/pi-coding-agent",
    currentVersion: "0.84.0",
    latestVersion: "0.84.2",
    ...overrides,
  });
}

const CLOSED = "更新功能已关闭，已拒绝处理。不要执行更新、修改文件、安装依赖或任何发布操作。";

describe("pipiui update center extension seam", () => {
  it("rejects every update-evaluation intent as permanently closed", async () => {
    const { handler, on } = await loadInputHandler();
    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("input", expect.any(Function));
    const cases: PipiuiUpdateEvaluationIntentFields[] = [
      { id: "pi", name: "Pi", packageName: "@earendil-works/pi-coding-agent", currentVersion: "0.84.0", latestVersion: "0.84.2" },
      { id: "cua-driver", name: "Cua Driver", currentVersion: "0.19.3", latestVersion: "0.20.0" },
      { id: "pdf-extension:firecrawl-pdf-inspector", name: "Firecrawl pdf-inspector", packageName: "@firecrawl/pdf-inspector", ownerExtensionId: "pdf-extension", ownerExtensionName: "PipiUI PDF", currentVersion: "1.15.0", latestVersion: "1.17.0" },
    ];
    for (const fields of cases) {
      const images = [{ type: "image", data: "image-data", mimeType: "image/png" }];
      const result = await handler({ type: "input", text: encodePipiuiUpdateEvaluationIntent(fields), images, source: "rpc" }) as { action: string; text: string; images: unknown };
      expect(result).toMatchObject({ action: "transform", text: CLOSED, images });
      expect(result.text).not.toContain("第一阶段");
      expect(result.text).not.toContain("release notes");
    }
  });

  it("leaves ordinary rpc and interactive input unchanged", async () => {
    const { handler } = await loadInputHandler();
    for (const source of ["rpc", "interactive"] as const) {
      expect(await handler({ type: "input", text: "请解释当前版本", source })).toEqual({ action: "continue" });
    }
  });

  it("rejects malformed update envelopes without expanding them", async () => {
    const { handler } = await loadInputHandler();
    const invalid = [
      `${PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX}{`,
      intent({ currentVersion: "latest" }),
      `${PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX}${JSON.stringify({ version: 1, id: "pi", name: "Pi", currentVersion: "0.84.0", latestVersion: "0.84.2", executeNow: true })}`,
    ];
    for (const text of invalid) {
      const result = await handler({ type: "input", text, source: "rpc" }) as { action: string; text: string };
      expect(result).toEqual({ action: "transform", text: CLOSED, images: undefined });
      expect(result.text).not.toContain("executeNow");
      expect(result.text).not.toContain("忽略门槛");
    }
  });
});
