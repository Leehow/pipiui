import Foundation

/// Pure helpers for global user-pinned sidebar sessions (not send-time `pinnedToTop`).
enum SessionPinLogic {
    /// Active project session list excluding user-pinned paths.
    static func activeMetas(
        from metas: [SessionMeta],
        excludingPinned pinned: Set<String>
    ) -> [SessionMeta] {
        guard !pinned.isEmpty else { return metas }
        return metas.filter { !pinned.contains($0.path) }
    }

    /// Collect pinned metas from all projects; first match wins if a path appears twice.
    static func pinnedMetas(
        sessionsByProject: [String: [SessionMeta]],
        pinned: Set<String>,
        sortBy: (SessionMeta, SessionMeta) -> Bool
    ) -> [SessionMeta] {
        guard !pinned.isEmpty else { return [] }
        var seen = Set<String>()
        var result: [SessionMeta] = []
        for metas in sessionsByProject.values {
            for meta in metas where pinned.contains(meta.path) && !seen.contains(meta.path) {
                seen.insert(meta.path)
                result.append(meta)
            }
        }
        result.sort(by: sortBy)
        return result
    }

    /// Resolve owning project path via pi session directory prefix.
    static func projectPath(
        forSessionPath sessionPath: String,
        projects: [URL],
        sessionDirectory: (String) -> URL
    ) -> String? {
        for project in projects {
            let dir = sessionDirectory(project.path).path
            let prefix = dir.hasSuffix("/") ? dir : dir + "/"
            if sessionPath == dir || sessionPath.hasPrefix(prefix) {
                return project.path
            }
        }
        return nil
    }
}
