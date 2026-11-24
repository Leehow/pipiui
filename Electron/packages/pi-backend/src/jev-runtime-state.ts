import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { projectPiAgentDir } from "./project-pi-home.js";

export const JEV_EXTENSION_ID = "jev-optimizer";
export const JEV_SECRET_KEY = "ext.jev-optimizer.apiKey";
export const JEV_BROWSER_ENABLED_KEY = "ext.jev-optimizer.browserEnabled";
export const JEV_CONTEXT_ENABLED_KEY = "ext.jev-optimizer.contextEnabled";
export const JEV_COMPUTER_ENABLED_KEY = "ext.jev-optimizer.computerEnabled";
export const JEV_SECRET_ENV = "EXT_JEV_OPTIMIZER_APIKEY";
export const JEV_STATE_FILE_ENV = "PIPIUI_JEV_STATE_FILE";
export const JEV_GENERATION_ENV = "PIPIUI_JEV_GENERATION";

export type JevRuntimeState = {
  schemaVersion: 1;
  enabled: boolean;
  hasKey: boolean;
  generation: string;
  browserEnabled: boolean;
  browserGeneration: string;
  computerEnabled: boolean;
  computerUseEnabled: boolean;
  computerGeneration: string;
  contextEnabled?: boolean;
};
export type JevRuntimeSnapshot = { file: string; generation: string };

export function jevRuntimeStateFile(projectRoot: string): string {
  return join(projectPiAgentDir(projectRoot), JEV_EXTENSION_ID, "runtime-state.json");
}

/** Host authority only: the file contains neither a credential nor its fingerprint.
 *  `hasKey` is restored from the local `{projectAgentHome}/jev-optimizer/credential.json`
 *  via the in-memory extension vault cache — never from this JSON. */
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
  ensure(projectRoot: string, input: { enabled: boolean; hasKey: boolean; browserEnabled?: boolean; contextEnabled?: boolean; computerEnabled?: boolean; computerUseEnabled?: boolean }, rotate = false): JevRuntimeSnapshot {
    const root = this.root(projectRoot);
    const previous = this.states.get(root);
    const browserEnabled = input.browserEnabled === true;
    const computerEnabled = input.computerEnabled === true;
    const computerUseEnabled = input.computerUseEnabled === true;
    const generation = !rotate && previous?.enabled === input.enabled && previous.hasKey === input.hasKey
      ? previous.generation : randomUUID();
    const browserGeneration = !rotate
      && previous
      && generation === previous.generation
      && (previous.browserEnabled === true) === browserEnabled
      && typeof previous.browserGeneration === "string"
      && previous.browserGeneration.length > 0
      ? previous.browserGeneration
      : randomUUID();
    const computerGeneration = !rotate
      && previous
      && generation === previous.generation
      && previous.computerEnabled === computerEnabled
      && previous.computerUseEnabled === computerUseEnabled
      && typeof previous.computerGeneration === "string"
      && previous.computerGeneration.length > 0
      ? previous.computerGeneration
      : randomUUID();
    const state: JevRuntimeState = {
      schemaVersion: 1, enabled: input.enabled, hasKey: input.hasKey, generation, browserEnabled, browserGeneration,
      computerEnabled, computerUseEnabled, computerGeneration,
      ...(input.contextEnabled === true ? { contextEnabled: true } : {}),
    };
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

  /** Synchronous global execution projection; no browser, context or base authority changes. */
  setComputerUseEnabled(enabled: boolean): void {
    for (const [root, previous] of this.states) {
      if (previous.computerUseEnabled === enabled) continue;
      this.ensure(root, { ...previous, computerUseEnabled: enabled });
    }
  }

  /** Publish revocation BEFORE awaiting an overlay/vault mutation, not after notifying Pi. */
  revoke(projectRoot: string): void {
    const previous = this.states.get(this.root(projectRoot));
    this.ensure(projectRoot, { enabled: false, hasKey: previous?.hasKey ?? false,
      computerUseEnabled: previous?.computerUseEnabled === true }, true);
  }

  /** Browser-only: keep all other authority; no-op when browser is already false. */
  revokeBrowser(projectRoot: string): void {
    const previous = this.states.get(this.root(projectRoot));
    if (previous?.browserEnabled !== true) return;
    this.ensure(projectRoot, { enabled: previous.enabled, hasKey: previous.hasKey, browserEnabled: false,
      contextEnabled: previous.contextEnabled, computerEnabled: previous.computerEnabled, computerUseEnabled: previous.computerUseEnabled });
  }

  /** Computer-only revocation preserves retrieval, browser and context authority. */
  revokeComputer(projectRoot: string): void {
    const previous = this.states.get(this.root(projectRoot));
    if (previous?.computerEnabled !== true) return;
    this.ensure(projectRoot, { enabled: previous.enabled, hasKey: previous.hasKey,
      browserEnabled: previous.browserEnabled, contextEnabled: previous.contextEnabled, computerEnabled: false, computerUseEnabled: previous.computerUseEnabled });
  }

  /** Context-only revocation preserves retrieval, browser and computer authority. */
  revokeContext(projectRoot: string): void {
    const previous = this.states.get(this.root(projectRoot));
    if (previous?.contextEnabled !== true) return;
    this.ensure(projectRoot, { enabled: previous.enabled, hasKey: previous.hasKey,
      browserEnabled: previous.browserEnabled, contextEnabled: false, computerEnabled: previous.computerEnabled, computerUseEnabled: previous.computerUseEnabled });
  }
}
