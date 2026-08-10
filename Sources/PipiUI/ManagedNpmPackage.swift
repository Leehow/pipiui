import Darwin
import Foundation

/// App-owned, fixed-version installation for an npm package that PipiUI mounts
/// by passing one resolved file path to pi's `-e` argument.
///
/// The package is deliberately installed below PipiUI's Application Support
/// tree, never into `~/.pi` or a global npm prefix. That keeps a PipiUI feature
/// scoped to its own launched session and leaves bare `pi` plus user-managed
/// package registrations untouched.
enum ManagedNpmPackage {
    static var defaultPipiUIRoot: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
    }

    /// A dedicated private prefix prevents npm's `node_modules`, lockfile, and
    /// package metadata from being mixed with bundled Pi extension resources.
    static var defaultInstallRoot: URL {
        defaultPipiUIRoot.appendingPathComponent("managed-npm", isDirectory: true)
    }

    static var defaultSettingsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/settings.json")
    }

    enum InstallationState: Equatable, Sendable {
        case installed
        case alreadyInstalled
    }

    struct Installation: Equatable, Sendable {
        let state: InstallationState
        let packageURL: String
        let entrypoint: String
    }

    /// Inject this in tests so no test ever invokes a real npm executable.
    struct CommandResult: Equatable, Sendable {
        let status: Int32
        let stdout: String
        let stderr: String
    }

    typealias CommandRunner = (URL, [String]) throws -> CommandResult

    /// Matches Hermes's read-only global-registration check. Callers must not
    /// mount the managed entry point when this reports a registration: pi would
    /// otherwise load the same package globally and again through `-e`.
    enum GlobalRegistration: Equatable, Sendable {
        case notRegistered
        case registered(source: String, version: String?)
        case unreadableSettings
    }

    enum PackageError: Swift.Error, Equatable, LocalizedError, Sendable {
        case invalidPackageName(String)
        case unpinnedVersion(String)
        case invalidEntrypoint(String)
        case npmUnavailable
        case npmLaunchFailed(path: String, detail: String)
        case npmInstallFailed(package: String, version: String, status: Int32, detail: String)
        case installRootCreateFailed(path: String, detail: String)
        case installLockFailed(path: String, detail: String)
        case removalFailed(path: String, detail: String)
        case packageMissing(path: String)
        case manifestMissing(path: String)
        case manifestInvalid(path: String)
        case unexpectedPackageName(expected: String, actual: String?)
        case unexpectedVersion(expected: String, actual: String?)
        case extensionsMissing(path: String)
        case extensionsInvalid(path: String)
        case unsafeEntrypoint(String)
        case entrypointMissing(path: String)

        var errorDescription: String? {
            switch self {
            case .invalidPackageName(let package):
                return "Invalid npm package name: \(package)"
            case .unpinnedVersion(let version):
                return "Managed npm packages require an exact semantic version, not \(version)."
            case .invalidEntrypoint(let entrypoint):
                return "Managed npm entry point must be a non-empty relative path: \(entrypoint)"
            case .npmUnavailable:
                return "npm is unavailable. Install Node.js/npm or make npm available on PATH."
            case .npmLaunchFailed(let path, let detail):
                return "Could not launch npm at \(path): \(detail)"
            case .npmInstallFailed(let package, let version, let status, let detail):
                return "npm install \(package)@\(version) failed with exit status \(status): \(detail)"
            case .installRootCreateFailed(let path, let detail):
                return "Could not create managed npm install root \(path): \(detail)"
            case .installLockFailed(let path, let detail):
                return "Could not acquire managed npm install lock \(path): \(detail)"
            case .removalFailed(let path, let detail):
                return "Could not remove managed npm package at \(path): \(detail)"
            case .packageMissing(let path):
                return "Managed npm package is missing at \(path)."
            case .manifestMissing(let path):
                return "Managed npm package is missing package.json at \(path)."
            case .manifestInvalid(let path):
                return "Managed npm package has an invalid package.json at \(path)."
            case .unexpectedPackageName(let expected, let actual):
                return "Managed npm package name mismatch: expected \(expected), found \(actual ?? "none")."
            case .unexpectedVersion(let expected, let actual):
                return "Managed npm package version mismatch: expected \(expected), found \(actual ?? "none")."
            case .extensionsMissing(let path):
                return "Managed npm package has no pi.extensions declaration in \(path)."
            case .extensionsInvalid(let path):
                return "Managed npm package has an invalid pi.extensions declaration in \(path)."
            case .unsafeEntrypoint(let entrypoint):
                return "Managed npm entry point escapes its package root: \(entrypoint)"
            case .entrypointMissing(let path):
                return "Managed npm entry point is missing at \(path)."
            }
        }
    }

    /// The install directory is `<installRoot>/<package>-<version>` for normal
    /// unscoped npm names. Scoped names encode only their slash in this storage
    /// component; npm still receives and installs the exact original name under
    /// `node_modules/@scope/name`.
    static func installDirectoryURL(
        package: String,
        version: String,
        in installRoot: URL = defaultInstallRoot
    ) throws -> URL {
        try validate(package: package, version: version, entrypoint: nil)
        return installRoot.appendingPathComponent(
            "\(storageName(for: package))-\(version)",
            isDirectory: true
        )
    }

    static func managedPackageURL(
        package: String,
        version: String,
        in installRoot: URL = defaultInstallRoot
    ) throws -> URL {
        try installDirectoryURL(package: package, version: version, in: installRoot)
            .appendingPathComponent("node_modules", isDirectory: true)
            .appendingPathComponent(package, isDirectory: true)
    }

    /// Ensure a ready-to-mount fixed package is present. `entrypoint == nil`
    /// reads the sole path declared by `package.json`'s `pi.extensions`; a
    /// supplied relative path supports packages whose entry point is known by
    /// the caller. In both cases the resolved file must remain inside the
    /// installed package root.
    ///
    /// We intentionally use `npm install --prefix`, not `npm pack`: npm builds
    /// the ordinary `node_modules` layout including transitive dependencies,
    /// while `--prefix` keeps every generated file in this app-owned tree.
    @discardableResult
    static func ensureInstalled(
        package: String,
        version: String,
        entrypoint: String? = nil,
        in installRoot: URL = defaultInstallRoot,
        npmExecutable: URL? = nil,
        commandRunner: CommandRunner? = nil,
        fileManager: FileManager = .default
    ) throws -> Installation {
        try validate(package: package, version: version, entrypoint: entrypoint)
        let targetURL = try installDirectoryURL(package: package, version: version, in: installRoot)
        let packageURL = try managedPackageURL(package: package, version: version, in: installRoot)

        do {
            try fileManager.createDirectory(at: installRoot, withIntermediateDirectories: true)
        } catch {
            throw PackageError.installRootCreateFailed(
                path: installRoot.path,
                detail: error.localizedDescription
            )
        }
        let lease: ManagedPackageInstallLease.Lease
        do {
            lease = try ManagedPackageInstallLease.acquire(
                at: installRoot,
                name: "managed-npm-\(storageName(for: package))-\(version)"
            )
        } catch {
            throw PackageError.installLockFailed(path: installRoot.path, detail: error.localizedDescription)
        }
        defer { lease.release() }

        // Re-check only after acquiring the cross-process lease. A concurrent
        // installer may have completed while this caller was waiting.
        if installedManifestMatches(
            at: packageURL,
            package: package,
            version: version,
            fileManager: fileManager
        ) {
            let resolved = try resolveEntrypoint(
                at: packageURL,
                package: package,
                version: version,
                entrypoint: entrypoint,
                fileManager: fileManager
            )
            return Installation(
                state: .alreadyInstalled,
                packageURL: packageURL.path,
                entrypoint: resolved
            )
        }

        if fileManager.fileExists(atPath: targetURL.path) {
            try removeDirectory(at: targetURL, fileManager: fileManager)
        }

        guard let npm = npmExecutable ?? findNpmExecutable(fileManager: fileManager) else {
            throw PackageError.npmUnavailable
        }
        guard fileManager.isExecutableFile(atPath: npm.path) else {
            throw PackageError.npmUnavailable
        }

        // A fixed version is required because a range or tag can change between
        // app launches, silently making the mounted extension non-reproducible.
        let arguments = [
            "install",
            "--prefix", targetURL.path,
            "\(package)@\(version)",
        ]
        let runner = commandRunner ?? runNpm
        let command: CommandResult
        do {
            command = try runner(npm, arguments)
        } catch let error as PackageError {
            throw error
        } catch {
            throw PackageError.npmLaunchFailed(path: npm.path, detail: error.localizedDescription)
        }
        guard command.status == 0 else {
            try? fileManager.removeItem(at: targetURL)
            throw PackageError.npmInstallFailed(
                package: package,
                version: version,
                status: command.status,
                detail: commandDetail(command)
            )
        }

        do {
            let resolved = try resolveEntrypoint(
                at: packageURL,
                package: package,
                version: version,
                entrypoint: entrypoint,
                fileManager: fileManager
            )
            return Installation(state: .installed, packageURL: packageURL.path, entrypoint: resolved)
        } catch {
            // A successful npm exit without the requested manifest/entry point
            // is still a failed managed install. Remove the partial private tree
            // so the next attempt can retry cleanly.
            try? fileManager.removeItem(at: targetURL)
            throw error
        }
    }

    /// Resolve the absolute file path that is safe to pass directly as
    /// `pi -e <path>`. Do not return `npm:<name>@<version>` here: that would
    /// delegate resolution to each pi process and reintroduce mutable/global
    /// package behavior outside PipiUI's private prefix.
    static func resolvedEntrypoint(
        package: String,
        version: String,
        entrypoint: String? = nil,
        in installRoot: URL = defaultInstallRoot,
        fileManager: FileManager = .default
    ) throws -> String {
        try validate(package: package, version: version, entrypoint: entrypoint)
        let packageURL = try managedPackageURL(package: package, version: version, in: installRoot)
        return try resolveEntrypoint(
            at: packageURL,
            package: package,
            version: version,
            entrypoint: entrypoint,
            fileManager: fileManager
        )
    }

    /// Read-only detection of a manually registered pi package. This never
    /// writes `~/.pi/agent/settings.json`: that file belongs to the user and to
    /// bare pi, while this utility only decides whether PipiUI must avoid a
    /// duplicate `-e` mount.
    static func globalRegistration(
        package: String,
        settingsURL: URL = defaultSettingsURL,
        fileManager: FileManager = .default
    ) -> GlobalRegistration {
        guard fileManager.fileExists(atPath: settingsURL.path) else {
            return .notRegistered
        }
        guard let data = try? Data(contentsOf: settingsURL), !data.isEmpty,
              let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .unreadableSettings
        }
        guard let rawPackages = settings["packages"] else {
            return .notRegistered
        }
        guard let packages = rawPackages as? [Any] else {
            return .unreadableSettings
        }

        for entry in packages {
            guard let source = packageSource(entry) else { continue }
            if let npm = npmRegistration(source, package: package) {
                return .registered(source: source, version: npm.version)
            }
            if let local = localRegistration(source, package: package, fileManager: fileManager) {
                return .registered(source: source, version: local.version)
            }
        }
        return .notRegistered
    }

    /// Remove only the private prefix owned by this utility. User/global npm
    /// installations and pi's own settings are intentionally never touched.
    @discardableResult
    static func removeInstalled(
        package: String,
        version: String,
        in installRoot: URL = defaultInstallRoot,
        fileManager: FileManager = .default
    ) throws -> Bool {
        let targetURL = try installDirectoryURL(package: package, version: version, in: installRoot)
        guard fileManager.fileExists(atPath: targetURL.path) else { return false }
        try removeDirectory(at: targetURL, fileManager: fileManager)
        return true
    }

    private static func resolveEntrypoint(
        at packageURL: URL,
        package: String,
        version: String,
        entrypoint: String?,
        fileManager: FileManager
    ) throws -> String {
        guard fileManager.fileExists(atPath: packageURL.path) else {
            throw PackageError.packageMissing(path: packageURL.path)
        }
        let manifestURL = packageURL.appendingPathComponent("package.json")
        guard fileManager.fileExists(atPath: manifestURL.path) else {
            throw PackageError.manifestMissing(path: manifestURL.path)
        }
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw PackageError.manifestInvalid(path: manifestURL.path)
        }
        guard manifest["name"] as? String == package else {
            throw PackageError.unexpectedPackageName(
                expected: package,
                actual: manifest["name"] as? String
            )
        }
        guard manifest["version"] as? String == version else {
            throw PackageError.unexpectedVersion(
                expected: version,
                actual: manifest["version"] as? String
            )
        }

        let declared: String
        if let entrypoint {
            declared = entrypoint
        } else {
            guard let pi = manifest["pi"] as? [String: Any],
                  let rawExtensions = pi["extensions"]
            else {
                throw PackageError.extensionsMissing(path: manifestURL.path)
            }
            guard let extensions = rawExtensions as? [String],
                  extensions.count == 1,
                  let only = extensions.first,
                  !only.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                throw PackageError.extensionsInvalid(path: manifestURL.path)
            }
            declared = only
        }

        let relative = declared.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !relative.isEmpty else {
            throw PackageError.invalidEntrypoint(declared)
        }
        guard !relative.hasPrefix("/") else {
            throw PackageError.unsafeEntrypoint(declared)
        }

        let root = packageURL.resolvingSymlinksInPath().standardizedFileURL
        let candidate = packageURL.appendingPathComponent(relative)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard candidate.path.hasPrefix(rootPrefix) else {
            throw PackageError.unsafeEntrypoint(declared)
        }
        guard fileManager.fileExists(atPath: candidate.path) else {
            throw PackageError.entrypointMissing(path: candidate.path)
        }
        return candidate.path
    }

    private static func installedManifestMatches(
        at packageURL: URL,
        package: String,
        version: String,
        fileManager: FileManager
    ) -> Bool {
        let manifestURL = packageURL.appendingPathComponent("package.json")
        guard fileManager.fileExists(atPath: manifestURL.path),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return false
        }
        return manifest["name"] as? String == package && manifest["version"] as? String == version
    }

    private static func removeDirectory(at url: URL, fileManager: FileManager) throws {
        do {
            try fileManager.removeItem(at: url)
        } catch {
            throw PackageError.removalFailed(path: url.path, detail: error.localizedDescription)
        }
    }

    private static func findNpmExecutable(fileManager: FileManager) -> URL? {
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
            return nil
        }
        return URL(fileURLWithPath: path)
    }

    private static func runNpm(_ npm: URL, _ arguments: [String]) throws -> CommandResult {
        let process = Process()
        process.executableURL = npm
        process.arguments = arguments
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        do {
            try process.run()
        } catch {
            throw PackageError.npmLaunchFailed(path: npm.path, detail: error.localizedDescription)
        }
        process.waitUntilExit()
        return CommandResult(
            status: process.terminationStatus,
            stdout: String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
            stderr: String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        )
    }

    private static func commandDetail(_ command: CommandResult) -> String {
        let text = [command.stderr, command.stdout]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        guard !text.isEmpty else { return "npm exited without diagnostic output" }
        return String(text.prefix(4_000))
    }

    private static func validate(package: String, version: String, entrypoint: String?) throws {
        guard isValidPackageName(package) else {
            throw PackageError.invalidPackageName(package)
        }
        guard isPinnedVersion(version) else {
            throw PackageError.unpinnedVersion(version)
        }
        if let entrypoint {
            let trimmed = entrypoint.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                throw PackageError.invalidEntrypoint(entrypoint)
            }
        }
    }

    private static func isValidPackageName(_ package: String) -> Bool {
        guard !package.isEmpty,
              package == package.trimmingCharacters(in: .whitespacesAndNewlines),
              !package.contains(where: { $0.isWhitespace || $0 == "\\" })
        else {
            return false
        }
        let pieces = package.split(separator: "/", omittingEmptySubsequences: false)
        if package.hasPrefix("@") {
            guard pieces.count == 2, !pieces[0].isEmpty, !pieces[1].isEmpty else { return false }
        } else {
            guard pieces.count == 1 else { return false }
        }
        return !pieces.contains { $0 == "." || $0 == ".." }
    }

    private static func isPinnedVersion(_ version: String) -> Bool {
        guard !version.isEmpty,
              version == version.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            return false
        }
        let allowed = CharacterSet(charactersIn: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-+")
        guard version.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return false }
        let core = version.split(maxSplits: 1, whereSeparator: { $0 == "-" || $0 == "+" }).first ?? ""
        let numericParts = core.split(separator: ".", omittingEmptySubsequences: false)
        return numericParts.count == 3 && numericParts.allSatisfy {
            !$0.isEmpty && $0.allSatisfy(\.isNumber)
        }
    }

    private static func storageName(for package: String) -> String {
        package.replacingOccurrences(of: "/", with: "--")
    }

    private static func packageSource(_ entry: Any) -> String? {
        if let source = entry as? String { return source }
        return (entry as? [String: Any])?["source"] as? String
    }

    private struct NpmRegistration {
        let version: String?
    }

    private static func npmRegistration(_ source: String, package: String) -> NpmRegistration? {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let specifier = trimmed.hasPrefix("npm:") ? String(trimmed.dropFirst(4)) : trimmed
        guard specifier.hasPrefix(package) else { return nil }
        let suffix = String(specifier.dropFirst(package.count))
        if suffix.isEmpty { return NpmRegistration(version: nil) }
        guard suffix.hasPrefix("@") else { return nil }
        let version = String(suffix.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
        return NpmRegistration(version: version.isEmpty ? nil : version)
    }

    private struct LocalRegistration {
        let version: String?
    }

    private static func localRegistration(
        _ source: String,
        package: String,
        fileManager: FileManager
    ) -> LocalRegistration? {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let path: String
        if trimmed.hasPrefix("file:") {
            path = String(trimmed.dropFirst("file:".count))
        } else if trimmed.hasPrefix("/") || trimmed.hasPrefix("~/") {
            path = trimmed
        } else {
            return nil
        }
        let expanded = (path as NSString).expandingTildeInPath
        let manifestURL = URL(fileURLWithPath: expanded).appendingPathComponent("package.json")
        guard fileManager.fileExists(atPath: manifestURL.path),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              manifest["name"] as? String == package
        else {
            return nil
        }
        return LocalRegistration(version: manifest["version"] as? String)
    }
}

