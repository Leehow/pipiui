// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ImageCard from "../app/image-card.js";

afterEach(cleanup);

const PNG_B64 = "aGk="; // deliberately tiny; never rendered as text

function renderCard(props: Parameters<typeof ImageCard>[0]) {
  return render(<ImageCard {...props} />);
}

describe("ImageCard (typed image renderer)", () => {
  it("renders the typed thumbnail plus path and backend/model from structured details", () => {
    const { container } = renderCard({
      content: "图像已生成: /tmp/attachments/images/1.jpg",
      details: { path: "/tmp/attachments/images/1.jpg", mime: "image/png", backend: "grok-build", model: "grok-imagine-image-quality" },
      images: [{ data: PNG_B64, mimeType: "image/png" }],
    });
    expect(screen.getByTestId("grok-image-card")).toBeTruthy();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(screen.getByTestId("grok-image-path").textContent).toContain("/tmp/attachments/images/1.jpg");
    expect(screen.getByTestId("grok-image-path").textContent).toContain("image/png");
    expect(screen.getByTestId("grok-image-card").textContent).toContain("grok-imagine-image-quality");
    expect(screen.getByTestId("grok-image-card").textContent).toContain("grok-build");
    // base64 payload never appears in the rendered text
    expect(screen.getByTestId("grok-image-card").textContent).not.toContain(PNG_B64);
  });

  it("degrades to the tier upsell text when gated with no image payload", () => {
    renderCard({
      content: "当前订阅 tier 不包含图像生成…",
      details: { code: "tier_restricted", backend: "grok-build" },
    });
    expect(screen.getByTestId("grok-image-card").textContent).toContain("当前订阅 tier 不包含图像生成");
    expect(document.querySelector("img")).toBeNull();
  });

  it("degrades to a no-image note when the result carries neither images nor a gate code", () => {
    renderCard({ content: "" });
    expect(screen.getByTestId("grok-image-card").textContent).toContain("无图像数据");
    expect(document.querySelector("img")).toBeNull();
  });

  it("tolerates malformed details envelopes without throwing", () => {
    const { container } = renderCard({
      content: "图像已生成: /tmp/x.jpg",
      details: "not-a-record",
      images: [{ data: PNG_B64, mimeType: "image/png" }],
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(screen.queryByTestId("grok-image-path")).toBeNull();
  });
});
