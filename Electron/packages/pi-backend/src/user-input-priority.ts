import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Synchronous projection: extension sends must observe the queue change immediately. */
export class UserInputPriority {
  private readonly bindings = new Map<string, { lifecycle: unknown; path: string; owner: string }>();

  constructor(private readonly directory = tmpdir()) {}

  /** The key must come from the final Pi spawn environment, never a guessed session id. */
  bind(id: string, lifecycle: unknown, sessionKey: string | undefined): void {
    const previous = this.bindings.get(id);
    if (previous && previous.lifecycle === lifecycle && previous.path === join(this.directory, `pipiui-cutin-${sessionKey}.json`)) return;
    if (previous) this.dispose(id, previous.lifecycle);
    if (!sessionKey || /[/\\\0]/.test(sessionKey)) return;
    this.bindings.set(id, { lifecycle, path: join(this.directory, `pipiui-cutin-${sessionKey}.json`), owner: randomUUID() });
  }

  update(id: string, lifecycle: unknown, items: readonly { state: string }[]): void {
    const binding = this.bindings.get(id);
    if (!binding || binding.lifecycle !== lifecycle) return;
    if (!items.some(item => item.state === "queued" || item.state === "sending")) {
      this.clear(binding);
      return;
    }
    const temporary = `${binding.path}.${binding.owner}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ at: Date.now(), pendingUserInput: true, ownerPid: process.pid, owner: binding.owner }), { mode: 0o600 });
      renameSync(temporary, binding.path);
    } catch (error) {
      console.warn("[pipi-backend] user-input priority write failed", error);
    } finally {
      try { unlinkSync(temporary); } catch {}
    }
  }

  dispose(id: string, lifecycle: unknown): void {
    const binding = this.bindings.get(id);
    if (!binding || binding.lifecycle !== lifecycle) return;
    this.clear(binding);
    this.bindings.delete(id);
  }

  private clear(binding: { path: string; owner: string }): void {
    try {
      const marker = JSON.parse(readFileSync(binding.path, "utf8"));
      // A different host or a newer lifecycle may have replaced this file.
      if (marker.ownerPid === process.pid && marker.owner === binding.owner) unlinkSync(binding.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("[pipi-backend] user-input priority cleanup failed", error);
    }
  }
}
