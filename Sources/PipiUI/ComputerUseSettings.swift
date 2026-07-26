import Foundation
import CoreGraphics

/// Opt-in settings for the desktop `computer` tool.
///
/// This intentionally does not share `ToolSkillSettings`' opt-out semantics:
/// a missing key must leave desktop control disabled.
enum ComputerUseSettings {
    static let enabledKey = "pipiui.computerUse.enabled"
    static let maxLongEdgeKey = "pipiui.computerUse.maxLongEdge"
    static let displayIDKey = "pipiui.computerUse.displayID"
    static let allowedBundleIDsKey = "pipiui.computerUse.allowedBundleIDs"
    static let deniedBundleIDsKey = "pipiui.computerUse.deniedBundleIDs"

    static let defaultMaxLongEdge = 1440
    static let supportedLongEdges = [1080, 1440]

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? false
    }

    static func setEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: enabledKey)
    }

    static func maxLongEdge(defaults: UserDefaults = .standard) -> Int {
        let saved = defaults.integer(forKey: maxLongEdgeKey)
        return supportedLongEdges.contains(saved) ? saved : defaultMaxLongEdge
    }

    static func setMaxLongEdge(_ value: Int, defaults: UserDefaults = .standard) {
        defaults.set(
            supportedLongEdges.contains(value) ? value : defaultMaxLongEdge,
            forKey: maxLongEdgeKey
        )
    }

    static func selectedDisplayID(defaults: UserDefaults = .standard) -> CGDirectDisplayID {
        let saved = defaults.integer(forKey: displayIDKey)
        if let displayID = CGDirectDisplayID(exactly: saved), saved > 0 {
            if CGDisplayIsActive(displayID) != 0 {
                return displayID
            }
        }
        return CGMainDisplayID()
    }

    static func setSelectedDisplayID(
        _ displayID: CGDirectDisplayID,
        defaults: UserDefaults = .standard
    ) {
        defaults.set(Int(displayID), forKey: displayIDKey)
    }

    static func persistedAllowedBundleIDs(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: allowedBundleIDsKey) ?? [])
    }

    static func persistedDeniedBundleIDs(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: deniedBundleIDsKey) ?? [])
    }

    static func setPersistedPolicy(
        bundleID: String,
        decision: ComputerPersistedAppDecision?,
        defaults: UserDefaults = .standard
    ) {
        let normalized = bundleID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return }
        var allowed = persistedAllowedBundleIDs(defaults: defaults)
        var denied = persistedDeniedBundleIDs(defaults: defaults)
        allowed.remove(normalized)
        denied.remove(normalized)
        switch decision {
        case .allow:
            allowed.insert(normalized)
        case .deny:
            denied.insert(normalized)
        case nil:
            break
        }
        defaults.set(Array(allowed).sorted(), forKey: allowedBundleIDsKey)
        defaults.set(Array(denied).sorted(), forKey: deniedBundleIDsKey)
    }

    static func downscaledSize(
        pixelWidth: Int,
        pixelHeight: Int,
        maxLongEdge: Int
    ) -> ComputerImageSize {
        guard pixelWidth > 0, pixelHeight > 0 else {
            return ComputerImageSize(width: 1, height: 1)
        }
        let limit = max(1, maxLongEdge)
        let scale = min(1, Double(limit) / Double(max(pixelWidth, pixelHeight)))
        return ComputerImageSize(
            width: max(1, Int((Double(pixelWidth) * scale).rounded())),
            height: max(1, Int((Double(pixelHeight) * scale).rounded()))
        )
    }

    static func providerDisplaySize(defaults: UserDefaults = .standard) -> ComputerImageSize {
        let displayID = selectedDisplayID(defaults: defaults)
        let width = CGDisplayPixelsWide(displayID)
        let height = CGDisplayPixelsHigh(displayID)
        if width == 0 || height == 0 {
            return ComputerImageSize(width: defaultMaxLongEdge, height: 900)
        }
        return downscaledSize(
            pixelWidth: width,
            pixelHeight: height,
            maxLongEdge: maxLongEdge(defaults: defaults)
        )
    }

    static func activeDisplayIDs() -> [CGDirectDisplayID] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
            return [CGMainDisplayID()]
        }
        var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else {
            return [CGMainDisplayID()]
        }
        return Array(displays.prefix(Int(count)))
    }
}

enum ComputerPersistedAppDecision: String, Codable {
    case allow
    case deny
}
