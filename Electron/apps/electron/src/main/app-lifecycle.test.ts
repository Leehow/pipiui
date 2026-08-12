import { describe, expect, it, vi } from "vitest";
import { installOwnedRuntimeShutdown } from "./app-lifecycle.js";

describe("installOwnedRuntimeShutdown", () => {
  it("holds before-quit until Terminal and Computer runtimes have shut down exactly once", async () => {
    let beforeQuit: ((event: { preventDefault(): void }) => void) | undefined;
    const app = {
      on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => {
        if (event === "before-quit") beforeQuit = listener;
      }),
      quit: vi.fn(),
    };
    let finishComputerShutdown!: () => void;
    const shutdown = vi.fn(() => new Promise<void>((resolve) => {
      finishComputerShutdown = resolve;
    }));
    const closeAll = vi.fn();
    let finishPiClose!: () => void;
    const closePi = vi.fn(() => new Promise<void>((resolve) => {
      finishPiClose = resolve;
    }));
    installOwnedRuntimeShutdown(app, { closeAll }, { shutdown }, { close: closePi });
    const first = { preventDefault: vi.fn() };
    const repeated = { preventDefault: vi.fn() };

    beforeQuit?.(first);
    beforeQuit?.(repeated);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
    expect(closeAll).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(closePi).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();

    finishComputerShutdown();
    await Promise.resolve();
    expect(app.quit).not.toHaveBeenCalled();

    finishPiClose();
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());

    const resumed = { preventDefault: vi.fn() };
    beforeQuit?.(resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(closePi).toHaveBeenCalledOnce();
  });
});
