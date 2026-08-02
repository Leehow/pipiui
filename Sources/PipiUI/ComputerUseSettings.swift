import Foundation
import CoreGraphics

enum ComputerUseStrategyKind: String, CaseIterable, Codable {
    case builtIn
    case external

    var title: String {
        switch self {
        case .builtIn: return "PipiUI 内置策略"
        case .external: return "外部 Pi 策略"
        }
    }
}

struct ComputerUseStrategySelection: Equatable {
    let kind: ComputerUseStrategyKind
    let extensionPath: String

    var sourceSummary: String {
        switch kind {
        case .builtIn:
            return "PipiUI 内置策略 v1 · Runtime API v1 · \(extensionPath)"
        case .external:
            return "外部可信代码 · 策略版本由扩展管理 · Runtime API v1 · \(extensionPath)"
        }
    }
}

struct ComputerUseExternalStrategyApplyDecision: Equatable {
    let normalizedPath: String
    let shouldPersist: Bool
    let shouldRestartSessions: Bool
}

enum ComputerUseStrategySelectionError: LocalizedError, Equatable {
    case builtInUnavailable
    case externalPathMissing
    case externalPathNotFound(String)
    case externalPathUnreadable(String)
    case unsupportedExternalFile(String)
    case externalDirectoryHasNoEntry(String)

