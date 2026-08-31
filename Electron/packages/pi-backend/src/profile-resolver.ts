import { createHash } from "node:crypto";

import { satisfiesExtensionHostApiRange } from "./extension-update-engine.js";
import type { ProductProfileLayout, ProductProfileManifest } from "./profile-manifest.js";

export type InstalledProfileExtension = {
  id: string;
  version: string;
  dependencies?: {
    required?: readonly { id: string; version: string }[];
    optional?: readonly { id: string; version: string }[];
    conflicts?: readonly string[];
  };
};

export type ResolvedProfileExtension = InstalledProfileExtension & {
  reason: "required" | "recommended" | "dependency" | "optional-dependency" | "project-override";
};

export type ProfileDependencyIssue = {
  code: "missing" | "version_mismatch" | "required_disabled";
  id: string;
  range: string;
  installedVersion?: string;
};

export type ProfileConflictIssue =
  | { code: "required_disabled"; id: string; range: string; installedVersion: string }
  | { code: "dependency_cycle"; id: string; cycle: string[] }
  | { code: "extension_conflict"; id: string; conflictsWith: string };

export type ProductActivationPlan = {
  profile: { id: string };
  enabled: ResolvedProfileExtension[];
  disabled: InstalledProfileExtension[];
  missingRequired: ProfileDependencyIssue[];
  missingRecommended: ProfileDependencyIssue[];
  conflicts: ProfileConflictIssue[];
  layout: ProductProfileLayout;
  fingerprint: string;
};

export type ResolveProductProfileInput = {
  profile: ProductProfileManifest;
  installed: readonly InstalledProfileExtension[];
  overrides?: Readonly<Record<string, "enabled" | "disabled">>;
};

function issue(id: string, range: string, installedVersion?: string): ProfileDependencyIssue {
  return installedVersion
    ? { code: "version_mismatch", id, range, installedVersion }
    : { code: "missing", id, range };
}

