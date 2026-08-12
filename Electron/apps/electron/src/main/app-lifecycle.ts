export interface AppQuitEventLike {
  preventDefault(): void;
}

export interface AppQuitLifecycleLike {
  on(event: "before-quit", listener: (event: AppQuitEventLike) => void): unknown;
  quit(): void;
}

export interface TerminalRuntimeOwner {
  closeAll(): void;
}

export interface ComputerRuntimeOwner {
  shutdown(): Promise<void>;
}

export interface PiRuntimeOwner {
  close(): Promise<void>;
}

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
    void Promise.allSettled([computer.shutdown(), pi.close()])
      .then((results) => {
        const [computerResult, piResult] = results;
        if (computerResult.status === "rejected")
          console.error("[pipiui] Computer runtime shutdown failed", computerResult.reason);
        if (piResult.status === "rejected")
          console.error("[pipiui] Pi runtime shutdown failed", piResult.reason);
      })
      .then(() => {
        shutdownComplete = true;
        app.quit();
      });
  });
}
