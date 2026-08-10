import CryptoKit
import Foundation

/// Thin PipiUI host state for the formal `pipiui-memory-broker` Pi package.
/// Memory ACLs, queries, dedupe, Hermes access, and child capability issuance
/// live exclusively in the TypeScript package; this file only manages its
/// app-owned copy, launch configuration, and observable state.
enum MemoryBrokerSettings {
    static let enabledKey = "pipiui.memoryBroker.enabled"

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? false
    }

    static func setEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: enabledKey)
    }
}

enum MemoryBrokerPackage {
    static let packageName = "pipiui-memory-broker"
    static let packageVersion = "0.1.0"
    static let contractName = "pipiui-memory-broker-contract"
    static let contractVersion = "0.1.0"
    static let hermesPackageName = "pi-hermes-memory"
    static let hermesVersion = "0.9.4"
    static let entrypointRelativePath = "extensions/memory-broker.ts"
    /// The broker carries its host-neutral contract as a vendored package so a
    /// copied broker never relies on a sibling source checkout at runtime.
    static let contractVendorRelativePath = "vendor/pipiui-memory-broker-contract"

    static var defaultInstallRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/managed-pi-packages", isDirectory: true)
    }

    static var defaultStateDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/memory-broker-state", isDirectory: true)
    }

    struct Installation: Equatable, Sendable {
        let root: String
        let entrypoint: String
        let hermesEntrypoint: String
    }

    enum PackageError: Error, Equatable, LocalizedError, Sendable {
        case bundledPackageMissing(String)
        case invalidManifest(String)
        case globalPackageConflict(source: String)
        case npmUnavailable
        case npmInstallFailed(Int32, String)
        case installationInvalid(String)
        case replacementFailed(String)
        case installLockFailed(String)

        var errorDescription: String? {
            switch self {
            case .bundledPackageMissing(let path):
                "PipiUI Memory Broker bundled package is missing: \(path)"
            case .invalidManifest(let path):
                "PipiUI Memory Broker bundled package manifest is invalid: \(path)"
            case .globalPackageConflict(let source):
                "A globally registered memory package conflicts with PipiUI Memory Broker: \(source)"
            case .npmUnavailable:
                "npm is unavailable; PipiUI Memory Broker remains optional and memory is degraded."
            case .npmInstallFailed(let status, let detail):
                "Could not install pi-hermes-memory@\(hermesVersion) (exit \(status)): \(detail)"
            case .installationInvalid(let detail):
                "PipiUI Memory Broker installation is incomplete: \(detail)"
            case .replacementFailed(let detail):
                "PipiUI Memory Broker update kept the previous working package: \(detail)"
            case .installLockFailed(let detail):
                "PipiUI Memory Broker could not acquire its install lock: \(detail)"
            }
        }
    }

    typealias CommandRunner = (URL, [String]) throws -> ManagedNpmPackage.CommandResult

    static func installationRoot(
        in installRoot: URL = defaultInstallRoot
    ) -> URL {
        installRoot.appendingPathComponent("memory-broker-\(packageVersion)", isDirectory: true)
    }

    static func resolveInstalled(
        in installRoot: URL = defaultInstallRoot,
        fileManager: FileManager = .default
    ) throws -> Installation {
        try resolveInstallation(at: installationRoot(in: installRoot), fileManager: fileManager)
    }

    /// Copy both bundled local packages into a private staged directory, install
    /// the one fixed native dependency there, validate, then atomically replace
    /// the active package. The old working tree is never removed until the new
    /// tree has passed validation.
    static func ensureInstalled(
        bundledPackagesRoot: URL,
        in installRoot: URL = defaultInstallRoot,
        npmExecutable: URL? = nil,
        commandRunner: CommandRunner? = nil,
        settingsURL: URL = ManagedNpmPackage.defaultSettingsURL,
        fileManager: FileManager = .default
    ) throws -> Installation {
        let brokerSource = bundledPackagesRoot.appendingPathComponent("memory-broker", isDirectory: true)
        try validateBundledSource(brokerSource, name: packageName, version: packageVersion, fileManager: fileManager)
        try validateBundledSource(
            brokerSource.appendingPathComponent(contractVendorRelativePath, isDirectory: true),
            name: contractName,
            version: contractVersion,
            fileManager: fileManager
        )
        do {
            try fileManager.createDirectory(at: installRoot, withIntermediateDirectories: true)
        } catch {
            throw PackageError.replacementFailed(error.localizedDescription)
        }
        let lease: ManagedPackageInstallLease.Lease
        do {
            lease = try ManagedPackageInstallLease.acquire(
                at: installRoot,
                name: "memory-broker-\(packageVersion)"
            )
        } catch {
            throw PackageError.installLockFailed(error.localizedDescription)
        }
        defer { lease.release() }

        // Re-check after waiting for the cross-process lease: another PipiUI
        // process may have completed the exact staged install while we waited.
        try ensureNoGlobalConflict(settingsURL: settingsURL, fileManager: fileManager)
        let bundledFingerprint = sourceFingerprint([brokerSource], fileManager: fileManager)
        let currentRoot = installationRoot(in: installRoot)
        if let installation = try? resolveInstalled(in: installRoot, fileManager: fileManager),
           (try? String(contentsOf: currentRoot.appendingPathComponent(".pipiui-bundle-fingerprint"), encoding: .utf8)) == bundledFingerprint {
            return installation
        }

        let stage = installRoot.appendingPathComponent(".memory-broker-stage-\(UUID().uuidString)", isDirectory: true)
        let target = installationRoot(in: installRoot)
        let backup = installRoot.appendingPathComponent(".memory-broker-previous-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: stage) }
        do {
            try fileManager.createDirectory(at: stage, withIntermediateDirectories: false)
            try fileManager.copyItem(at: brokerSource, to: stage.appendingPathComponent("memory-broker", isDirectory: true))
            try bundledFingerprint.write(
                to: stage.appendingPathComponent(".pipiui-bundle-fingerprint"),
                atomically: true,
                encoding: .utf8
            )
            let npm = try npmExecutable ?? findNpm(fileManager: fileManager)
            let command = try (commandRunner ?? runNpm)(npm, [
                "install", "--prefix", stage.appendingPathComponent("memory-broker").path,
                "--omit=dev",
            ])
            guard command.status == 0 else {
                throw PackageError.npmInstallFailed(command.status, commandDetail(command))
            }
            _ = try resolveInstallation(at: stage, fileManager: fileManager)
        } catch {
            throw error
        }

        do {
            if fileManager.fileExists(atPath: target.path) {
                try fileManager.moveItem(at: target, to: backup)
            }
            do {
                try fileManager.moveItem(at: stage, to: target)
            } catch {
                if fileManager.fileExists(atPath: backup.path) {
                    try? fileManager.moveItem(at: backup, to: target)
                }
                throw PackageError.replacementFailed(error.localizedDescription)
            }
            let installation = try resolveInstallation(at: target, fileManager: fileManager)
            try? fileManager.removeItem(at: backup)
            return installation
        } catch let error as PackageError {
            throw error
        } catch {
            throw PackageError.replacementFailed(error.localizedDescription)
        }
    }

    static func stateURL(in directory: URL = defaultStateDirectory) -> URL {
        directory.appendingPathComponent("status.json")
    }

    private static func ensureNoGlobalConflict(
        settingsURL: URL,
        fileManager: FileManager
    ) throws {
        for package in [packageName, hermesPackageName] {
            switch ManagedNpmPackage.globalRegistration(
                package: package,
                settingsURL: settingsURL,
                fileManager: fileManager
            ) {
            case .registered(let source, _):
                throw PackageError.globalPackageConflict(source: source)
            case .unreadableSettings:
                throw PackageError.globalPackageConflict(source: "unreadable ~/.pi/agent/settings.json")
            case .notRegistered:
                break
            }
        }
    }

    private static func resolveInstallation(
        at root: URL,
        fileManager: FileManager
    ) throws -> Installation {
        let broker = root.appendingPathComponent("memory-broker", isDirectory: true)
        let vendoredContract = broker.appendingPathComponent(contractVendorRelativePath, isDirectory: true)
        let installedContract = broker
            .appendingPathComponent("node_modules", isDirectory: true)
            .appendingPathComponent(contractName, isDirectory: true)
        try validateBundledSource(broker, name: packageName, version: packageVersion, fileManager: fileManager)
        try validateBundledSource(vendoredContract, name: contractName, version: contractVersion, fileManager: fileManager)
        try validateBundledSource(installedContract, name: contractName, version: contractVersion, fileManager: fileManager)
        let entrypoint = broker.appendingPathComponent(entrypointRelativePath)
        guard fileManager.fileExists(atPath: entrypoint.path) else {
            throw PackageError.installationInvalid("missing extension entrypoint")
        }
        let hermes = broker
            .appendingPathComponent("node_modules", isDirectory: true)
            .appendingPathComponent(hermesPackageName, isDirectory: true)
        try validateBundledSource(hermes, name: hermesPackageName, version: hermesVersion, fileManager: fileManager)
        let hermesEntrypoint = hermes.appendingPathComponent("src/index.ts")
        guard fileManager.fileExists(atPath: hermesEntrypoint.path) else {
            throw PackageError.installationInvalid("missing pi-hermes-memory entrypoint")
        }
        return Installation(root: root.path, entrypoint: entrypoint.path, hermesEntrypoint: hermesEntrypoint.path)
    }

    private static func sourceFingerprint(_ roots: [URL], fileManager: FileManager) -> String {
        var data = Data()
        for root in roots.sorted(by: { $0.path < $1.path }) {
            guard let enumerator = fileManager.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else { continue }
            let urls = (enumerator.allObjects as? [URL] ?? []).sorted { $0.path < $1.path }
            for url in urls {
                guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
                let relative = url.path.replacingOccurrences(of: root.path, with: "")
                data.append(Data(relative.utf8))
                data.append(0)
                data.append((try? Data(contentsOf: url)) ?? Data())
                data.append(0)
            }
        }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func validateBundledSource(
        _ directory: URL,
        name: String,
        version: String,
        fileManager: FileManager
    ) throws {
        let manifestURL = directory.appendingPathComponent("package.json")
        guard fileManager.fileExists(atPath: manifestURL.path) else {
            throw PackageError.bundledPackageMissing(manifestURL.path)
        }
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              manifest["name"] as? String == name,
              manifest["version"] as? String == version else {
            throw PackageError.invalidManifest(manifestURL.path)
        }
    }

    private static func findNpm(fileManager: FileManager) throws -> URL {
        var candidates = [
            NSHomeDirectory() + "/.npm-global/bin/npm",
            "/opt/homebrew/bin/npm",
            "/usr/local/bin/npm",
            "/usr/bin/npm",
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { String($0) + "/npm" }
        }
        guard let path = candidates.first(where: { fileManager.isExecutableFile(atPath: $0) }) else {
            throw PackageError.npmUnavailable
        }
        return URL(fileURLWithPath: path)
    }

    private static func runNpm(_ npm: URL, _ arguments: [String]) throws -> ManagedNpmPackage.CommandResult {
        let process = Process()
        process.executableURL = npm
        process.arguments = arguments
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()
        return .init(
            status: process.terminationStatus,
            stdout: String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
            stderr: String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        )
    }

    private static func commandDetail(_ command: ManagedNpmPackage.CommandResult) -> String {
        let detail = [command.stderr, command.stdout]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? "npm exited without diagnostic output"
        return String(detail.prefix(1_000))
    }
}

struct MemoryBrokerRuntimeStatus: Equatable, Sendable {
    enum State: String, Equatable, Sendable {
        case disabled, installing, ready, degraded, importing, migrated
    }

    var state: State
    var enabled: Bool
    var packageVersion: String = MemoryBrokerPackage.packageVersion
    var hermesVersion: String = MemoryBrokerPackage.hermesVersion
    var installed: Bool = false
    var resolved: Bool = false
    var nativeFTS: Bool? = nil
    var detail: String?
    var lastError: String?

    static let disabled = MemoryBrokerRuntimeStatus(state: .disabled, enabled: false)
    static let installing = MemoryBrokerRuntimeStatus(
        state: .installing,
        enabled: true,
        detail: "Installing the optional managed Memory Broker package."
    )
}

enum MemoryBrokerRuntime {
    struct Resolution: Equatable, Sendable {
        let entrypoint: String?
        let status: MemoryBrokerRuntimeStatus
    }

    /// Read-only spawn-time resolution. It intentionally never stages files or
    /// launches npm: AppStore schedules self-healing installation off-main and
    /// a session remains available in degraded mode until that work completes.
    static func resolveForMainSession(
        enabled: Bool,
        stateDirectory: URL = MemoryBrokerPackage.defaultStateDirectory,
        installRoot: URL = MemoryBrokerPackage.defaultInstallRoot,
        fileManager: FileManager = .default
    ) -> Resolution {
        guard enabled else { return .init(entrypoint: nil, status: .disabled) }
        do {
            let installation = try MemoryBrokerPackage.resolveInstalled(
                in: installRoot,
                fileManager: fileManager
            )
            return resolved(installation, stateDirectory: stateDirectory, fileManager: fileManager)
        } catch {
            return degraded(error)
        }
    }

    /// Synchronous staging/install primitive for a background worker only.
    /// Callers must use `MemoryBrokerBackgroundInstall.start`, never invoke this
    /// from Settings or the spawn/MainActor path.
    static func installForMainSession(
        bundledPackagesRoot: String?,
        stateDirectory: URL = MemoryBrokerPackage.defaultStateDirectory,
        installRoot: URL = MemoryBrokerPackage.defaultInstallRoot,
        settingsURL: URL = ManagedNpmPackage.defaultSettingsURL,
        fileManager: FileManager = .default
    ) -> Resolution {
        guard let bundledPackagesRoot,
              !bundledPackagesRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return degraded(MemoryBrokerPackage.PackageError.bundledPackageMissing("PiExt/packages"))
        }
        do {
            let installation = try MemoryBrokerPackage.ensureInstalled(
                bundledPackagesRoot: URL(fileURLWithPath: bundledPackagesRoot),
                in: installRoot,
                settingsURL: settingsURL,
                fileManager: fileManager
            )
            return resolved(installation, stateDirectory: stateDirectory, fileManager: fileManager)
        } catch {
            return degraded(error)
        }
    }

    static func readStatus(
        in directory: URL = MemoryBrokerPackage.defaultStateDirectory,
        fileManager: FileManager = .default
    ) -> MemoryBrokerRuntimeStatus? {
        let url = MemoryBrokerPackage.stateURL(in: directory)
        guard fileManager.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let ready = value["ready"] as? Bool
        return MemoryBrokerRuntimeStatus(
            state: ready == true ? .ready : .degraded,
            enabled: true,
            installed: true,
            resolved: true,
            nativeFTS: ready,
            detail: value["detail"] as? String,
            lastError: value["lastError"] as? String
        )
    }

    private static func resolved(
        _ installation: MemoryBrokerPackage.Installation,
        stateDirectory: URL,
        fileManager: FileManager
    ) -> Resolution {
        var status = readStatus(in: stateDirectory, fileManager: fileManager)
            ?? MemoryBrokerRuntimeStatus(state: .ready, enabled: true)
        status.enabled = true
        status.installed = true
        status.resolved = true
        return .init(entrypoint: installation.entrypoint, status: status)
    }

    private static func degraded(_ error: Error) -> Resolution {
        .init(entrypoint: nil, status: MemoryBrokerRuntimeStatus(
            state: .degraded,
            enabled: true,
            detail: "Memory is optional; the main agent remains available.",
            lastError: error.localizedDescription
        ))
    }
}

/// Keeps blocking package staging and `npm install` off the MainActor while
/// returning the final status to the UI actor in one small, testable hop.
enum MemoryBrokerBackgroundInstall {
    static func start(
        operation: @escaping @Sendable () -> MemoryBrokerRuntime.Resolution,
        completion: @escaping @MainActor (MemoryBrokerRuntime.Resolution) -> Void
    ) -> Task<Void, Never> {
        Task { @MainActor in
            let resolution = await Task.detached(priority: .utility) {
                operation()
            }.value
            completion(resolution)
        }
    }
}
