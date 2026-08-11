import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeSubagentCapabilityCeilingV1,
  encodeSubagentCapabilityCeilingV1,
  equivalentSubagentCapabilityAuthorityV1,
  intersectSubagentCapabilityCeilingsV1,
  isSubagentCapabilityAuthorityAtMostV1,
  parseSubagentCapabilityCeilingV1,
  SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES,
} from "../../Sources/PipiUI/PiExt/subagent/capability-ceiling.ts";

const parse = parseSubagentCapabilityCeilingV1;
const intersect = intersectSubagentCapabilityCeilingsV1;

test("normalizes sorted unique sets and produces stable encoding", () => {
  const ceiling = parse({
    version: 1,
    allowedTools: ["write", "read", "write"],
    allowedAgents: ["worker", "scout", "worker"],
    denyExtensions: false,
    provenance: ["project", "parent", "project"],
  });

  assert.deepEqual(ceiling, {
    version: 1,
    allowedTools: ["read", "write"],
    allowedAgents: ["scout", "worker"],
    denyExtensions: false,
    provenance: ["parent", "project"],
  });
  assert.equal(encodeSubagentCapabilityCeilingV1(ceiling), encodeSubagentCapabilityCeilingV1(parse({
    provenance: ["parent", "project"],
    denyExtensions: false,
    allowedAgents: ["scout", "worker"],
    allowedTools: ["read", "write"],
    version: 1,
  })));
});

test("intersection is commutative, associative at authority level, and idempotent", () => {
  const a = parse({ version: 1, allowedTools: ["read", "write"], denyExtensions: false, provenance: ["a"] });
  const b = parse({ version: 1, allowedTools: ["read", "bash"], allowedAgents: ["scout", "worker"], denyExtensions: true, provenance: ["b"] });
  const c = parse({ version: 1, allowedAgents: ["worker", "reviewer"], denyExtensions: false, provenance: ["c"] });

  assert.ok(equivalentSubagentCapabilityAuthorityV1(intersect(a, b), intersect(b, a)));
  assert.ok(equivalentSubagentCapabilityAuthorityV1(intersect(intersect(a, b), c), intersect(a, intersect(b, c))));
  assert.ok(equivalentSubagentCapabilityAuthorityV1(intersect(a, a), a));
  assert.deepEqual(intersect(a, b).provenance, ["a", "b"]);
});

test("narrowing cannot add tools or agents or clear extension denial", () => {
  const parent = parse({
    version: 1,
    allowedTools: ["read", "write"],
    allowedAgents: ["scout"],
    denyExtensions: true,
  });
  const childRequest = parse({
    version: 1,
    allowedTools: ["write", "bash"],
    allowedAgents: ["scout", "worker"],
    denyExtensions: false,
  });
  const child = intersect(parent, childRequest);

  assert.deepEqual(child.allowedTools, ["write"]);
  assert.deepEqual(child.allowedAgents, ["scout"]);
  assert.equal(child.denyExtensions, true);
  assert.ok(isSubagentCapabilityAuthorityAtMostV1(child, parent));
  assert.equal(isSubagentCapabilityAuthorityAtMostV1(childRequest, parent), false);
});

test("bounded side wins over unbounded while absent plus absent remains unbounded", () => {
  const unbounded = parse({ version: 1, denyExtensions: false });
  const bounded = parse({ version: 1, allowedTools: [], allowedAgents: ["scout"], denyExtensions: false });

  assert.deepEqual(intersect(unbounded, bounded).allowedTools, []);
  assert.deepEqual(intersect(unbounded, bounded).allowedAgents, ["scout"]);
  assert.equal(Object.hasOwn(intersect(unbounded, unbounded), "allowedTools"), false);
  assert.ok(isSubagentCapabilityAuthorityAtMostV1(bounded, unbounded));
  assert.equal(isSubagentCapabilityAuthorityAtMostV1(unbounded, bounded), false);
});

test("provenance is diagnostic-only, deterministic, and bounded", () => {
  const left = parse({ version: 1, allowedTools: ["read"], denyExtensions: false, provenance: ["z", "a"] });
  const right = parse({ version: 1, allowedTools: ["read"], denyExtensions: false, provenance: ["m", "a"] });

  assert.ok(equivalentSubagentCapabilityAuthorityV1(left, right));
  assert.deepEqual(intersect(left, right).provenance, ["a", "m", "z"]);
  assert.throws(() => parse({ version: 1, denyExtensions: false, provenance: Array.from({ length: 9 }, (_, i) => `p${i}`) }), /provenance/i);
  assert.throws(() => parse({ version: 1, denyExtensions: false, provenance: ["bad\nsource"] }), /provenance/i);
  assert.throws(() => parse({ version: 1, denyExtensions: false, provenance: ["x".repeat(129)] }), /provenance/i);
});

test("strict parsing rejects incompatible, unknown, blank, and invalid values", () => {
  const invalid = [
    null,
    [],
    { version: 2, denyExtensions: false },
    { version: 1, denyExtensions: false, extra: true },
    { version: 1, denyExtensions: "false" },
    { version: 1, allowedTools: "read", denyExtensions: false },
    { version: 1, allowedTools: [""], denyExtensions: false },
    { version: 1, allowedAgents: ["  "], denyExtensions: false },
    { version: 1, allowedAgents: [3], denyExtensions: false },
  ];
  for (const value of invalid) assert.throws(() => parse(value));
});

test("encode/decode round trips deterministically and rejects malformed transport", () => {
  const ceiling = parse({
    version: 1,
    allowedTools: ["read", "write"],
    allowedAgents: ["worker"],
    denyExtensions: true,
    provenance: ["parent", "package"],
  });
  const encoded = encodeSubagentCapabilityCeilingV1(ceiling);
  const decoded = decodeSubagentCapabilityCeilingV1(encoded);

  assert.deepEqual(decoded, ceiling);
  assert.ok(equivalentSubagentCapabilityAuthorityV1(decoded, ceiling));
  assert.equal(encodeSubagentCapabilityCeilingV1(decoded), encoded);
  for (const value of ["", "scv2.e30", "scv1.!", "scv1.e30=", "scv1.e30", `scv1.${"a".repeat(SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES)}`]) {
    assert.throws(() => decodeSubagentCapabilityCeilingV1(value));
  }
});