/// Serializes mutable managed-package prefixes across both threads and PipiUI
/// processes. The in-process condition avoids relying on platform-specific
/// same-process `flock` behavior; the descriptor lock covers independent app
/// processes. The lock file intentionally remains as an inert synchronization
/// inode after release.
enum ManagedPackageInstallLease {
    enum LeaseError: LocalizedError {
        case openFailed(path: String, detail: String)
        case acquireFailed(path: String, detail: String)

        var errorDescription: String? {
            switch self {
            case .openFailed(let path, let detail):
                "Could not open install lock \(path): \(detail)"
            case .acquireFailed(let path, let detail):
                "Could not acquire install lock \(path): \(detail)"
            }
        }
    }

    private static let condition = NSCondition()
    private static var heldPaths = Set<String>()

    final class Lease {
        private let path: String
        private var descriptor: Int32
        private var released = false

        fileprivate init(path: String, descriptor: Int32) {
            self.path = path
            self.descriptor = descriptor
        }

        func release() {
            ManagedPackageInstallLease.release(path: path, descriptor: &descriptor, released: &released)
        }

        deinit { release() }
    }

    static func acquire(at root: URL, name: String) throws -> Lease {
        let path = root.appendingPathComponent(".\(name).lock").path
        condition.lock()
        while heldPaths.contains(path) {
            condition.wait()
        }
        heldPaths.insert(path)
        condition.unlock()

        do {
            let descriptor = open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
            guard descriptor >= 0 else {
                throw LeaseError.openFailed(path: path, detail: String(cString: strerror(errno)))
            }
            guard flock(descriptor, LOCK_EX) == 0 else {
                let detail = String(cString: strerror(errno))
                Darwin.close(descriptor)
                throw LeaseError.acquireFailed(path: path, detail: detail)
            }
            return Lease(path: path, descriptor: descriptor)
        } catch {
            condition.lock()
            heldPaths.remove(path)
            condition.broadcast()
            condition.unlock()
            throw error
        }
    }

    private static func release(path: String, descriptor: inout Int32, released: inout Bool) {
        guard !released else { return }
        released = true
        if descriptor >= 0 {
            _ = flock(descriptor, LOCK_UN)
            Darwin.close(descriptor)
            descriptor = -1
        }
        condition.lock()
        heldPaths.remove(path)
        condition.broadcast()
        condition.unlock()
    }
}
