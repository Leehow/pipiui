import Foundation

/// Products shown in the Update Center. `jcode` is deferred.
enum UpdateProductID: String, CaseIterable, Codable, Hashable {
    case pi
    case cuaDriver
}

/// Per-product version/check state for the Update Center.
struct ProductUpdateInfo: Identifiable, Equatable {
    let id: UpdateProductID
    var displayName: String
    var installedVersion: String?
    var latestVersion: String?
    var releaseNotesURL: URL?
    var checkedAt: Date?
    var error: String?
    /// Persisted "ignore this version" target (matched against `latestVersion`).
    var ignoredVersion: String?

    /// Installed & latest known, latest newer than installed, and not ignored.
    var updateAvailable: Bool {
        guard let installed = installedVersion, let latest = latestVersion else { return false }
        guard PiVersionChecker.isNewer(latest, than: installed) else { return false }
        if let ignoredVersion, ignoredVersion == latest { return false }
        return true
    }

    /// True when the user ignored the currently known latest version.
    var isIgnored: Bool {
        guard let latestVersion, let ignoredVersion else { return false }
        return latestVersion == ignoredVersion
    }

    static func placeholder(for id: UpdateProductID, ignoredVersion: String? = nil) -> ProductUpdateInfo {
        ProductUpdateInfo(
            id: id,
            displayName: id.defaultDisplayName,
            installedVersion: nil,
            latestVersion: nil,
            releaseNotesURL: id.defaultReleaseNotesURL,
            checkedAt: nil,
            error: nil,
            ignoredVersion: ignoredVersion
        )
    }
}

extension UpdateProductID {
    var defaultDisplayName: String {
        switch self {
        case .pi: return "pi"
        case .cuaDriver: return "cua-driver"
        }
    }

    var defaultReleaseNotesURL: URL? {
        switch self {
        case .pi:
            return URL(string: "https://github.com/earendil-works/pi/releases")
        case .cuaDriver:
            return URL(string: "https://github.com/trycua/cua/releases")
        }
    }
}