function fingerprint(value: Omit<ProductActivationPlan, "fingerprint">): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function resolveProductProfile(input: ResolveProductProfileInput): ProductActivationPlan {
  const installed = [...input.installed].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(installed.map(item => [item.id, item]));
  const enabled: ResolvedProfileExtension[] = [];
  const enabledById = new Map<string, number>();
  const missingRequired: ProfileDependencyIssue[] = [];
  const missingRecommended: ProfileDependencyIssue[] = [];
  const conflicts: ProfileConflictIssue[] = [];
  const selected = new Set<string>();
  const overrides = input.overrides ?? {};

  const addEnabled = (candidate: InstalledProfileExtension, reason: ResolvedProfileExtension["reason"]) => {
    const existing = enabledById.get(candidate.id);
    if (existing !== undefined) {
      if (reason === "required") enabled[existing] = { id: candidate.id, version: candidate.version, reason };
      return;
    }
    enabledById.set(candidate.id, enabled.length);
    selected.add(candidate.id);
    enabled.push({ id: candidate.id, version: candidate.version, reason });
  };

  const visiting: string[] = [];
  const selectOne = (
    requirement: { id: string; version: string },
    reason: ResolvedProfileExtension["reason"],
    missing: ProfileDependencyIssue[],
  ) => {
    const candidate = byId.get(requirement.id);
    if (!candidate || !satisfiesExtensionHostApiRange(requirement.version, candidate.version)) {
      missing.push(issue(requirement.id, requirement.version, candidate?.version));
      return;
    }
    if (overrides[requirement.id] === "disabled") {
      if (reason === "recommended" || reason === "optional-dependency") return;
      conflicts.push({
        code: "required_disabled",
        id: requirement.id,
        range: requirement.version,
        installedVersion: candidate.version,
      });
    }
    const cycleStart = visiting.indexOf(candidate.id);
    if (cycleStart >= 0) {
      const cycle = [...visiting.slice(cycleStart), candidate.id];
      if (!conflicts.some(item => item.code === "dependency_cycle" && item.cycle.join("\0") === cycle.join("\0"))) {
        conflicts.push({ code: "dependency_cycle", id: candidate.id, cycle });
      }
      return;
    }
    if (selected.has(candidate.id)) {
      addEnabled(candidate, reason);
      return;
    }
    visiting.push(candidate.id);
    for (const dependency of [...(candidate.dependencies?.required ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      selectOne(dependency, "dependency", missingRequired);
    }
    addEnabled(candidate, reason);
    for (const dependency of [...(candidate.dependencies?.optional ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      selectOne(dependency, "optional-dependency", missingRecommended);
    }
    visiting.pop();
  };

  const select = (
    requirements: readonly { id: string; version: string }[],
    reason: ResolvedProfileExtension["reason"],
    missing: ProfileDependencyIssue[],
  ) => {
    for (const requirement of [...requirements].sort((a, b) => a.id.localeCompare(b.id))) {
      selectOne(requirement, reason, missing);
    }
  };

  select(input.profile.extensions.required, "required", missingRequired);
  select(input.profile.extensions.recommended, "recommended", missingRecommended);
  for (const id of Object.keys(overrides).sort()) {
    if (overrides[id] !== "enabled" || selected.has(id)) continue;
    const candidate = byId.get(id);
    if (!candidate) continue;
    selectOne({ id: candidate.id, version: candidate.version }, "project-override", missingRequired);
  }
  const activeIds = new Set(enabled.map(item => item.id));
  const conflictPairs = new Set<string>();
  for (const item of enabled) {
    const candidate = byId.get(item.id);
    for (const other of [...(candidate?.dependencies?.conflicts ?? [])].sort()) {
      if (!activeIds.has(other)) continue;
      const pair = [item.id, other].sort().join("\0");
      if (conflictPairs.has(pair)) continue;
      conflictPairs.add(pair);
      conflicts.push({ code: "extension_conflict", id: item.id, conflictsWith: other });
    }
  }

  const withoutFingerprint = {
    profile: { id: input.profile.id },
    enabled,
    disabled: installed.filter(item => !selected.has(item.id)).map(({ id, version }) => ({ id, version })),
    missingRequired,
    missingRecommended,
    conflicts,
    layout: input.profile.layout,
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function formatActivationPlanProblems(plan: Pick<ProductActivationPlan, "missingRequired" | "conflicts">): string {
  return [...plan.missingRequired, ...plan.conflicts]
    .map(issue => issue.code === "extension_conflict"
      ? `${issue.id} conflicts with ${issue.conflictsWith}`
      : issue.code === "dependency_cycle"
        ? `dependency cycle ${issue.cycle.join(" -> ")}`
        : `${issue.id} ${issue.code}`)
    .join("; ");
}

export function projectedProfileExtensionIds(plan: ProductActivationPlan): {
  requiredExtensionIds: string[];
  recommendedExtensionIds: string[];
} {
  const requiredExtensionIds: string[] = [];
  const recommendedExtensionIds: string[] = [];
  for (const item of plan.enabled) {
    if (item.reason === "required" || item.reason === "dependency") {
      requiredExtensionIds.push(item.id);
    } else if (
      item.reason === "recommended"
      || item.reason === "optional-dependency"
      || item.reason === "project-override"
    ) {
      recommendedExtensionIds.push(item.id);
    }
  }
  return { requiredExtensionIds, recommendedExtensionIds };
}

export function overlayFromActivationPlan(
  plan: ProductActivationPlan,
  extensionIds: readonly string[],
  overrides: Readonly<Record<string, "enabled" | "disabled">> = {},
): Record<string, boolean> {
  const resolved = plan.missingRequired.length || plan.conflicts.length
    ? Object.fromEntries(extensionIds.map(id => [id, false]))
    : (() => {
      const enabled = new Set(plan.enabled.map(item => item.id));
      return Object.fromEntries(extensionIds.map(id => [id, enabled.has(id)]));
    })();
  // Explicit user choices from the Extensions pane outlive plan recomputation:
  // a transient scan hiccup or a fail-closed profile resolution must not flip
  // toggles the user set themselves (2026-08-31 flip fix).
  for (const [id, state] of Object.entries(overrides)) {
    if (id in resolved) resolved[id] = state === "enabled";
  }
  return resolved;
}
