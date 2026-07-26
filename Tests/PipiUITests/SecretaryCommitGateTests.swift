import XCTest

final class SecretaryCommitGateTests: XCTestCase {
    func testCommitsExactManifestAndLeavesUnrelatedDirty() throws {
        try runNodeScenario("exact")
    }

    func testRejectsPreStagedChangesWithoutChangingIndex() throws {
        try runNodeScenario("pre-staged")
    }

    func testRejectsUnsafeManifestPaths() throws {
        try runNodeScenario("invalid-paths")
    }

    func testRejectsRoleVerifyCloseoutAndDispositionFailures() throws {
        try runNodeScenario("gates")
    }

    func testFailedCommitRollsBackOnlyHelperIndexChanges() throws {
        try runNodeScenario("commit-failure")
    }

    func testAlreadyCleanReturnsExistingHeadWithoutEmptyCommit() throws {
        try runNodeScenario("already-clean")
    }

    private func runNodeScenario(_ scenario: String) throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let module = root.appendingPathComponent(
            "Sources/PipiUI/PiExt/subagent/secretary-commit.ts"
        )

        let node = Process()
        node.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        node.arguments = [
            "node",
            "--experimental-strip-types",
            "--input-type=module",
            "--eval",
            #"""
            import assert from "node:assert/strict";
            import fs from "node:fs";
            import os from "node:os";
            import path from "node:path";
            import { execFileSync } from "node:child_process";

            const { runSecretaryCommit } = await import(process.env.COMMIT_MODULE);
            const scenario = process.env.COMMIT_SCENARIO;
            const git = (repo, ...args) =>
                execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
            const write = (repo, file, value) => {
                const target = path.join(repo, file);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, value);
            };
            const makeRepo = () => {
                const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pipiui-secretary-commit-"));
                git(repo, "init", "-b", "main");
                git(repo, "config", "user.email", "pipiui-test@example.com");
                git(repo, "config", "user.name", "PipiUI Test");
                write(repo, "accepted.txt", "accepted-old\n");
                write(repo, "unrelated.txt", "unrelated-old\n");
                git(repo, "add", "--", "accepted.txt", "unrelated.txt");
                git(repo, "commit", "-m", "initial");
                return repo;
            };
            const baseInput = {
                closeout: "pass",
                integrationVerify: "pass",
                commitMessage: "feat: commit accepted closeout",
                paths: ["accepted.txt"],
                allRelevantItemsClassified: true,
                dispositions: [{ item: "worker-1", disposition: "cleaned" }],
            };
            const context = (repo, role = "closeout-secretary") => ({
                processRole: role,
                mainCwd: repo,
            });
            const staged = repo => git(repo, "diff", "--cached", "--name-only", "--");
            const status = repo => git(repo, "status", "--short");

