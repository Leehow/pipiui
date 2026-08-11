import XCTest
@testable import PipiUI

final class MemoryBrokerPackageTests: XCTestCase {
    private let fileManager = FileManager.default
    private var root: URL!

    override func setUpWithError() throws {
        root = fileManager.temporaryDirectory.appendingPathComponent("pipiui-memory-package-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { [root, fileManager] in
            if let root { try? fileManager.removeItem(at: root) }
        }
    }

    private var bundled: URL { root.appendingPathComponent("bundled/packages", isDirectory: true) }
    private var install: URL { root.appendingPathComponent("installed", isDirectory: true) }
    private var settings: URL { root.appendingPathComponent("agent/settings.json") }

    private func write(_ value: String, to url: URL) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try value.write(to: url, atomically: true, encoding: .utf8)
    }

    private func makeBundledPackages() throws {
        try write(#"{"name":"pipiui-memory-broker","version":"0.1.0"}"#, to: bundled.appendingPathComponent("memory-broker/package.json"))
        try write("export default function () {}", to: bundled.appendingPathComponent("memory-broker/extensions/memory-broker.ts"))
        try write(#"{"name":"pipiui-memory-broker-contract","version":"0.1.0"}"#, to: bundled.appendingPathComponent("memory-broker/vendor/pipiui-memory-broker-contract/package.json"))
        try write("export {}", to: bundled.appendingPathComponent("memory-broker/vendor/pipiui-memory-broker-contract/contract/index.ts"))
        try write("<main>Memory Center</main>", to: bundled.appendingPathComponent("memory-broker/ui/index.html"))
        try write("export {}", to: bundled.appendingPathComponent("memory-broker/ui/memory-center.js"))
        try write("{\"version\":1,\"cases\":[]}", to: bundled.appendingPathComponent("memory-broker/eval/corpus.json"))
        try write("export {}", to: bundled.appendingPathComponent("memory-broker/scripts/run-eval.mjs"))
    }

    private func installDependencies(at prefix: URL) throws {
        try write(#"{"name":"pi-hermes-memory","version":"0.9.4"}"#, to: prefix.appendingPathComponent("node_modules/pi-hermes-memory/package.json"))
        try write("export default function () {}", to: prefix.appendingPathComponent("node_modules/pi-hermes-memory/src/index.ts"))
        try write(#"{"name":"pipiui-memory-broker-contract","version":"0.1.0"}"#, to: prefix.appendingPathComponent("node_modules/pipiui-memory-broker-contract/package.json"))
        try write("export {}", to: prefix.appendingPathComponent("node_modules/pipiui-memory-broker-contract/contract/index.ts"))
    }

    func testStagesBundledPackageIntoPrivateResolvedPathWithPinnedHermes() throws {
        try makeBundledPackages()
        var commands = 0
        let value = try MemoryBrokerPackage.ensureInstalled(
            bundledPackagesRoot: bundled,
            in: install,
            commandRunner: { _, arguments in
                commands += 1
                XCTAssertEqual(arguments[0], "install")
                XCTAssertEqual(arguments[1], "--prefix")
                XCTAssertEqual(arguments[3], "--omit=dev")
                try self.installDependencies(at: URL(fileURLWithPath: arguments[2]))
                return .init(status: 0, stdout: "", stderr: "")
            },
            settingsURL: settings
        )
        XCTAssertEqual(commands, 1)
        XCTAssertTrue(value.entrypoint.hasPrefix(install.path))
        XCTAssertFalse(value.entrypoint.hasPrefix(bundled.path), "spawn must never mount the bundled/development source")
        XCTAssertTrue(fileManager.fileExists(atPath: value.hermesEntrypoint))
        XCTAssertTrue(fileManager.fileExists(atPath: URL(fileURLWithPath: value.root).appendingPathComponent("memory-broker/ui/index.html").path))
        XCTAssertTrue(fileManager.fileExists(atPath: URL(fileURLWithPath: value.root).appendingPathComponent("memory-broker/eval/corpus.json").path))
        XCTAssertEqual(try MemoryBrokerPackage.resolveInstalled(in: install), value)
    }

    func testGlobalMemoryPackageConflictFailsClosedBeforeInstall() throws {
        try makeBundledPackages()
        try write(#"{"packages":["npm:pipiui-memory-broker@0.1.0"]}"#, to: settings)
        XCTAssertThrowsError(
            try MemoryBrokerPackage.ensureInstalled(
                bundledPackagesRoot: bundled,
                in: install,
                commandRunner: { _, _ in
                    XCTFail("conflict must not invoke npm")
                    return .init(status: 0, stdout: "", stderr: "")
                },
                settingsURL: settings
            )
        ) { error in
            XCTAssertEqual(error as? MemoryBrokerPackage.PackageError, .globalPackageConflict(source: "npm:pipiui-memory-broker@0.1.0"))
        }
    }

    func testFailedUpdateKeepsPriorWorkingPackage() throws {
        try makeBundledPackages()
        let first = try MemoryBrokerPackage.ensureInstalled(
            bundledPackagesRoot: bundled,
            in: install,
            commandRunner: { _, arguments in
                try self.installDependencies(at: URL(fileURLWithPath: arguments[2]))
                return .init(status: 0, stdout: "", stderr: "")
            },
            settingsURL: settings
        )
        try write("// changed bundled source", to: bundled.appendingPathComponent("memory-broker/src/new.ts"))
        XCTAssertThrowsError(
            try MemoryBrokerPackage.ensureInstalled(
                bundledPackagesRoot: bundled,
                in: install,
                commandRunner: { _, _ in .init(status: 17, stdout: "", stderr: "offline") },
                settingsURL: settings
            )
        )
        XCTAssertEqual(try MemoryBrokerPackage.resolveInstalled(in: install), first)
        XCTAssertTrue(fileManager.fileExists(atPath: first.entrypoint))
    }

    func testSettingsStatusReadsPackageNativeFTSState() throws {
        let state = root.appendingPathComponent("state", isDirectory: true)
        try write(#"{"version":1,"ready":true,"detail":"Hermes 0.9.4 FTS backend is ready."}"#, to: MemoryBrokerPackage.stateURL(in: state))
        let status = try XCTUnwrap(MemoryBrokerRuntime.readStatus(in: state))
        XCTAssertEqual(status.state, .ready)
        XCTAssertTrue(status.enabled)
        XCTAssertTrue(status.installed)
        XCTAssertTrue(status.resolved)
        XCTAssertEqual(status.nativeFTS, true)
        let settings = try String(contentsOf: URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/PipiUI/Views/SettingsSheet.swift"))
        XCTAssertTrue(settings.contains("打开 Memory Center"))
        XCTAssertTrue(settings.contains("pipiui-memory-broker"))
    }

    func testSpawnResolutionOnlyReadsInstalledPackageAndDegradesWithoutBlocking() throws {
        try makeBundledPackages()
        let result = MemoryBrokerRuntime.resolveForMainSession(
            enabled: true,
            installRoot: install
        )
        XCTAssertNil(result.entrypoint)
        XCTAssertEqual(result.status.state, .degraded)
        XCTAssertTrue(result.status.enabled)
        XCTAssertNotNil(result.status.lastError)
        XCTAssertFalse(fileManager.fileExists(atPath: MemoryBrokerPackage.installationRoot(in: install).path),
            "spawn-time resolution must not stage or run npm synchronously")
    }

    func testConcurrentInstallsSingleFlightAndSecondCallerUsesFingerprint() throws {
        try makeBundledPackages()
        let firstRunnerStarted = DispatchSemaphore(value: 0)
        let group = DispatchGroup()
        let lock = NSLock()
        var commandCount = 0
        var entrypoints: [String] = []
        var failures: [String] = []

        let installOnce = {
            do {
                let value = try MemoryBrokerPackage.ensureInstalled(
                    bundledPackagesRoot: self.bundled,
                    in: self.install,
                    commandRunner: { _, arguments in
                        lock.lock()
                        commandCount += 1
                        let invocation = commandCount
                        lock.unlock()
                        if invocation == 1 {
                            firstRunnerStarted.signal()
                            Thread.sleep(forTimeInterval: 0.15)
                        }
                        try self.installDependencies(at: URL(fileURLWithPath: arguments[2]))
                        return .init(status: 0, stdout: "", stderr: "")
                    },
                    settingsURL: self.settings
                )
                lock.lock()
                entrypoints.append(value.entrypoint)
                lock.unlock()
            } catch {
                lock.lock()
                failures.append(error.localizedDescription)
                lock.unlock()
            }
        }

        group.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            installOnce()
            group.leave()
        }
        XCTAssertEqual(firstRunnerStarted.wait(timeout: .now() + 2), .success)
        group.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            installOnce()
            group.leave()
        }
        XCTAssertEqual(group.wait(timeout: .now() + 5), .success)

        lock.lock()
        let observedCommands = commandCount
        let observedEntrypoints = entrypoints
        let observedFailures = failures
        lock.unlock()
        XCTAssertEqual(observedFailures, [])
        XCTAssertEqual(observedCommands, 1, "the waiting caller must re-check the completed fingerprint")
        XCTAssertEqual(Set(observedEntrypoints).count, 1)
        let resolved = MemoryBrokerRuntime.resolveForMainSession(enabled: true, installRoot: install)
        XCTAssertEqual(resolved.entrypoint, observedEntrypoints.first)
        XCTAssertEqual(resolved.status.state, .ready, "the waiting caller must not produce a false degraded state")
    }

    func testDetachedInstallerRunsOffMainAndReturnsToMainActor() throws {
        let completed = expectation(description: "installer completion")
        let lock = NSLock()
        var workerWasOffMain = false
        let task = MemoryBrokerBackgroundInstall.start(
            operation: {
                lock.lock()
                workerWasOffMain = !Thread.isMainThread
                lock.unlock()
                return .init(entrypoint: "/private/managed/extensions/memory-broker.ts", status: .init(
                    state: .ready,
                    enabled: true,
                    installed: true,
                    resolved: true
                ))
            },
            completion: { result in
                XCTAssertTrue(Thread.isMainThread)
                XCTAssertEqual(result.status.state, .ready)
                completed.fulfill()
            }
        )
        wait(for: [completed], timeout: 2)
        lock.lock()
        let observedWorkerWasOffMain = workerWasOffMain
        lock.unlock()
        XCTAssertTrue(observedWorkerWasOffMain)
        withExtendedLifetime(task) {}

        let appStore = try String(contentsOf: URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/PipiUI/AppStore.swift"))
        XCTAssertTrue(appStore.contains("memoryBrokerStatus = .installing"))
        XCTAssertTrue(appStore.contains("MemoryBrokerBackgroundInstall.start"))
    }

    func testSpawnAssemblyMountsOnlyFormalBrokerAndStripsStaleMemoryEnvironment() {
        let paths = PipiSpawnAssembly.Paths(memoryBroker: "/private/pipiui/memory-broker.ts")
        let output = PipiSpawnAssembly.assemble(.init(
            sessionPath: nil,
            bridgePort: 1,
            bridgeRoutingKey: "bridge",
            computerRoutingKey: "computer",
            grantSessionKey: "session",
            mainCWD: "/project",
            paths: paths,
            features: .init(),
            computerDescriptor: nil,
            mainModelId: nil,
            excludeToolsArgs: [],
            memoryBrokerStateDirectory: "/state",
            memoryBrokerImportFile: "/import.jsonl",
            memoryBrokerImportReceiptFile: "/receipt.json"
        ))
        XCTAssertEqual(output.args, ["-e", "/private/pipiui/memory-broker.ts"])
        XCTAssertEqual(output.extraEnv["PIPIUI_MEMORY_BROKER_MODE"], "main")
        XCTAssertEqual(output.extraEnv["PIPIUI_MEMORY_PROJECT_ROOT"], "/project")
        XCTAssertNil(output.extraEnv["PIPIUI_MEMORY_BROKER_CAPABILITY"])
        let sanitized = PipiSpawnEnvironmentPolicy.sanitized([
            "PIPIUI_MEMORY_BROKER_URL": "http://stale",
            "PIPIUI_MEMORY_BROKER_TOKEN": "stale",
            "PIPIUI_HERMES_EXT": "stale",
            "SAFE": "kept",
        ])
        XCTAssertNil(sanitized["PIPIUI_MEMORY_BROKER_URL"])
        XCTAssertNil(sanitized["PIPIUI_MEMORY_BROKER_TOKEN"])
        XCTAssertNil(sanitized["PIPIUI_HERMES_EXT"])
        XCTAssertEqual(sanitized["SAFE"], "kept")
    }
}
