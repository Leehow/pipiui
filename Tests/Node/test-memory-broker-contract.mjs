import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  assertMemoryBrokerContractParity,
  compareMemoryBrokerContractTrees,
  syncMemoryBrokerContract,
} from "../../scripts/sync-memory-broker-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contractRoot = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/packages/memory-broker-contract/contract",
);
const vendoredContractRoot = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/packages/memory-broker/vendor/pipiui-memory-broker-contract/contract",
);
const contract = await import(pathToFileURL(join(contractRoot, "index.ts")).href);

function mainContext(overrides = {}) {
  return contract.createActorContext({
    projectRoot: "/repo/./project",
    chatSessionID: "chat-a",
    bridgeRoutingKey: "routing-a",
    agentID: "main-a",
    runID: "run-main",
    role: "main",
    ...overrides,
  });
}

function workerCandidate(overrides = {}) {
  return {
    kind: "experience",
    claimKind: "task",
    claim: "  Build   narrow broker client  ",
    scope: "session",
    provenance: "brief",
    outcome: "success",
    evidence: [{ summary: "final report verified the focused path" }],
    sourceRuns: ["source-run"],
    ...overrides,
  };
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

test("contract is host-neutral and canonicalizes only the main project root", async () => {
  assert.equal(contract.canonicalMainProjectRoot("/repo/./project"), "/repo/project");
  assert.equal(contract.canonicalProjectRoot("/repo/project/../project"), "/repo/project");
  throwsCode(() => contract.canonicalMainProjectRoot("/repo/.pi/worktrees/worker-a"), "worktree-root");
  throwsCode(() => mainContext({ worktreeCWD: "/repo/.pi/worktrees/worker-a" }), "worktree-root");

  const source = await readFile(join(contractRoot, "index.ts"), "utf8");
  const packageManifest = await readFile(join(contractRoot, "../package.json"), "utf8");
  assert.doesNotMatch(source, /@earendil-works|PipiUI\/(?:Views|Computer)/);
  assert.doesNotMatch(packageManifest, /"pi"\s*:/, "contract package must not install an extension entrypoint yet");
});

test("vendored contract is byte-for-byte synchronized and the local sync repairs every drift class", async () => {
  const productionParity = await compareMemoryBrokerContractTrees(contractRoot, vendoredContractRoot);
  assert.deepEqual(productionParity.canonicalPaths, productionParity.vendoredPaths);
  assert.deepEqual(productionParity.missing, []);
  assert.deepEqual(productionParity.extra, []);
  assert.deepEqual(productionParity.changed, []);
  await assertMemoryBrokerContractParity(contractRoot, vendoredContractRoot);

  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-contract-sync-"));
  try {
    const stagedVendor = join(directory, "contract");
    await cp(vendoredContractRoot, stagedVendor, { recursive: true });
    await Promise.all([
      rm(join(stagedVendor, "types.ts")),
      writeFile(join(stagedVendor, "index.ts"), "content drift\n", "utf8"),
      writeFile(join(stagedVendor, "unexpected.ts"), "extra file\n", "utf8"),
    ]);
    const drift = await compareMemoryBrokerContractTrees(contractRoot, stagedVendor);
    assert.deepEqual(drift.missing, ["types.ts"]);
    assert.deepEqual(drift.extra, ["unexpected.ts"]);
    assert.deepEqual(drift.changed, ["index.ts"]);
    await assert.rejects(
      assertMemoryBrokerContractParity(contractRoot, stagedVendor),
      /Memory Broker vendored contract drift/,
    );

    await syncMemoryBrokerContract(contractRoot, stagedVendor);
    const repaired = await compareMemoryBrokerContractTrees(contractRoot, stagedVendor);
    assert.deepEqual(repaired.canonicalPaths, repaired.vendoredPaths);
    assert.deepEqual(repaired.missing, []);
    assert.deepEqual(repaired.extra, []);
    assert.deepEqual(repaired.changed, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("main has the complete ACL while worker/operator remain candidate-only", () => {
  assert.equal(contract.roleAllows("durableWrite", "main"), true);
  assert.equal(contract.roleAllows("promote", "main"), true);
  assert.equal(contract.roleAllows("query", "worker"), true);
  assert.equal(contract.roleAllows("submitExperience", "operator"), true);
  assert.equal(contract.roleAllows("durableWrite", "worker"), false);
  assert.equal(contract.roleAllows("promote", "operator"), false);

  const worker = mainContext({ role: "worker", agentID: "worker-a", runID: "run-a" });
  throwsCode(() => contract.authorizeCapability("durableWrite", worker), "denied");
  const ungrantedOperator = mainContext({ role: "operator", agentID: "operator-a", runID: "run-a" });
  throwsCode(() => contract.authorizeCapability("query", ungrantedOperator), "computer-memory-grant-required");
  const grantedOperator = mainContext({
    role: "operator",
    agentID: "operator-a",
    runID: "run-a",
    hostIssuedDesktopGrant: "user-requested",
  });
  assert.doesNotThrow(() => contract.authorizeCapability("submitExperience", grantedOperator));
  throwsCode(() => contract.authorizeCapability("durableWrite", grantedOperator), "denied");
});

test("host dispatch registry fences a reused agent ID by capability and run ID", () => {
  const registry = new contract.MemoryWorkerGrantRegistry({
    projectRoot: "/repo/project",
    chatSessionID: "chat-a",
    bridgeRoutingKey: "routing-a",
  });
  const oldCapability = "a".repeat(64);
  const newCapability = "b".repeat(64);
  registry.registerHostDispatch({ agentID: "reused", runID: "run-old", capability: oldCapability });
  assert.equal(registry.validate(oldCapability, "reused", "run-old").runID, "run-old");
  registry.registerHostDispatch({ agentID: "reused", runID: "run-new", capability: newCapability });
  throwsCode(() => registry.validate(oldCapability, "reused", "run-old"), "unauthorized-worker");
  throwsCode(() => registry.validate(newCapability, "reused", "run-old"), "stale-run");
  assert.equal(registry.validate(newCapability, "reused", "run-new").runID, "run-new");
});

test("experience normalization, hash dedupe, source runs, and quarantine match Swift vectors", () => {
  const quarantine = new contract.MemoryCandidateQuarantine();
  const first = quarantine.accept(
    mainContext({ agentID: "same-agent", runID: "run-one" }),
    workerCandidate(),
    false,
    1_000,
  );
  const second = quarantine.accept(
    mainContext({ agentID: "same-agent", runID: "run-two" }),
    workerCandidate({ claim: "build narrow broker client" }),
    false,
    1_001,
  );
  assert.equal(first.candidate.claim, "build narrow broker client");
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.key, second.key);
  assert.deepEqual(second.candidate.sourceRuns, ["run-one", "run-two", "source-run"]);
  assert.equal(
    contract.experienceDedupeKey("/repo/./project", workerCandidate()),
    contract.experienceDedupeKey("/repo/project", workerCandidate({ claim: "build narrow broker client" })),
  );

  const briefPromotion = new contract.MemoryCandidateQuarantine().accept(mainContext(), workerCandidate(), true);
  assert.equal(briefPromotion.durable, false, "brief is permanently candidate-only");
  const hypothesisPromotion = new contract.MemoryCandidateQuarantine().accept(
    mainContext({ runID: "run-hypothesis" }),
    workerCandidate({ provenance: "hypothesis" }),
    true,
  );
  assert.equal(hypothesisPromotion.durable, false, "hypothesis is permanently candidate-only");
  const durablePromotion = new contract.MemoryCandidateQuarantine().accept(
    mainContext({ runID: "run-outcome" }),
    workerCandidate({ provenance: "outcome" }),
    true,
  );
  assert.equal(durablePromotion.durable, true);

  throwsCode(() => contract.normalizeExperienceCandidate(workerCandidate({ ttlSeconds: 29 })), "invalid-request");
  const shortLived = new contract.MemoryCandidateQuarantine().accept(
    mainContext({ runID: "run-ttl" }),
    workerCandidate({ ttlSeconds: 30 }),
    false,
    10_000,
  );
  assert.equal(shortLived.expiresAt, 40_000);
});

test("app recall is normalized, bounded, sensitive-target denied, and never grants desktop access", () => {
  const query = contract.normalizeQuery({
    text: " focus editor ",
    budget: 99_999,
    scope: "project",
    bundleID: "COM.Example.Editor",
    appName: " Example   Editor ",
  });
  assert.deepEqual(query, {
    text: "focus editor",
    budget: contract.MEMORY_LIMITS.maximumApplicationQueryBudget,
    scope: "project",
    bundleID: "com.example.editor",
    appName: "Example Editor",
  });
  const grantedOperator = mainContext({
    role: "operator",
    agentID: "operator-a",
    runID: "run-a",
    hostIssuedDesktopGrant: "ui-verify",
  });
  assert.doesNotThrow(() => contract.authorizeQuery(grantedOperator, query));
  throwsCode(() => contract.authorizeQuery(mainContext(), query), "computer-memory-grant-required");
  throwsCode(() => contract.authorizeQuery(grantedOperator, contract.normalizeQuery({
    text: "password recipe",
    budget: 10,
    scope: "project",
    bundleID: "com.1password.1password",
    appName: "1Password",
  })), "invalid-request");
  throwsCode(() => contract.normalizeMemoryBrokerRequest({
    version: 1,
    operation: "memory.query",
    query,
    desktopGrant: "user-requested",
  }), "invalid-request");
  const operatorComputerRequest = contract.normalizeMemoryBrokerRequest({
    version: 1,
    operation: "experience.submit",
    candidate: contract.computerCandidateFromDraft({
      claimKind: "computer_preference",
      bundleID: "com.example.editor",
      appName: "Example Editor",
      actionKinds: ["openApplication"],
      durationBucket: "short",
      outcome: "success",
    }),
  });
  assert.equal(operatorComputerRequest.candidate?.kind, "computer");
  assert.equal(operatorComputerRequest.candidate?.provenance, "hypothesis");
});

test("Computer sanitizer admits only metadata and rejects forbidden fields, text, sensitive apps, and invalid failure TTL", () => {
  const forbidden = [
    "screenshot", "base64", "accessibility", "AX", "element_token", "typedText", "clipboard",
    "credentials", "OTP", "processID", "windowID", "coordinates", "capability", "rawCommand", "urlQuery",
  ];
  for (const field of forbidden) {
    throwsCode(() => contract.sanitizeComputerMemoryDraft({
      claimKind: "computer_failure",
      bundleID: "com.example.editor",
      appName: "Example Editor",
      errorCode: "computer_outcome_unknown",
      actionKinds: ["type", "scroll"],
      outcome: "failure",
      [field]: "must-not-cross-memory-boundary",
    }), "invalid-request");
  }

  const candidate = contract.computerCandidateFromDraft({
    claimKind: "computer_failure",
    bundleID: "COM.Example.Editor",
    appName: "Example Editor",
    errorCode: "computer_outcome_unknown",
    actionKinds: ["type", "scroll"],
    focusDrift: true,
    outcome: "failure",
  });
  assert.ok(candidate);
  assert.equal(candidate.ttlSeconds, contract.MEMORY_LIMITS.computerFailureTTLSeconds);
  assert.equal(candidate.provenance, "brief");
  const success = contract.computerCandidateFromDraft({
    claimKind: "computer_recipe",
    bundleID: "com.example.editor",
    appName: "Example Editor",
    actionKinds: ["click", "type"],
    durationBucket: "medium",
    outcome: "success",
  });
  assert.equal(success?.ttlSeconds, contract.MEMORY_LIMITS.computerSuccessTTLSeconds);
  assert.equal(success?.provenance, "hypothesis");
  assert.equal(success?.evidence[0]?.computer?.durationBucket, "medium");
  const encoded = JSON.stringify(candidate).toLowerCase();
  for (const field of forbidden) assert.equal(encoded.includes(field.toLowerCase()), false, `leaked ${field}`);
  assert.doesNotThrow(() => contract.normalizeExperienceCandidate(candidate));
  throwsCode(() => contract.normalizeExperienceCandidate({
    ...candidate,
    evidence: [{ ...candidate.evidence[0], computer: { ...candidate.evidence[0].computer, bundleID: "COM.Example.Editor" } }],
  }), "invalid-request");
  throwsCode(() => contract.normalizeExperienceCandidate({ ...candidate, screenshot: "base64" }), "invalid-request");
  throwsCode(() => contract.normalizeExperienceCandidate({ ...candidate, ttlSeconds: 30 }), "invalid-request");
  assert.equal(contract.computerCandidateFromDraft({
    claimKind: "computer_preference",
    bundleID: "com.1password.1password",
    appName: "1Password",
    actionKinds: ["openApplication"],
    outcome: "success",
  }), undefined);
});