            if (scenario === "exact") {
                const repo = makeRepo();
                try {
                    write(repo, "accepted.txt", "accepted-new\n");
                    write(repo, "unrelated.txt", "unrelated-new\n");
                    const result = runSecretaryCommit(baseInput, context(repo));
                    assert.match(result.commit, /^created:[0-9a-f]+$/);
                    assert.deepEqual(result.committedPaths, ["accepted.txt"]);
                    assert.deepEqual(result.remainingDirtyPaths, ["unrelated.txt"]);
                    assert.equal(git(repo, "show", "HEAD:accepted.txt"), "accepted-new");
                    assert.equal(git(repo, "show", "HEAD:unrelated.txt"), "unrelated-old");
                    assert.match(status(repo), /unrelated\.txt/);
                    assert.doesNotMatch(status(repo), /accepted\.txt/);
                } finally {
                    fs.rmSync(repo, { recursive: true, force: true });
                }
            } else if (scenario === "pre-staged") {
                const repo = makeRepo();
                try {
                    write(repo, "accepted.txt", "accepted-new\n");
                    write(repo, "unrelated.txt", "unrelated-new\n");
                    git(repo, "add", "--", "unrelated.txt");
                    const result = runSecretaryCommit(baseInput, context(repo));
                    assert.equal(result.commit, "blocked:pre-staged-changes");
                    assert.equal(staged(repo), "unrelated.txt");
                } finally {
                    fs.rmSync(repo, { recursive: true, force: true });
                }
                const intentRepo = makeRepo();
                try {
                    write(intentRepo, "accepted.txt", "accepted-new\n");
                    write(intentRepo, "intent.txt", "");
                    git(intentRepo, "add", "-N", "--", "intent.txt");
                    const result = runSecretaryCommit(baseInput, context(intentRepo));
                    assert.equal(result.commit, "blocked:pre-staged-changes");
                    assert.match(git(intentRepo, "ls-files", "--stage", "--", "intent.txt"), /intent\.txt/);
                } finally {
                    fs.rmSync(intentRepo, { recursive: true, force: true });
                }
            } else if (scenario === "invalid-paths") {
                for (const invalid of [
                    "/tmp/absolute.txt",
                    "../traversal.txt",
                    ".git/config",
                    "nested/.git/config",
                    ".pi/boss/ledger.md",
                    "nested/.pi/state",
                    "C:\\absolute.txt",
                ]) {
                    const repo = makeRepo();
                    try {
                        write(repo, "accepted.txt", "accepted-new\n");
                        const result = runSecretaryCommit(
                            { ...baseInput, paths: [invalid] },
                            context(repo),
                        );
                        assert.equal(result.commit, "blocked:invalid-manifest-path", invalid);
                        assert.equal(staged(repo), "", invalid);
                        assert.equal(git(repo, "show", "HEAD:accepted.txt"), "accepted-old");
                    } finally {
                        fs.rmSync(repo, { recursive: true, force: true });
                    }
                }
            } else if (scenario === "gates") {
                const variants = [
                    [baseInput, "worker", "wrong-runtime-role"],
                    [{ ...baseInput, closeout: "needs-action" }, "closeout-secretary", "closeout-not-pass"],
                    [{ ...baseInput, integrationVerify: "fail" }, "closeout-secretary", "integration-verify-not-pass"],
                    [{ ...baseInput, allRelevantItemsClassified: false }, "closeout-secretary", "dispositions-not-final"],
                    [{ ...baseInput, dispositions: [{ item: "worker-1", disposition: "unclassified" }] }, "closeout-secretary", "dispositions-not-final"],
                    [{ ...baseInput, dispositions: [{ item: "worker-1", disposition: "needs-fixer" }] }, "closeout-secretary", "dispositions-not-final"],
                    [{ ...baseInput, dispositions: [{ item: "worker-1", disposition: "needs-user" }] }, "closeout-secretary", "dispositions-not-final"],
                ];
                for (const [input, role, reason] of variants) {
                    const repo = makeRepo();
                    try {
                        write(repo, "accepted.txt", "accepted-new\n");
                        const result = runSecretaryCommit(input, context(repo, role));
                        assert.equal(result.commit, `blocked:${reason}`);
                        assert.equal(staged(repo), "");
                    } finally {
                        fs.rmSync(repo, { recursive: true, force: true });
                    }
                }
            } else if (scenario === "commit-failure") {
                const repo = makeRepo();
                try {
                    write(repo, "accepted.txt", "accepted-new\n");
                    const hook = path.join(repo, ".git", "hooks", "pre-commit");
                    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n");
                    fs.chmodSync(hook, 0o755);
                    const before = git(repo, "rev-parse", "HEAD");
                    const result = runSecretaryCommit(baseInput, context(repo));
                    assert.equal(result.commit, "blocked:commit-failed");
                    assert.equal(staged(repo), "");
                    assert.equal(git(repo, "rev-parse", "HEAD"), before);
                    assert.equal(git(repo, "show", "HEAD:accepted.txt"), "accepted-old");
                    assert.equal(fs.readFileSync(path.join(repo, "accepted.txt"), "utf8"), "accepted-new\n");
                    assert.match(status(repo), /accepted\.txt/);
                } finally {
                    fs.rmSync(repo, { recursive: true, force: true });
                }
            } else if (scenario === "already-clean") {
                const repo = makeRepo();
                try {
                    const before = git(repo, "rev-parse", "HEAD");
                    const count = git(repo, "rev-list", "--count", "HEAD");
                    const result = runSecretaryCommit(
                        { ...baseInput, paths: [] },
                        context(repo),
                    );
                    assert.equal(result.commit, `already-clean:${before}`);
                    assert.deepEqual(result.committedPaths, []);
                    assert.deepEqual(result.remainingDirtyPaths, []);
                    assert.equal(git(repo, "rev-list", "--count", "HEAD"), count);
                } finally {
                    fs.rmSync(repo, { recursive: true, force: true });
                }
            } else {
                throw new Error(`unknown scenario: ${scenario}`);
            }
            """#,
        ]
        var environment = ProcessInfo.processInfo.environment
        environment["COMMIT_MODULE"] = module.absoluteString
        environment["COMMIT_SCENARIO"] = scenario
        node.environment = environment
        let stderr = Pipe()
        node.standardError = stderr
        try node.run()
        node.waitUntilExit()
        let errorText = String(
            data: stderr.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        XCTAssertEqual(node.terminationStatus, 0, errorText)
    }
}
