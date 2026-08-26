import { describe, expect, it } from "vitest";
import {
  EXTENSION_AGENT_CONTRIBUTION_MAX,
  EXTENSION_AGENT_PATCH_MAX,
  EXTENSION_AGENT_PATCH_TOOLS_MAX,
  EXTENSION_AGENT_PATH_MAX,
  validateExtensionManifest,
} from "../src/extension-manifest.js";

function manifest(agent?: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: "probe",
    name: "Probe",
    version: "1.0.0",
    capabilities: [],
    ...(agent === undefined ? {} : { agent }),
    ...extra,
  };
}

function errorsOf(value: unknown): string {
  const result = validateExtensionManifest(value);
  expect(result.ok).toBe(false);
  if (result.ok) return "";
  return result.errors.join("; ");
}

describe("agent.extension / agent.skills compatibility", () => {
  it("accepts a legacy agent-half with only extension and skills", () => {
    const result = validateExtensionManifest(
      manifest({
        extension: "agent/dist/index.js",
        skills: ["skills/hello"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.agentExtension).toBe("agent/dist/index.js");
    expect(result.manifest.agentSkills).toEqual(["skills/hello"]);
    expect(result.manifest.agents).toBeUndefined();
    expect(result.manifest.agentPatches).toBeUndefined();
  });

  it("accepts a manifest with no agent block", () => {
    const result = validateExtensionManifest(manifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.agentExtension).toBeUndefined();
    expect(result.manifest.agents).toBeUndefined();
  });
});

describe("agent.agents / agent.agentPatches", () => {
  it("parses legal contributions and keeps relative paths", () => {
    const result = validateExtensionManifest(
      manifest({
        extension: "agent/dist/index.js",
        agents: ["agents/reviewer-lite/AGENT.md", " agents/extra/AGENT.md "],
        agentPatches: [
          {
            target: "explore",
            appendPrompt: "prompts/explore-extra.md",
            addTools: ["code_search"],
            removeTools: ["bash"],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.agentExtension).toBe("agent/dist/index.js");
    expect(result.manifest.agents).toEqual(["agents/reviewer-lite/AGENT.md", "agents/extra/AGENT.md"]);
    expect(result.manifest.agentPatches).toEqual([
      {
        target: "explore",
        appendPrompt: "prompts/explore-extra.md",
        addTools: ["code_search"],
        removeTools: ["bash"],
      },
    ]);
  });

  it("accepts replacePrompt without add/remove tools", () => {
    const result = validateExtensionManifest(
      manifest({
        agentPatches: [{ target: "reviewer", replacePrompt: "prompts/reviewer.md" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.agentPatches).toEqual([
      { target: "reviewer", replacePrompt: "prompts/reviewer.md" },
    ]);
  });

  it("rejects unknown fields on agent and on a patch", () => {
    expect(errorsOf(manifest({ extension: "agent/index.js", prompt: "nope" }))).toMatch(
      /unknown field 'prompt' in agent/,
    );
    expect(
      errorsOf(
        manifest({
          agentPatches: [{ target: "explore", addTools: ["read"], inlinePrompt: "x" }],
        }),
      ),
    ).toMatch(/unknown field 'inlinePrompt' in agent\.agentPatches\[0\]/);
  });

  it("rejects wrong types", () => {
    expect(errorsOf(manifest("agent/index.js"))).toMatch(/agent must be an object/);
    expect(errorsOf(manifest({ agents: { path: "agents/x/AGENT.md" } }))).toMatch(
      /agent\.agents must be an array of AGENT\.md relative paths/,
    );
    expect(errorsOf(manifest({ agentPatches: { target: "explore" } }))).toMatch(
      /agent\.agentPatches must be an array/,
    );
    expect(errorsOf(manifest({ agentPatches: ["explore"] }))).toMatch(
      /agent\.agentPatches\[0\] must be an object/,
    );
    expect(errorsOf(manifest({ agentPatches: [{ target: "explore", addTools: "read" }] }))).toMatch(
      /addTools must be an array of non-empty strings/,
    );
  });

  it("rejects appendPrompt and replacePrompt together", () => {
    expect(
      errorsOf(
        manifest({
          agentPatches: [
            {
              target: "explore",
              appendPrompt: "prompts/a.md",
              replacePrompt: "prompts/b.md",
            },
          ],
        }),
      ),
    ).toMatch(/cannot declare both appendPrompt and replacePrompt/);
  });

  it("rejects duplicate agent paths, patch targets, and tool names", () => {
    expect(
      errorsOf(manifest({ agents: ["agents/x/AGENT.md", "agents/x/AGENT.md"] })),
    ).toMatch(/duplicate agent path 'agents\/x\/AGENT\.md'/);
    expect(
      errorsOf(
        manifest({
          agentPatches: [
            { target: "explore", addTools: ["read"] },
            { target: "explore", removeTools: ["bash"] },
          ],
        }),
      ),
    ).toMatch(/duplicate agent patch target 'explore'/);
    expect(
      errorsOf(
        manifest({
          agentPatches: [{ target: "explore", addTools: ["read", "read"] }],
        }),
      ),
    ).toMatch(/duplicate tool name 'read'/);
    expect(
      errorsOf(
        manifest({
          agentPatches: [{ target: "explore", addTools: ["read"], removeTools: ["read"] }],
        }),
      ),
    ).toMatch(/cannot add and remove the same tool \(read\)/);
  });

  it("rejects path traversal, absolute, home, backslash, and control characters", () => {
    expect(errorsOf(manifest({ agents: ["../agents/x/AGENT.md"] }))).toMatch(
      /must not contain empty, '\.', or '\.\.' segments/,
    );
    expect(errorsOf(manifest({ agents: ["agents/foo/../../etc/AGENT.md"] }))).toMatch(
      /must not contain empty, '\.', or '\.\.' segments/,
    );
    expect(errorsOf(manifest({ agents: ["/etc/passwd/AGENT.md"] }))).toMatch(/must be a relative path/);
    expect(errorsOf(manifest({ agents: ["C:\\\\temp\\\\AGENT.md"] }))).toMatch(/must be a relative path/);
    expect(
      errorsOf(manifest({ agentPatches: [{ target: "explore", appendPrompt: "~/secret.md" }] })),
    ).toMatch(/must be a relative path/);
    expect(
      errorsOf(manifest({ agentPatches: [{ target: "explore", appendPrompt: "prompts\\\\x.md" }] })),
    ).toMatch(/must use forward slashes/);
    expect(errorsOf(manifest({ agents: ["agents/x\u0000/AGENT.md"] }))).toMatch(
      /must not contain control characters/,
    );
    expect(
      errorsOf(manifest({ agentPatches: [{ target: "explore", appendPrompt: "prompts/x\n.md" }] })),
    ).toMatch(/must not contain control characters/);
  });

  it("rejects agents that are not schema:1 AGENT.md paths", () => {
    expect(errorsOf(manifest({ agents: ["agents/x/agent.md"] }))).toMatch(
      /must be a schema:1 AGENT\.md relative path/,
    );
    expect(errorsOf(manifest({ agents: ["agents/x"] }))).toMatch(
      /must be a schema:1 AGENT\.md relative path/,
    );
  });

  it("rejects missing target, empty patch, and invalid names", () => {
    expect(errorsOf(manifest({ agentPatches: [{ addTools: ["read"] }] }))).toMatch(
      /target must be a non-empty agent name/,
    );
    expect(errorsOf(manifest({ agentPatches: [{ target: "explore" }] }))).toMatch(
      /must declare at least one of appendPrompt, replacePrompt, addTools, removeTools/,
    );
    expect(errorsOf(manifest({ agentPatches: [{ target: "../explore", addTools: ["read"] }] }))).toMatch(
      /not a valid agent name/,
    );
    expect(
      errorsOf(manifest({ agentPatches: [{ target: "explore", addTools: ["read tool"] }] })),
    ).toMatch(/invalid tool name 'read tool'/);
  });

  it("rejects oversized arrays and paths", () => {
    const tooManyAgents = Array.from(
      { length: EXTENSION_AGENT_CONTRIBUTION_MAX + 1 },
      (_, i) => `agents/a${i}/AGENT.md`,
    );
    expect(errorsOf(manifest({ agents: tooManyAgents }))).toMatch(
      /agent\.agents must have at most 32 entries/,
    );
    const tooManyPatches = Array.from({ length: EXTENSION_AGENT_PATCH_MAX + 1 }, (_, i) => ({
      target: `agent-${i}`,
      addTools: ["read"],
    }));
    expect(errorsOf(manifest({ agentPatches: tooManyPatches }))).toMatch(
      /agent\.agentPatches must have at most 32 entries/,
    );
    const tooManyTools = Array.from({ length: EXTENSION_AGENT_PATCH_TOOLS_MAX + 1 }, (_, i) => `tool_${i}`);
    expect(
      errorsOf(manifest({ agentPatches: [{ target: "explore", addTools: tooManyTools }] })),
    ).toMatch(/addTools must have at most 32 entries/);
    const longPath = `${"a".repeat(EXTENSION_AGENT_PATH_MAX)}/AGENT.md`;
    expect(errorsOf(manifest({ agents: [longPath] }))).toMatch(/must be at most 256 characters/);
  });

  it("does not require contributed files to exist at validate time", () => {
    const result = validateExtensionManifest(
      manifest({ agents: ["agents/does-not-exist-yet/AGENT.md"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.agents).toEqual(["agents/does-not-exist-yet/AGENT.md"]);
  });
});
