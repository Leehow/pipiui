export interface AppQuitEventLike {
  preventDefault(): void;
}

export interface AppQuitLifecycleLike {
  on(event: "before-quit", listener: (event: AppQuitEventLike) => void): unknown;
  quit(): void;
  exit(code?: number): void;
}

export interface TerminalRuntimeOwner {
  closeAll(): void;
}

export interface ComputerRuntimeOwner {
  shutdown(): Promise<void>;
  /** Synchronous reaper for the watchdog path, which force-exits before any await could run. */
  killNow?(): void;
}

export interface PiRuntimeOwner {
  close(): Promise<void>;
}

/** Force-exit if owned runtimes never settle (e.g. hung `server.close`). */
export const OWNED_RUNTIME_SHUTDOWN_WATCHDOG_MS = 4_000;

/** Hold Electron's first quit attempt until every owned helper is actually reaped. */
export function installOwnedRuntimeShutdown(
  app: AppQuitLifecycleLike,
  terminal: TerminalRuntimeOwner,
  computer: ComputerRuntimeOwner,
  pi: PiRuntimeOwner,
): void {
  let shuttingDown = false;
  let shutdownComplete = false;
  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    terminal.closeAll();
    const watchdog = setTimeout(() => {
      if (shutdownComplete) return;
      shutdownComplete = true;
      // Exiting mid-teardown is how a driver generation gets orphaned, and an orphan
      // blocks Computer Use for every PipiUI sharing this launch path. Reap before exit.
      try {
        computer.killNow?.();
      } catch (error) {
        console.error("[pipiui] Computer runtime force-reap failed", error);
      }
      app.exit(0);
    }, OWNED_RUNTIME_SHUTDOWN_WATCHDOG_MS);
    void Promise.allSettled([computer.shutdown(), pi.close()])
      .then((results) => {
        const [computerResult, piResult] = results;
        if (computerResult.status === "rejected")
          console.error("[pipiui] Computer runtime shutdown failed", computerResult.reason);
        if (piResult.status === "rejected")
          console.error("[pipiui] Pi runtime shutdown failed", piResult.reason);
      })
      .then(() => {
        if (shutdownComplete) return;
        clearTimeout(watchdog);
        shutdownComplete = true;
        app.quit();
      });
  });
}
