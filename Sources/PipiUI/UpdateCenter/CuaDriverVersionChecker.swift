import Foundation

/// Detects the packaged cua-driver version and queries GitHub releases for the latest driver tag.
enum CuaDriverVersionChecker {
    private static let releasesURL = URL(
        string: "https://api.github.com/repos/trycua/cua/releases"
    )!
    private static let tagPrefix = "cua-driver-rs-v"
    private static let requestTimeoutSeconds: TimeInterval = 12
    private static let fallbackReleaseNotesURL = URL(string: "https://github.com/trycua/cua/releases")!

    /// Process-lifetime cache so DEBUG `--version` spawn happens at most once.
    private static let cacheLock = NSLock()
    private static var cachedInstalled: String?
    private static var didResolveInstalled = false

    /// Installed version from packaging marker `cua-driver.version` next to the helper,
    /// falling back to spawning the helper with `--version` (DEBUG / swift-run).
    static func installedVersion() -> String? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if didResolveInstalled {
            return cachedInstalled
        }
        let resolved = resolveInstalledVersion()
        cachedInstalled = resolved
        didResolveInstalled = true
        return resolved
    }

    /// Fetch the highest `cua-driver-rs-v*` release from trycua/cua. Returns nils on failure.
    static func latestVersion(
        session: URLSession = .shared
    ) async -> (version: String?, releaseNotesURL: URL?) {
        var request = URLRequest(url: releasesURL)
        request.httpMethod = "GET"
        request.timeoutInterval = requestTimeoutSeconds
        request.setValue("PipiUI", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return (nil, nil)
            }
            guard let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                return (nil, nil)
            }

            var bestVersion: String?
            var bestURL: URL?

            for release in array {
                guard let tag = release["tag_name"] as? String,
                      tag.hasPrefix(tagPrefix) else { continue }
                let version = String(tag.dropFirst(tagPrefix.count))
                guard !version.isEmpty else { continue }
                if let currentBest = bestVersion {
                    if !PiVersionChecker.isNewer(version, than: currentBest) {
                        continue
                    }
                }
                bestVersion = version
                if let html = release["html_url"] as? String, let url = URL(string: html) {
                    bestURL = url
                } else {
                    bestURL = fallbackReleaseNotesURL
                }
            }

            if let bestVersion {
                return (bestVersion, bestURL ?? fallbackReleaseNotesURL)
            }
            return (nil, nil)
        } catch {
            return (nil, nil)
        }
    }

    // MARK: - Installed resolution

    private static func resolveInstalledVersion() -> String? {
        // Packaging marker lives in the app bundle's Resources (plain data, not
        // nested code). Prefer it before spawning the helper.
        if let versionURL = Bundle.main.url(forResource: "cua-driver", withExtension: "version"),
           let text = try? String(contentsOf: versionURL, encoding: .utf8) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let helperPath = resolveHelperPath() {
            // Legacy sibling-of-helper fallback (older packages wrote it next to
            // the executable in Contents/Helpers).
            let versionFile = URL(fileURLWithPath: helperPath)
                .deletingLastPathComponent()
                .appendingPathComponent("cua-driver.version")
            if let text = try? String(contentsOf: versionFile, encoding: .utf8) {
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
            if let fromProcess = versionFromHelper(at: helperPath) {
                return fromProcess
            }
        }
        return nil
    }

    /// Mirror of runtime helper lookup: override → (DEBUG) env → Bundle Helpers.
    private static func resolveHelperPath() -> String? {
        let fm = FileManager.default
        let environment = ProcessInfo.processInfo.environment
#if DEBUG
        if let envPath = environment["PIPIUI_CUA_DRIVER_PATH"],
           fm.fileExists(atPath: envPath) {
            return envPath
        }
#endif
        let bundled = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/cua-driver").path
        if fm.fileExists(atPath: bundled) {
            return bundled
        }
        return nil
    }

    /// Spawn `cua-driver --version` and parse a semver-like token from stdout/stderr.
    private static func versionFromHelper(at path: String) -> String? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: path)
        proc.arguments = ["--version"]
        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return nil
        }
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        let combined = (String(data: outData, encoding: .utf8) ?? "")
            + "\n"
            + (String(data: errData, encoding: .utf8) ?? "")
        return parseVersion(from: combined)
    }

    /// Pull the first `major.minor.patch` (optional leading `v`) from helper output.
    private static func parseVersion(from text: String) -> String? {
        let pattern = #"v?(\d+\.\d+\.\d+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = text as NSString
        let range = NSRange(location: 0, length: ns.length)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges >= 2 else { return nil }
        let ver = ns.substring(with: match.range(at: 1))
        return ver.isEmpty ? nil : ver
    }
}
