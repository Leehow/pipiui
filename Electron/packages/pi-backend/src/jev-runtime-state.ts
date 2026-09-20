import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { projectPiAgentDir } from "./project-pi-home.js";

export const JEV_EXTENSION_ID = "jev-optimizer";
export const JEV_SECRET_KEY = "ext.jev-optimizer.apiKey";
export const JEV_SECRET_ENV = "EXT_JEV_OPTIMIZER_APIKEY";
export const JEV_STATE_FILE_ENV = "PIPIUI_JEV_STATE_FILE";
export const JEV_GENERATION_ENV = "PIPIUI_JEV_GENERATION";

export type JevRuntimeState = {
  schemaVersion: 1;
  enabled: boolean;
  hasKey: boolean;
  generation: string;
};
export type JevRuntimeSnapshot = { file: string; generation: string };

export function jevRuntimeStateFile(projectRoot: string): string {
  return join(projectPiAgentDir(projectRoot), JEV_EXTENSION_ID, "runtime-state.json");
}

/** Host authority only: the file contains neither a credential nor its fingerprint. */
export class JevRuntimeStateStore {
  private readonly states = new Map<string, JevRuntimeState>();
  private lane: Promise<unknown> = Promise.resolve();

  /** Serialize credential/enable mutations with spawn snapshots, including their awaits. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.lane.then(operation);
    this.lane = pending.catch(() => undefined);
    return pending;
  }

  private root(projectRoot: string): string {
    try { return realpathSync(projectRoot); } catch { return resolve(projectRoot); }
  }

  has(projectRoot: string): boolean {
    return this.states.has(this.root(projectRoot));
  }

  /** A new host never trusts a prior host's generation (its memory vault may be empty). */
  ensure(projectRoot: string, input: { enabled: boolean; hasKey: boolean }, rotate = false): JevRuntimeSnapshot {
    const root = this.root(projectRoot);
    const previous = this.states.get(root);
    const generation = !rotate && previous?.enabled === input.enabled && previous.hasKey === input.hasKey
      ? previous.generation : randomUUID();
    const state: JevRuntimeState = { schemaVersion: 1, enabled: input.enabled, hasKey: input.hasKey, generation };
    const file = jevRuntimeStateFile(root);
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    this.states.set(root, state);
    return { file, generation };
  }

  /** Publish revocation BEFORE awaiting an overlay/vault mutation, not after notifying Pi. */
  revoke(projectRoot: string): void {
    const previous = this.states.get(this.root(projectRoot));
    this.ensure(projectRoot, { enabled: false, hasKey: previous?.hasKey ?? false }, true);
  }
}