    var errorDescription: String? {
        switch self {
        case .builtInUnavailable:
            return "PipiUI 内置 Computer Use 策略资源缺失。请重新安装 PipiUI。"
        case .externalPathMissing:
            return "已选择外部 Pi 策略，但尚未配置扩展文件或目录。"
        case .externalPathNotFound(let path):
            return "外部 Pi 策略不存在：\(path)"
        case .externalPathUnreadable(let path):
            return "外部 Pi 策略不可读：\(path)"
        case .unsupportedExternalFile(let path):
            return "外部 Pi 策略必须是 .ts、.js、.mjs、.cjs 文件或扩展目录：\(path)"
        case .externalDirectoryHasNoEntry(let path):
            return "外部 Pi 策略目录缺少 index.ts、index.js、index.mjs 或 index.cjs：\(path)"
        }
    }
}

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
    static let strategyKindKey = "pipiui.computerUse.strategyKind"
    static let externalStrategyPathKey = "pipiui.computerUse.externalStrategyPath"
    static let allowedApplicationIdentitiesKey =
        "pipiui.computerUse.allowedApplicationIdentities.v1"

    static let defaultMaxLongEdge = 1440
    static let supportedLongEdges = [1080, 1440]
    /// PipiUI's nested Pi allowlist recognizes only these stable strategy tool
    /// names. Additional tools may be useful top-level, but are not guaranteed
    /// to survive an explicit subagent tool allowlist.
    static let requiredNestedStrategyToolNames = [
        "computer",
        "open_application",
    ]

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? false
    }

    static func setEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: enabledKey)
    }

    static func strategyKind(defaults: UserDefaults = .standard) -> ComputerUseStrategyKind {
        guard let raw = defaults.string(forKey: strategyKindKey),
              let kind = ComputerUseStrategyKind(rawValue: raw) else {
            return .builtIn
        }
        return kind
    }

    static func setStrategyKind(
        _ kind: ComputerUseStrategyKind,
        defaults: UserDefaults = .standard
    ) {
        defaults.set(kind.rawValue, forKey: strategyKindKey)
    }

    static func externalStrategyPath(defaults: UserDefaults = .standard) -> String {
        defaults.string(forKey: externalStrategyPathKey) ?? ""
    }

    static func setExternalStrategyPath(
        _ path: String,
        defaults: UserDefaults = .standard
    ) {
        defaults.set(
            path.trimmingCharacters(in: .whitespacesAndNewlines),
            forKey: externalStrategyPathKey
        )
    }

    /// Applying an external strategy is also the explicit hot-reload action.
    /// Re-applying an unchanged path must therefore restart eligible sessions;
    /// passive status reads do not call this seam and remain side-effect free.
    static func externalStrategyApplyDecision(
        submittedPath: String,
        currentPath: String,
        computerUseEnabled: Bool,
        strategyKind: ComputerUseStrategyKind
    ) -> ComputerUseExternalStrategyApplyDecision {
        let normalizedPath = submittedPath.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let normalizedCurrentPath = currentPath.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return ComputerUseExternalStrategyApplyDecision(
            normalizedPath: normalizedPath,
            shouldPersist: normalizedPath != normalizedCurrentPath,
            shouldRestartSessions:
                computerUseEnabled && strategyKind == .external
        )
    }

    static func resolveStrategy(
        builtInPath: String?,
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default
    ) throws -> ComputerUseStrategySelection {
        switch strategyKind(defaults: defaults) {
        case .builtIn:
            guard let builtInPath, fileManager.isReadableFile(atPath: builtInPath) else {
                throw ComputerUseStrategySelectionError.builtInUnavailable
            }
            return ComputerUseStrategySelection(
                kind: .builtIn,
                extensionPath: URL(fileURLWithPath: builtInPath).standardizedFileURL.path
            )

        case .external:
            let configured = externalStrategyPath(defaults: defaults)
            guard !configured.isEmpty else {
                throw ComputerUseStrategySelectionError.externalPathMissing
            }
            let expanded = (configured as NSString).expandingTildeInPath
            let url = URL(fileURLWithPath: expanded).standardizedFileURL
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
                throw ComputerUseStrategySelectionError.externalPathNotFound(url.path)
            }
            guard fileManager.isReadableFile(atPath: url.path) else {
                throw ComputerUseStrategySelectionError.externalPathUnreadable(url.path)
            }
            if isDirectory.boolValue {
                let entryNames = ["index.ts", "index.js", "index.mjs", "index.cjs"]
                guard entryNames.contains(where: {
                    fileManager.isReadableFile(
                        atPath: url.appendingPathComponent($0).path
                    )
                }) else {
                    throw ComputerUseStrategySelectionError.externalDirectoryHasNoEntry(
                        url.path
                    )
                }
            } else {
                let supportedExtensions = Set(["ts", "js", "mjs", "cjs"])
                guard supportedExtensions.contains(url.pathExtension.lowercased()) else {
                    throw ComputerUseStrategySelectionError.unsupportedExternalFile(url.path)
                }
            }
            return ComputerUseStrategySelection(
                kind: .external,
                extensionPath: url.path
            )
        }
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
        if let saved = defaults.object(forKey: displayIDKey) as? NSNumber,
           saved.intValue > 0,
           let displayID = CGDirectDisplayID(exactly: saved.intValue) {
            // Preserve the explicit choice even when disconnected. Capture must fail
            // closed instead of silently targeting the main display.
            return displayID
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

    static func persistedAllowedApplicationIdentities(
        defaults: UserDefaults = .standard
    ) -> Set<ComputerApplicationCodeIdentity> {
        guard let data = defaults.data(
            forKey: allowedApplicationIdentitiesKey
        ), let identities = try? JSONDecoder().decode(
            [ComputerApplicationCodeIdentity].self,
            from: data
        ) else {
            return []
        }
        return Set(identities)
    }

    static func persistedAllowedPolicyBundleIDs(
        defaults: UserDefaults = .standard
    ) -> Set<String> {
        persistedAllowedBundleIDs(defaults: defaults).union(
            persistedAllowedApplicationIdentities(defaults: defaults)
                .map(\.normalizedBundleID)
        )
    }

    static func setPersistedApplicationIdentity(
        _ identity: ComputerApplicationCodeIdentity,
        allowed: Bool,
        defaults: UserDefaults = .standard
    ) {
        var identities = persistedAllowedApplicationIdentities(
            defaults: defaults
        )
        identities.remove(identity)
        if allowed {
            identities.insert(identity)
            var denied = persistedDeniedBundleIDs(defaults: defaults)
            denied.remove(identity.normalizedBundleID)
            defaults.set(
                Array(denied).sorted(),
                forKey: deniedBundleIDsKey
            )
        }
        persistApplicationIdentities(identities, defaults: defaults)
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
        if decision != .allow {
            let retained = persistedAllowedApplicationIdentities(
                defaults: defaults
            ).filter {
                $0.normalizedBundleID != normalized
            }
            persistApplicationIdentities(Set(retained), defaults: defaults)
        }
    }

    private static func persistApplicationIdentities(
        _ identities: Set<ComputerApplicationCodeIdentity>,
        defaults: UserDefaults
    ) {
        let sorted = identities.sorted {
            if $0.normalizedBundleID != $1.normalizedBundleID {
                return $0.normalizedBundleID < $1.normalizedBundleID
            }
            return $0.auditFingerprint < $1.auditFingerprint
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(sorted) {
            defaults.set(data, forKey: allowedApplicationIdentitiesKey)
        } else {
            defaults.removeObject(forKey: allowedApplicationIdentitiesKey)
        }
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

    static func captureDescriptor(
        defaults: UserDefaults = .standard
    ) throws -> ComputerCaptureDescriptor {
        try ComputerCaptureDescriptor.resolve(
            selectedDisplayID: selectedDisplayID(defaults: defaults),
            geometries: activeDisplayGeometries(),
            maxLongEdge: maxLongEdge(defaults: defaults)
        )
    }

    static func activeDisplayIDs() -> [CGDirectDisplayID] {
        activeDisplayGeometries().map(\.displayID)
    }

    static func activeDisplayGeometries() -> [ComputerDisplayGeometry] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
            return []
        }
        var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else {
            return []
        }
        return displays.prefix(Int(count)).map { displayID in
            ComputerDisplayGeometry(
                displayID: displayID,
                globalBounds: CGDisplayBounds(displayID),
                pixelWidth: CGDisplayPixelsWide(displayID),
                pixelHeight: CGDisplayPixelsHigh(displayID)
            )
        }
    }
}

enum ComputerPersistedAppDecision: String, Codable {
    case allow
    case deny
}
