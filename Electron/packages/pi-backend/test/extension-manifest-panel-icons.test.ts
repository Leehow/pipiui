import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "../src/extension-manifest.js";

function withPanels(panels: unknown) {
  return validateExtensionManifest({
    id: "probe",
    name: "Probe",
    version: "1.0.0",
    capabilities: [],
    app: { ui: { panels } },
  });
}

const panel = (extra: Record<string, unknown> = {}) => ({ slot: "toolPanel", id: "p", title: "P", ...extra });

describe("app.ui.panels[].icon", () => {
  it("carries a package-relative icon through to the summary", () => {
    const result = withPanels([panel({ entry: "app/panel.js", icon: "app/icon.svg" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.ui?.panels?.[0]).toMatchObject({ id: "p", entry: "app/panel.js", icon: "app/icon.svg" });
  });

  it("stays optional — a panel without one is still valid", () => {
    const result = withPanels([panel({ entry: "app/panel.js" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.ui?.panels?.[0].icon).toBeUndefined();
  });

  it("refuses an icon path that escapes the package", () => {
    const result = withPanels([panel({ icon: "../../etc/passwd" })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/app\.ui\.panels\[0\]\.icon/);
  });

  it("refuses a non-string icon", () => {
    const result = withPanels([panel({ icon: 42 })]);
    expect(result.ok).toBe(false);
  });
});
