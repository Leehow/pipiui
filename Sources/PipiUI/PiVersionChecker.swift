import Foundation

/// Version info for the installed pi CLI vs. the npm registry latest.
struct PiVersionInfo: Equatable {
    var installed: String?
    var latest: String?
    var checkedAt: Date?
    var error: String?

    /// True when both installed and latest are known and latest is newer.
    var updateAvailable: Bool {
        guard let installed, let latest else { return false }
        return PiVersionChecker.isNewer(latest, than: installed)
    }
}

/// Detects the installed pi version and queries the npm registry for the latest.
enum PiVersionChecker {
    /// npm registry endpoint returning the `latest` dist-tag JSON (has `version`).
    static let registryURL = URL(
        string: "https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest"
    )!

    private static let requestTimeoutSeconds: TimeInterval = 10

    /// Resolve the installed pi version by walking up from the real pi executable
    /// path looking for the package's `package.json`. No process is spawned.
    static func installedVersion() -> String? {
        guard let executable = PiProcess.findPiExecutable() else { return nil }
        let real = (executable as NSString).resolvingSymlinksInPath
        var dir = URL(fileURLWithPath: real).deletingLastPathComponent()
        for _ in 0..<6 {
            let pkgURL = dir.appendingPathComponent("package.json")
            guard
                let data = try? Data(contentsOf: pkgURL),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let name = json["name"] as? String,
                name.contains("pi-coding-agent"),
                let version = json["version"] as? String
            else {
                dir.deleteLastPathComponent()
                continue
            }
            return version
        }
        return nil
    }

    /// Fetch the latest pi version from the npm registry. Returns nil on any
    /// network failure, timeout, or malformed response.
    static func latestVersion(session: URLSession = .shared) async -> String? {
        var request = URLRequest(url: registryURL)
        request.httpMethod = "GET"
        request.timeoutInterval = requestTimeoutSeconds
        request.setValue("PipiUI", forHTTPHeaderField: "User-Agent")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let version = json["version"] as? String,
                  !version.isEmpty else {
                return nil
            }
            return version
        } catch {
            return nil
        }
    }

    /// Numeric compare of `major.minor.patch` (ignoring a leading `v`; missing
    /// segments count as 0).
    static func isNewer(_ candidate: String, than installed: String) -> Bool {
        let c = versionComponents(candidate)
        let i = versionComponents(installed)
        for idx in 0..<3 {
            if c[idx] > i[idx] { return true }
            if c[idx] < i[idx] { return false }
        }
        return false
    }

    private static func versionComponents(_ version: String) -> [Int] {
        var s = version
        if s.hasPrefix("v") { s.removeFirst() }
        // Split on any non-digit separators (drops prerelease/build metadata, e.g. "1.2.3-beta.1").
        let numbers = s.components(separatedBy: CharacterSet(charactersIn: ".-+"))
            .prefix(3)
            .map { Int($0) ?? 0 }
        // Ensure exactly 3 components.
        return (numbers + [0, 0, 0]).prefix(3).map { $0 }
    }
}