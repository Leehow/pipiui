import { describe, expect, it, vi } from "vitest";

import { createWorkbenchStore } from "./workbench-store";

describe("Workbench plan seam", () => {
  it("atomically replaces Coding contributions with a non-Coding product plan", () => {
    const store = createWorkbenchStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const disposeCoding = store.apply({
      profileId: "coding",
      containers: [
        { id: "coding.sessions", location: "primarySidebar", title: "项目与会话" },
        { id: "coding.subagents", location: "auxiliarySidebar", title: "Subagents" },
      ],
      views: [
        { id: "coding.sessions.tree", container: "coding.sessions" },
        { id: "coding.subagents.tree", container: "coding.subagents" },
      ],
      layout: { primarySidebar: "coding.sessions", auxiliarySidebar: "coding.subagents" },
    });
    expect(store.snapshot()).toMatchObject({
      profileId: "coding",
      containers: [
        { id: "coding.sessions", location: "primarySidebar" },
        { id: "coding.subagents", location: "auxiliarySidebar" },
      ],
    });

    const disposeCampaign = store.apply({
      profileId: "campaign-fixture",
      containers: [{ id: "campaign.navigator", location: "primarySidebar", title: "战役" }],
      views: [{ id: "campaign.scenes", container: "campaign.navigator" }],
      layout: { primarySidebar: "campaign.navigator" },
    });
    expect(store.snapshot()).toEqual({
      profileId: "campaign-fixture",
      containers: [{ id: "campaign.navigator", location: "primarySidebar", title: "战役" }],
      views: [{ id: "campaign.scenes", container: "campaign.navigator" }],
      layout: { primarySidebar: "campaign.navigator" },
    });
    expect(store.snapshot().containers.some(item => item.id.startsWith("coding."))).toBe(false);

    disposeCoding();
    expect(store.snapshot().profileId).toBe("campaign-fixture");
    disposeCampaign();
    expect(store.snapshot()).toEqual({ profileId: "empty", containers: [], views: [], layout: {} });
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
