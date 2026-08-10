import Foundation

/// Installs PipiUI-owned skills into Application Support without touching pi's
/// user-owned `~/.pi/agent/skills` directory.
///
/// The installed tree is deliberately separate from PiExt: skills are regular
/// `dir/SKILL.md` resources rather than extensions, and a failed upgrade keeps
/// the last complete App-owned tree in place. The skill loader discovers this
/// root alongside the user's normal roots.
enum BuiltInSkillResources {
    static let resourceDirectoryName = "BuiltInSkills"
    static let installedDirectoryName = "built-in-skills"
    static let requiredRelativePaths = [
        "create-subagent/SKILL.md",
        "create-subagent/AGENT.template.md",
    ]

    static var installedURL: URL {
        installedURL(applicationSupportRoot: nil)
    }

    static func installedURL(applicationSupportRoot: URL?) -> URL {
        let root = applicationSupportRoot
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return root
            .appendingPathComponent("PipiUI", isDirectory: true)
            .appendingPathComponent(installedDirectoryName, isDirectory: true)
    }

    /// SwiftPM keeps `.copy("Resources")` beneath a `Resources` directory, while
    /// packaged apps resolve the same bundle through `PipiResourceBundle`.
    static func bundledURL(bundle: Bundle = PipiResourceBundle.shared) -> URL? {
        let candidates = [
            bundle.url(forResource: resourceDirectoryName, withExtension: nil),
            bundle.resourceURL?
                .appendingPathComponent("Resources", isDirectory: true)
                .appendingPathComponent(resourceDirectoryName, isDirectory: true),
            bundle.resourceURL?
                .appendingPathComponent(resourceDirectoryName, isDirectory: true),
        ]
        return candidates.compactMap { $0 }.first { isComplete($0) }
    }

    static func isComplete(_ root: URL, fileManager: FileManager = .default) -> Bool {
        requiredRelativePaths.allSatisfy { relativePath in
            var isDirectory: ObjCBool = false
            let path = root.appendingPathComponent(relativePath).path
            return fileManager.fileExists(atPath: path, isDirectory: &isDirectory)
                && !isDirectory.boolValue
        }
    }

    /// Stage the bundled tree beside the destination, then replace only the
    /// App-owned directory. Missing/incomplete resources and failed copies leave
    /// a prior complete install untouched; user roots are never inputs here.
    @discardableResult
    static func install(
        bundledRoot: URL? = nil,
        destination: URL? = nil,
        bundle: Bundle = PipiResourceBundle.shared,
        fileManager: FileManager = .default
    ) -> URL? {
        let dest = destination ?? installedURL
        let parent = dest.deletingLastPathComponent()

        // Only PipiUI's Application Support parent owns these temporary names. Do
        // this before looking at the bundle so abandoned installs do not survive a
        // resource lookup failure. A parent symlink is rejected rather than
        // traversed, and matching child symlinks are unlinked as entries.
        guard removeStaleInstallArtifacts(in: parent, for: dest, fileManager: fileManager) else {
            return isComplete(dest, fileManager: fileManager) ? dest : nil
        }
        guard let bundled = bundledRoot ?? bundledURL(bundle: bundle), isComplete(bundled, fileManager: fileManager) else {
            return isComplete(dest, fileManager: fileManager) ? dest : nil
        }

        let staging = parent.appendingPathComponent(
            ".\(installedDirectoryName).install-\(UUID().uuidString)",
            isDirectory: true
        )
        do {
            try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
            defer { try? fileManager.removeItem(at: staging) }
            try fileManager.copyItem(at: bundled, to: staging)
            guard isComplete(staging, fileManager: fileManager) else {
                return isComplete(dest, fileManager: fileManager) ? dest : nil
            }

            if fileManager.fileExists(atPath: dest.path) {
                _ = try fileManager.replaceItemAt(dest, withItemAt: staging)
            } else {
                try fileManager.moveItem(at: staging, to: dest)
            }
            return isComplete(dest, fileManager: fileManager) ? dest : nil
        } catch {
            return isComplete(dest, fileManager: fileManager) ? dest : nil
        }
    }

    /// Deletes only direct, installer-owned siblings. `removeItem` unlinks a
    /// symbolic-link entry rather than traversing it; rejecting a symlinked parent
    /// prevents a malicious parent path from redirecting cleanup outside PipiUI.
    private static func removeStaleInstallArtifacts(
        in parent: URL,
        for destination: URL,
        fileManager: FileManager
    ) -> Bool {
        guard isAppOwnedInstallParent(parent, for: destination) else {
            return true
        }
        do {
            try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
            guard isDirectory(parent, fileManager: fileManager), !isSymbolicLink(parent) else {
                return false
            }
            let prefix = ".\(installedDirectoryName).install-"
            let children = try fileManager.contentsOfDirectory(
                at: parent,
                includingPropertiesForKeys: [.isSymbolicLinkKey],
                options: []
            )
            for child in children where child.lastPathComponent.hasPrefix(prefix)
                && child.lastPathComponent.count > prefix.count {
                // This is intentionally a direct child URL assembled from the
                // verified parent; do not resolve it, which could follow a link.
                try fileManager.removeItem(at: child)
            }
            return true
        } catch {
            return false
        }
    }

    private static func isAppOwnedInstallParent(_ parent: URL, for destination: URL) -> Bool {
        destination.lastPathComponent == installedDirectoryName
            && parent.lastPathComponent == "PipiUI"
            && parent.deletingLastPathComponent().lastPathComponent == "Application Support"
    }

    private static func isDirectory(_ url: URL, fileManager: FileManager) -> Bool {
        var isDirectory: ObjCBool = false
        return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    private static func isSymbolicLink(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
    }
}
