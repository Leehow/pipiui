import { watch, type FSWatcher } from "node:fs";

export function createDebouncedCallback(fn: () => void, ms = 200): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return run;
}

export class DocumentFileWatcher {
  private watcher: FSWatcher | undefined;
  private watchedPath: string | undefined;
  private debounce: ReturnType<typeof createDebouncedCallback> | undefined;

  constructor(private readonly onChange: (path: string) => void) {}

  get path(): string | undefined {
    return this.watchedPath;
  }

  setPath(path: string | null): void {
    if (path && path === this.watchedPath && this.watcher) return;
    this.stop();
    if (!path) return;
    this.watchedPath = path;
    this.debounce = createDebouncedCallback(() => {
      if (this.watchedPath) this.onChange(this.watchedPath);
    }, 200);
    try {
      this.watcher = watch(path, () => this.debounce?.());
      this.watcher.on("error", (error) => {
        console.warn("[document-watch]", error);
        this.closeWatcher();
      });
    } catch (error) {
      console.warn("[document-watch]", error);
    }
  }

  stop(): void {
    this.closeWatcher();
    this.debounce?.cancel();
    this.debounce = undefined;
    this.watchedPath = undefined;
  }

  private closeWatcher(): void {
    try {
      this.watcher?.close();
    } catch {
      /* already closed */
    }
    this.watcher = undefined;
  }
}
