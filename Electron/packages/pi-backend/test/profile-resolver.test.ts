import { describe, expect, it } from "vitest";

import { parseProductProfileManifestJson } from "../src/profile-manifest.js";
import {
  overlayFromActivationPlan,
  projectedProfileExtensionIds,
  resolveProductProfile,
} from "../src/profile-resolver.js";

describe("Product Profile resolution", () => {
  it("resolves a valid profile into one deterministic activation plan", () => {
    const parsed = parseProductProfileManifestJson(JSON.stringify({
      schemaVersion: 1,
      id: "coding",
      name: "AI Coding",
      extensions: {
        required: [
          { id: "coding-runtime", version: "^1.0.0" },
          { id: "coding-workbench", version: "^1.0.0" },
        ],
        recommended: [{ id: "code-retrieval", version: "^1.0.0" }],
      },
      layout: {
        primarySidebar: "coding.sessions",
        center: "pipi.conversation",
      },
    }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const installed = [
      { id: "code-retrieval", version: "1.2.0" },
      { id: "coding-workbench", version: "1.0.1" },
      { id: "coding-runtime", version: "1.1.0" },
      { id: "unused", version: "9.0.0" },
    ];
    const first = resolveProductProfile({ profile: parsed.profile, installed });
    const second = resolveProductProfile({ profile: parsed.profile, installed: [...installed].reverse() });

    expect(first).toEqual({
      profile: { id: "coding" },
      enabled: [
        { id: "coding-runtime", version: "1.1.0", reason: "required" },
        { id: "coding-workbench", version: "1.0.1", reason: "required" },
        { id: "code-retrieval", version: "1.2.0", reason: "recommended" },
      ],
      disabled: [{ id: "unused", version: "9.0.0" }],
      missingRequired: [],
      missingRecommended: [],
      conflicts: [],
      layout: {
        primarySidebar: "coding.sessions",
        center: "pipi.conversation",
      },
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(second).toEqual(first);
  });

  it("applies project overrides but reports an attempt to disable a required extension", () => {
    const parsed = parseProductProfileManifestJson(JSON.stringify({
      schemaVersion: 1,
      id: "coding",
      name: "AI Coding",
      extensions: {
        required: [{ id: "coding-runtime", version: "^1.0.0" }],
        recommended: [{ id: "code-retrieval", version: "^1.0.0" }],
      },
      layout: {},
    }));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const plan = resolveProductProfile({
      profile: parsed.profile,
      installed: [
        { id: "coding-runtime", version: "1.0.0" },
        { id: "code-retrieval", version: "1.0.0" },
        { id: "pdf-extension", version: "0.1.0" },
      ],
      overrides: {
        "coding-runtime": "disabled",
        "code-retrieval": "disabled",
        "pdf-extension": "enabled",
      },
    });

    expect(plan.enabled).toEqual([
      { id: "coding-runtime", version: "1.0.0", reason: "required" },
      { id: "pdf-extension", version: "0.1.0", reason: "project-override" },
    ]);
    expect(plan.disabled).toEqual([{ id: "code-retrieval", version: "1.0.0" }]);
    expect(plan.conflicts).toEqual([{
      code: "required_disabled",
      id: "coding-runtime",
      range: "^1.0.0",
      installedVersion: "1.0.0",
    }]);
  });

  it("resolves transitive required and optional extension dependencies in topological order", () => {
    const parsed = parseProductProfileManifestJson(JSON.stringify({
      schemaVersion: 1,
      id: "coding",
      name: "AI Coding",
      extensions: {
        required: [{ id: "coding-workbench", version: "^1.0.0" }],
      },
      layout: {},
    }));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const plan = resolveProductProfile({
      profile: parsed.profile,
      installed: [
        {
          id: "coding-workbench",
          version: "1.0.0",
          dependencies: {
            required: [{ id: "coding-runtime", version: "^1.0.0" }],
            optional: [{ id: "webview-browser-extension", version: "^0.1.0" }],
            conflicts: [],
          },
        },
        { id: "coding-runtime", version: "1.4.0" },
        { id: "webview-browser-extension", version: "0.1.3" },
      ],
    });

    expect(plan.enabled).toEqual([
      { id: "coding-runtime", version: "1.4.0", reason: "dependency" },
      { id: "coding-workbench", version: "1.0.0", reason: "required" },
      { id: "webview-browser-extension", version: "0.1.3", reason: "optional-dependency" },
    ]);
    expect(plan.missingRequired).toEqual([]);
    expect(plan.missingRecommended).toEqual([]);
  });

  it("fails closed on dependency cycles and active extension conflicts", () => {
    const parsed = parseProductProfileManifestJson(JSON.stringify({
      schemaVersion: 1,
      id: "broken-product",
      name: "Broken",
      extensions: {
        required: [
          { id: "cycle-a", version: "^1.0.0" },
          { id: "conflict-left", version: "^1.0.0" },
          { id: "conflict-right", version: "^1.0.0" },
        ],
      },
      layout: {},
    }));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const plan = resolveProductProfile({
      profile: parsed.profile,
      installed: [
        { id: "cycle-a", version: "1.0.0", dependencies: { required: [{ id: "cycle-b", version: "^1.0.0" }] } },
        { id: "cycle-b", version: "1.0.0", dependencies: { required: [{ id: "cycle-a", version: "^1.0.0" }] } },
        { id: "conflict-left", version: "1.0.0", dependencies: { conflicts: ["conflict-right"] } },
        { id: "conflict-right", version: "1.0.0" },
      ],
    });

    expect(plan.conflicts).toEqual([
      { code: "dependency_cycle", id: "cycle-a", cycle: ["cycle-a", "cycle-b", "cycle-a"] },
      { code: "extension_conflict", id: "conflict-left", conflictsWith: "conflict-right" },
    ]);
  });

  it("walks required dependencies of a project-override enabled extension", () => {
    const parsed = parseProductProfileManifestJson(JSON.stringify({
      schemaVersion: 1,
      id: "lab-tools",
      name: "Lab Tools",
      extensions: {
        required: [{ id: "skill-loader-extension", version: "^1.0.0" }],
        recommended: [],
      },
      layout: {},
    }));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const plan = resolveProductProfile({
      profile: parsed.profile,
      installed: [
        { id: "skill-loader-extension", version: "1.0.0" },
        {
          id: "agent-orchestration",
          version: "1.0.0",
          dependencies: { required: [{ id: "git-capability", version: ">=1.0.0 <2.0.0" }] },
        },
        { id: "git-capability", version: "1.0.0" },
      ],
      overrides: { "agent-orchestration": "enabled" },
    });

    expect(plan.enabled).toEqual([
      { id: "skill-loader-extension", version: "1.0.0", reason: "required" },
      { id: "git-capability", version: "1.0.0", reason: "dependency" },
      { id: "agent-orchestration", version: "1.0.0", reason: "project-override" },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(projectedProfileExtensionIds(plan)).toEqual({
      requiredExtensionIds: ["skill-loader-extension", "git-capability"],
      recommendedExtensionIds: ["agent-orchestration"],
    });
    expect(overlayFromActivationPlan(plan, [
      "skill-loader-extension",
      "agent-orchestration",
      "git-capability",
      "coding-runtime",
    ])).toEqual({
      "skill-loader-extension": true,
      "agent-orchestration": true,
      "git-capability": true,
      "coding-runtime": false,
    });
  });

  it("fails closed when a required dependency is override-disabled", () => {
    const parsed = parseProductProfileManifestJson(JSON.stringify({
      schemaVersion: 1,
      id: "lab-tools",
      name: "Lab Tools",
      extensions: {
        required: [{ id: "agent-orchestration", version: "^1.0.0" }],
        recommended: [],
      },
      layout: {},
    }));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    const plan = resolveProductProfile({
      profile: parsed.profile,
      installed: [
        {
          id: "agent-orchestration",
          version: "1.0.0",
          dependencies: { required: [{ id: "git-capability", version: ">=1.0.0 <2.0.0" }] },
        },
        { id: "git-capability", version: "1.0.0" },
      ],
      overrides: { "git-capability": "disabled" },
    });

    expect(plan.conflicts).toEqual([{
      code: "required_disabled",
      id: "git-capability",
      range: ">=1.0.0 <2.0.0",
      installedVersion: "1.0.0",
    }]);
    expect(overlayFromActivationPlan(plan, ["agent-orchestration", "git-capability"])).toEqual({
      "agent-orchestration": false,
      "git-capability": false,
    });
  });
});
