import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ComputerArtifactKind = "screenshot" | "accessibility" | "terminal" | "trajectory" | "file";
export type ComputerArtifactReference = {
  id: string;
  kind: ComputerArtifactKind;
  summary: string;
  digest: string;
  byteLength: number;
};

export class TaskArtifactStore {
  readonly #root: string;
  constructor(root: string) { this.#root = root; }

  async put(kind: ComputerArtifactKind, value: string | Uint8Array, summary: string): Promise<ComputerArtifactReference> {
    const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const id = `artifact:${randomUUID()}`;
    await mkdir(this.#root, { recursive: true });
    await writeFile(join(this.#root, `${id.slice("artifact:".length)}.bin`), bytes, { mode: 0o600 });
    return { id, kind, summary: summary.slice(0, 240), digest, byteLength: bytes.byteLength };
  }
}

export function compressWorkerTrajectory(input: {
  outcome: string;
  summary: string;
  artifactReferences?: ComputerArtifactReference[];
  nextStepSuggestion?: string;
}): {
  outcome: string;
  summary: string;
  artifactReferences: ComputerArtifactReference[];
  nextStepSuggestion?: string;
} {
  return {
    outcome: input.outcome,
    summary: input.summary.slice(0, 1000),
    artifactReferences: (input.artifactReferences ?? []).slice(0, 12),
    ...(input.nextStepSuggestion ? { nextStepSuggestion: input.nextStepSuggestion.slice(0, 300) } : {}),
  };
}
