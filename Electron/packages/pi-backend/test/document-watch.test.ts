import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedCallback } from "../src/document-watch.js";

describe("document watch debounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces bursts into one callback after 200ms", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = createDebouncedCallback(fn, 200);
    run();
    run();
    run();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    run.cancel();
  });
});
