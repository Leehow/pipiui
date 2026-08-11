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

test("strict parsing inspects descriptors without executing accessors", () => {
  let getterCalls = 0;
  let proxyTrapCalls = 0;
  const accessor = { version: 1 };
  Object.defineProperty(accessor, "denyExtensions", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return false;
    },
  });
  const symbolExtra = { version: 1, denyExtensions: false, [Symbol("extra")]: true };
  const hiddenExtra = { version: 1, denyExtensions: false };
  Object.defineProperty(hiddenExtra, "extra", { enumerable: false, value: true });
  const hiddenKnown = { denyExtensions: false };
  Object.defineProperty(hiddenKnown, "version", { enumerable: false, value: 1 });
  const protoExtra = { version: 1, denyExtensions: false };
  Object.defineProperty(protoExtra, "__proto__", { enumerable: true, value: "extra" });
  const proxy = new Proxy({ version: 1, denyExtensions: false }, {
    getPrototypeOf(target) {
      proxyTrapCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      proxyTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });

  assert.throws(() => parse(accessor), /data property/i);
  assert.equal(getterCalls, 0);
  assert.throws(() => parse(symbolExtra), /symbol/i);
  assert.throws(() => parse(hiddenExtra), /unknown key/i);
  assert.throws(() => parse(hiddenKnown), /enumerable data property/i);
  assert.throws(() => parse(protoExtra), /unknown key/i);
  assert.throws(() => parse({ version: 1, denyExtensions: false, constructor: "extra" }), /unknown key/i);
  assert.throws(() => parse(proxy), /expected an object/i);
  assert.equal(proxyTrapCalls, 0);

  const nullPrototype = Object.assign(Object.create(null), {
    version: 1,
    allowedTools: ["read"],
    denyExtensions: false,
  });
  assert.deepEqual(parse(nullPrototype), {
    version: 1,
    allowedTools: ["read"],
    denyExtensions: false,
  });
});

test("entry and collection bounds use UTF-8 bytes and reject all Unicode controls", () => {
  const entries = (count) => Array.from({ length: count }, (_, index) => `tool-${index}`);
  assert.equal(parse({ version: 1, allowedTools: entries(255), denyExtensions: false }).allowedTools.length, 255);
  assert.equal(parse({ version: 1, allowedTools: entries(256), denyExtensions: false }).allowedTools.length, 256);
  assert.throws(() => parse({ version: 1, allowedTools: entries(257), denyExtensions: false }), /256 entries/i);

  assert.doesNotThrow(() => parse({ version: 1, allowedTools: ["x".repeat(127)], denyExtensions: false }));
  assert.doesNotThrow(() => parse({ version: 1, allowedTools: ["x".repeat(128)], denyExtensions: false }));
  assert.throws(() => parse({ version: 1, allowedTools: ["x".repeat(129)], denyExtensions: false }), /128 UTF-8 bytes/i);
  assert.doesNotThrow(() => parse({ version: 1, allowedTools: ["é".repeat(64)], denyExtensions: false }));
  assert.throws(() => parse({ version: 1, allowedTools: [`${"é".repeat(64)}x`], denyExtensions: false }), /128 UTF-8 bytes/i);
  assert.throws(() => parse({ version: 1, allowedTools: ["read\u0085write"], denyExtensions: false }), /control character/i);
  assert.throws(() => parse({ version: 1, allowedAgents: ["worker\u009f"], denyExtensions: false }), /control character/i);
});

test("every accepted value is canonically encodable, including simultaneous maxima", () => {
  const tools = Array.from({ length: 256 }, (_, index) => `t${index.toString().padStart(3, "0")}`);
  const agents = Array.from({ length: 256 }, (_, index) => `a${index.toString().padStart(3, "0")}`);
  const provenance = Array.from({ length: 8 }, (_, index) => `source-${index}`);
  const maximumCounts = parse({ version: 1, allowedTools: tools, allowedAgents: agents, denyExtensions: true, provenance });
  assert.deepEqual(decodeSubagentCapabilityCeilingV1(encodeSubagentCapabilityCeilingV1(maximumCounts)), maximumCounts);
  const otherProvenance = parse({
    version: 1,
    allowedTools: tools,
    allowedAgents: agents,
    denyExtensions: false,
    provenance: Array.from({ length: 8 }, (_, index) => `other-${index}`),
  });
  assert.doesNotThrow(() => encodeSubagentCapabilityCeilingV1(intersect(maximumCounts, otherProvenance)));

  const escapedBoundary = parse({
    version: 1,
    allowedTools: ["\"".repeat(128)],
    allowedAgents: ["\\".repeat(128)],
    denyExtensions: false,
    provenance: ["é".repeat(64)],
  });
  assert.deepEqual(decodeSubagentCapabilityCeilingV1(encodeSubagentCapabilityCeilingV1(escapedBoundary)), escapedBoundary);

  const transportOverflow = Array.from(
    { length: 256 },
    (_, index) => `${index.toString().padStart(3, "0")}${"\\".repeat(125)}`,
  );
  assert.throws(() => parse({
    version: 1,
    allowedTools: transportOverflow,
    allowedAgents: transportOverflow,
    denyExtensions: false,
  }), /transport/i);
});

test("authority laws hold exhaustively over a deterministic small domain", () => {
  const dimensions = [undefined, [], ["read"], ["write"], ["read", "write"]];
  const values = [];
  for (const allowedTools of dimensions) {
    for (const allowedAgents of dimensions) {
      for (const denyExtensions of [false, true]) {
        values.push(parse({
          version: 1,
          ...(allowedTools === undefined ? {} : { allowedTools }),
          ...(allowedAgents === undefined ? {} : { allowedAgents }),
          denyExtensions,
        }));
      }
    }
  }

  const authorityKey = (value) => JSON.stringify([
    value.allowedTools === undefined ? null : value.allowedTools,
    value.allowedAgents === undefined ? null : value.allowedAgents,
    value.denyExtensions,
  ]);
  const indexByAuthority = new Map(values.map((value, index) => [authorityKey(value), index]));
  const intersectionTable = values.map(() => Array(values.length));

  for (const [aIndex, a] of values.entries()) {
    assert.ok(equivalentSubagentCapabilityAuthorityV1(intersect(a, a), a));
    for (const [bIndex, b] of values.entries()) {
      const ab = intersect(a, b);
      assert.ok(equivalentSubagentCapabilityAuthorityV1(ab, intersect(b, a)));
      assert.ok(isSubagentCapabilityAuthorityAtMostV1(ab, a));
      assert.ok(isSubagentCapabilityAuthorityAtMostV1(ab, b));
      assert.doesNotThrow(() => encodeSubagentCapabilityCeilingV1(ab));
      intersectionTable[aIndex][bIndex] = indexByAuthority.get(authorityKey(ab));
      assert.notEqual(intersectionTable[aIndex][bIndex], undefined);
    }
  }

  for (let a = 0; a < values.length; a += 1) {
    for (let b = 0; b < values.length; b += 1) {
      for (let c = 0; c < values.length; c += 1) {
        assert.equal(
          intersectionTable[intersectionTable[a][b]][c],
          intersectionTable[a][intersectionTable[b][c]],
        );
      }
    }
  }
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
  for (const value of ["", "scv2.e30", "scv1.!", "scv1.e30=", "scv1.e30", "scv1._w", `scv1.${"a".repeat(SUBAGENT_CAPABILITY_CEILING_V1_MAX_ENCODED_BYTES)}`]) {
    assert.throws(() => decodeSubagentCapabilityCeilingV1(value));
  }
});
