import type { ComputerWorkerRole } from "./worker-broker.ts";

const ROLE_SKILLS: Record<ComputerWorkerRole, readonly string[]> = {
  "gui-operator": ["cua-driver-operation", "desktop-investigation"],
  "terminal-worker": ["terminal-investigation"],
  verifier: ["desktop-verification"],
};

export function skillNamesForComputerRole(role: ComputerWorkerRole): string[] {
  return [...ROLE_SKILLS[role]];
}

export function isComputerWorkerRole(value: unknown): value is ComputerWorkerRole {
  return value === "gui-operator" || value === "terminal-worker" || value === "verifier";
}
