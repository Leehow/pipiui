import Foundation
import AppKit
import Combine

struct SessionMeta: Identifiable, Hashable {
    let path: String
    let name: String
    let modified: Date
    var id: String { path }
}

enum SessionInitialTranscriptSeed {
    static func select(
        sessionPath: String?,
        cachedTranscript: InitialTranscriptBuild?
    ) -> InitialTranscriptBuild? {
        guard sessionPath != nil else {
            return InitialTranscriptBuild(
                items: [],
                toolRuns: [:],
                itemCounter: 0,
                skipNextAssistantIngest: false
            )
        }
        return cachedTranscript
    }
}

/// Global app state: project folders, discovered pi sessions, open RPC sessions.
final class AppStore: ObservableObject {
    static let shared = AppStore()
    private static let projectsKey = "pipiui.projects"
    private static let archivedSessionsKey = "pipiui.archivedSessions"
    private static let pinnedSessionsKey = "pipiui.pinnedSessions"
    private static let pinnedProjectsKey = "pipiui.pinnedProjects"
    private static let projectDisplayNamesKey = "pipiui.projectDisplayNames"
    private static let lastProjectKey = "pipiui.lastProjectPath"
    private static let lastSessionFileKey = "pipiui.lastSessionFile"
    private static let lastSessionProjectKey = "pipiui.lastSessionProject"

    @Published var projects: [URL] = []
    /// Project-specific sidebar preferences, persisted separately from project
    /// paths so reordering pins never changes the user's configured project order.
    @Published private(set) var pinnedProjectPaths: Set<String> = []
    @Published private(set) var projectDisplayNameOverrides: [String: String] = [:]
    @Published var selectedProjectPath: String? {
        didSet {
            guard selectedProjectPath != oldValue else { return }
            UserDefaults.standard.set(selectedProjectPath, forKey: Self.lastProjectKey)
            scheduleHistoryPreload()
        }
    }
    @Published var sessionsByProject: [String: [SessionMeta]] = [:]
    /// 各项目下已归档会话（扫盘得到，path 在 archivedSessionPaths 且文件仍存在）
    @Published var archivedByProject: [String: [SessionMeta]] = [:]
    @Published var openSessions: [String: ChatSession] = [:]
    @Published var selectedSessionKey: String? {
        didSet {
            // 记住最后选中的会话，下次启动直接恢复；新会话尚无文件时保留上一条记录。
            if let key = selectedSessionKey,
               let file = openSessions[key]?.sessionFile ?? sessionFileFromKey(key) {
                UserDefaults.standard.set(file, forKey: Self.lastSessionFileKey)
                UserDefaults.standard.set(openSessions[key]?.projectURL.path ?? selectedProjectPath,
                                          forKey: Self.lastSessionProjectKey)
            }
            guard selectedSessionKey != oldValue, let key = selectedSessionKey else { return }
            // TEMP SWITCH PERF: measure how long a sidebar switch blocks the main thread.
            Self.lastSwitchAt = CFAbsoluteTimeGetCurrent()
            let warm = openSessions[key] != nil
            Log.info("switch start → \(key) warm=\(warm)", category: .session)
            openSessions[key]?.markCompletionSeen()
        }
    }

    /// TEMP SWITCH PERF: remove after the "卡一下" measurement settles.
    static var lastSwitchAt: CFAbsoluteTime = 0
    @Published private(set) var archivedSessionPaths: Set<String> = []
    /// User-pinned session jsonl paths (global). Distinct from send-time `pinnedToTop`.
    @Published private(set) var userPinnedSessionPaths: Set<String> = []
    /// Session jsonl paths mid-turn when last quit; sidebar red「已中断」badge.
    @Published private(set) var interruptedSessionPaths: Set<String> = InterruptedSessionStore.paths()

    /// 撞名扩展（会让 pi 直接 exit(1)），按会话 key 记录，供 UI 提示与一键修复
    @Published private(set) var extensionConflicts: [String: [PiExtensionConflict]] = [:]
    /// 用户选择忽略的冲突入口，本次运行内不再提示
    private var ignoredConflicts: Set<String> = []

    /// 首次恢复历史会话前的一个短暂排队标记。让侧栏可以先更新选中态，
    /// 同时保证连续点击同一条历史会话不会排队启动多个 pi 进程。
    private var pendingHistoricalSessionOpens: [String: (token: UUID, projectPath: String)] = [:]

    /// Optimistic "pin to top" timestamps keyed by session jsonl path.
    /// Used so a just-sent session stays above disk-mtime ordering until closed/archived.
    private var pinnedToTop: [String: Date] = [:]

    /// 整体 UI 缩放（含文字），Cmd+= / Cmd+- / Cmd+0 调节
    @Published var uiScale: Double = {
        let saved = UserDefaults.standard.double(forKey: "pipiui.uiScale")
        return saved == 0 ? 1.0 : saved
    }()

    func setUIScale(_ scale: Double) {
        uiScale = min(1.8, max(0.6, (scale * 10).rounded() / 10))
        UserDefaults.standard.set(uiScale, forKey: "pipiui.uiScale")
    }

    /// Chat body font size (pt). Independent of whole-window `uiScale`.
    @Published var chatFontSize: Double = {
        let key = "pipiui.chatFontSize"
        guard UserDefaults.standard.object(forKey: key) != nil else {
            return Double(ChatTypography.defaultFontSize)
        }
        return Double(ChatTypography.sanitizedFontSize(CGFloat(UserDefaults.standard.double(forKey: key))))
    }()

    func setChatFontSize(_ size: Double) {
        chatFontSize = Double(ChatTypography.sanitizedFontSize(CGFloat(size)))
        UserDefaults.standard.set(chatFontSize, forKey: "pipiui.chatFontSize")
    }

    var currentSession: ChatSession? {
        selectedSessionKey.flatMap { openSessions[$0] }
    }

    var selectedProject: URL? {
        projects.first { $0.path == selectedProjectPath }
    }

    /// Pinned projects are grouped first, with the original configured order
    /// retained inside both the pinned and unpinned groups.
    var orderedProjects: [URL] {
        projects.filter { pinnedProjectPaths.contains($0.path) }
            + projects.filter { !pinnedProjectPaths.contains($0.path) }
    }

    func projectDisplayName(for project: URL) -> String {
        projectDisplayNameOverrides[project.path] ?? project.lastPathComponent
    }

    private var bridge: BridgeServer?
    private var plugin = PiPlugin.Installed()
    /// Immutable JSONL snapshots only. This cache never constructs ChatSession/PiProcess.
    private let historyPreloader = SessionHistoryPreloader()

    /// Boss 模式：新会话以「大组长」协议启动（不亲自干活，全部派 subagent）
    @Published var bossModeEnabled: Bool = UserDefaults.standard.object(forKey: "pipiui.bossMode") as? Bool ?? true {
        didSet { UserDefaults.standard.set(bossModeEnabled, forKey: "pipiui.bossMode") }
    }

    /// Bumped when model picker visibility preferences change so InputBar refreshes.
    @Published var modelVisibilityRevision: Int = 0
    /// Bumped when skill enable/disable toggles change so slash menu refreshes.
    @Published var skillVisibilityRevision: Int = 0

    /// Restart every open pi RPC process so auth.json changes take effect.
    func restartAllOpenSessions() {
        for key in Array(openSessions.keys) {
            restartSession(key: key)
        }
    }

    /// 会话 key 形如 "resume:<session 文件路径>"，选中时尚未 spawn 完也能拿到文件路径。
    private func sessionFileFromKey(_ key: String) -> String? {
        key.hasPrefix("resume:") ? String(key.dropFirst("resume:".count)) : nil
    }

    private init() {
        let paths = UserDefaults.standard.stringArray(forKey: Self.projectsKey) ?? []
        projects = paths.map { URL(fileURLWithPath: $0) }
        let projectPaths = Set(projects.map(\.path))
        pinnedProjectPaths = Set(UserDefaults.standard.stringArray(forKey: Self.pinnedProjectsKey) ?? [])
            .intersection(projectPaths)
        projectDisplayNameOverrides = Self.sanitizedProjectDisplayNameOverrides(
            UserDefaults.standard.dictionary(forKey: Self.projectDisplayNamesKey) as? [String: String] ?? [:],
            projectPaths: projectPaths
        )
        persistProjectSidebarPreferences()
        let savedProject = UserDefaults.standard.string(forKey: Self.lastProjectKey)
        selectedProjectPath = projects.contains(where: { $0.path == savedProject })
            ? savedProject : projects.first?.path
        archivedSessionPaths = Set(UserDefaults.standard.stringArray(forKey: Self.archivedSessionsKey) ?? [])
        userPinnedSessionPaths = Set(UserDefaults.standard.stringArray(forKey: Self.pinnedSessionsKey) ?? [])
        for p in projects { refreshSessions(for: p) }

        // 启动即恢复关闭前选中的会话（文件还在且未被归档才恢复）。
        if let file = UserDefaults.standard.string(forKey: Self.lastSessionFileKey),
           let projectPath = UserDefaults.standard.string(forKey: Self.lastSessionProjectKey),
           !archivedSessionPaths.contains(file),
           let meta = sessionsByProject[projectPath]?.first(where: { $0.path == file }) {
            let project = URL(fileURLWithPath: projectPath)
            DispatchQueue.main.async { [weak self] in
                self?.openSession(meta, project: project)
            }
        }

        plugin = PiPlugin.installAll()
        SubagentModelSettings.syncJSONFile()
        ToolSkillSettings.syncJSONFile()
        WebSearchSettings.syncJSONFile()

        // T20: 一次性把 auth.json / UserDefaults / 旧 websearch-config.json 里的
        // API key 迁到 ~/.pi/agent/.env。幂等；全程后台队列，主线程零 I/O。
        DispatchQueue.global(qos: .utility).async {
            AuthMigration.migrateIfNeeded()
        }
        bridge = BridgeServer { request, respond in
            // Handler 已在主线程；按 sessionKey 精确路由到对应会话。
            // 未知/已关闭 key 必须拒绝，避免子 agent 孤儿请求落到「当前选中」会话上乱 eval。
            let store = AppStore.shared
            let key = request["sessionKey"].string ?? ""
            guard !key.isEmpty,
                  let session = store.openSessions[key]
                    ?? store.openSessions.values.first(where: { $0.bridgeRoutingKey == key }) else {
                respond(["ok": false, "error": "unknown session key"])
                return
            }
            let action = request["action"].string ?? ""
            if action == "agent_event" {
                session.subagents.handle(request)
                if session.rightPanel == nil {
                    session.subagents.selectLatest()
                    session.rightPanel = .agents
                }
                respond(["ok": true])
                return
            }
            if action == "navigate", session.rightPanel != .web {
                session.rightPanel = .web
            }
            session.webView.handle(action: action, request: request, respond: respond)
        }

        // 调试/自动化钩子：启动时自动打开指定项目并新建会话
        if let autoPath = ProcessInfo.processInfo.environment["PIPIUI_AUTO_SESSION"] {
            DispatchQueue.main.async { [weak self] in
                let url = URL(fileURLWithPath: autoPath)
                self?.addProject(url)
                self?.newSession(project: url)
                if ProcessInfo.processInfo.environment["PIPIUI_MD_DEMO"] != nil {
                    self?.currentSession?.appendDebugAssistant(Self.markdownDemo)
                }
            }
        }
    }

    private func makeSession(
        key: String,
        project: URL,
        sessionPath: String?,
        preloadedTranscript: InitialTranscriptBuild? = nil
    ) -> ChatSession {
        // spawn 前自检：撞名扩展会让 pi 直接退出，先把它变成可修复的提示而不是一行崩溃日志。
        // T11: 主路径只做便宜的 stamp 检查 + 缓存命中；未缓存时先放行 spawn，
        // 全量扫描挪后台，结果回来真有冲突再把会话切成 blocked 态提示修复。
        let cachedConflicts = PiExtensionConflicts.cached(projectDir: project)
        let conflicts = (cachedConflicts ?? []).filter { !ignoredConflicts.contains($0.entryPath) }
        if conflicts.isEmpty {
            extensionConflicts.removeValue(forKey: key)
        } else {
            extensionConflicts[key] = conflicts
        }
        if cachedConflicts == nil {
            PiExtensionConflicts.detectAsync(projectDir: project) { [weak self] found in
                self?.applyLateDetectedConflicts(found, key: key)
            }
        }

        let cachedTranscript = preloadedTranscript ?? sessionPath.flatMap {
            historyPreloader.snapshotIfCurrent(path: $0)?.transcript
        }
        let initialTranscript = SessionInitialTranscriptSeed.select(
            sessionPath: sessionPath,
            cachedTranscript: cachedTranscript
        )
        let session = ChatSession(
            id: key, projectURL: project, sessionPath: sessionPath,
            bridgePort: bridge?.port ?? 0,
            webviewExtension: plugin.webviewExtension,
            mediaExtension: plugin.mediaExtension,
            gitExtension: plugin.gitExtension,
            reloadExtension: plugin.reloadExtension,
            webSearchExtension: plugin.webSearchExtension,
            codexServerToolsExtension: plugin.codexServerToolsExtension,
            claudeServerToolsExtension: plugin.claudeServerToolsExtension,
            subagentDir: plugin.subagentDir,
            agentsDir: plugin.agentsDir,
            bossPromptPath: bossModeEnabled ? plugin.bossPrompt : nil,
            blockedReason: conflicts.isEmpty ? nil
                : "扩展撞名，pi 未启动。修复上方冲突后会自动重启会话。",
            initialTranscript: initialTranscript
        )
        session.onSessionMetaChanged = { [weak self, weak session] in
            guard let self, let session else { return }
            // 乐观插入：sessionFile 一到立刻进侧边栏磁盘列表，避免 refresh 异步扫描空窗导致选中行消失
            if let file = session.sessionFile {
                self.upsertLiveSessionMeta(
                    project: project,
                    file: file,
                    name: session.sessionName ?? "新会话"
                )
            }
            self.refreshSessions(for: project)
        }
        session.onUserSubmitted = { [weak self, weak session] in
            guard let self, let session else { return }
            // Only pin when session file is known; brand-new sessions already insert at top via upsert.
            guard let file = session.sessionFile, !file.isEmpty else { return }
            self.pinnedToTop[file] = Date()
            let projectPath = project.path
            var metas = self.sessionsByProject[projectPath] ?? []
            metas.sort { self.effectiveModified($0) > self.effectiveModified($1) }
            self.sessionsByProject[projectPath] = metas
        }
        session.onSessionFileRebound = { [weak self] oldPath, newPath in
            self?.rebindOpenSessionFile(from: oldPath, to: newPath)
        }
        session.onBranchedSessionReady = { [weak self, weak session] newPath in
            guard let self, let session else { return }
            let suggestedName = Self.branchSessionName(from: session.sessionName)
            self.openBranchedSession(
                path: newPath,
                project: session.projectURL,
                suggestedName: suggestedName
            )
        }
        // Object identity survives edit-fork rebind (captured `key` would go stale).
        session.isSelectedCheck = { [weak self, weak session] in
            guard let self, let session else { return false }
            return self.currentSession === session
        }
        session.onInFlightChange = { [weak self] path, inFlight in
            self?.applyInFlightChange(path: path, inFlight: inFlight)
        }
        session.onRequestNewSession = { [weak self] in
            guard let self else { return }
            self.newSession(project: project)
        }
        session.onRequestClose = { [weak self, weak session] in
            guard let self, let session,
                  let currentKey = self.openSessions.first(where: { $0.value === session })?.key else {
                return
            }
            self.closeSession(key: currentKey)
        }
        return session
    }

    /// Keep a resumed tab bound to the file created by an edit-fork.
    func rebindOpenSessionFile(from oldPath: String, to newPath: String) {
        guard !oldPath.isEmpty, !newPath.isEmpty, oldPath != newPath else { return }

        let oldKey = "resume:\(oldPath)"
        let newKey = "resume:\(newPath)"
        let session = openSessions[oldKey]
            ?? openSessions.values.first(where: { $0.sessionFile == newPath })
        guard let session else { return }

        if openSessions[oldKey] === session {
            openSessions.removeValue(forKey: oldKey)
            session.rebindIdentity(to: newKey)
            openSessions[newKey] = session
            if selectedSessionKey == oldKey {
                selectedSessionKey = newKey
            }
            if let conflicts = extensionConflicts.removeValue(forKey: oldKey) {
                extensionConflicts[newKey] = conflicts
            }
        }

        upsertLiveSessionMeta(
            project: session.projectURL,
            file: newPath,
            name: session.sessionName ?? "新会话"
        )
        refreshSessions(for: session.projectURL)
    }

    private func applyInFlightChange(path: String, inFlight: Bool) {
        var next = interruptedSessionPaths
        if inFlight {
            next.insert(path)
        } else {
            next.remove(path)
        }
        if next != interruptedSessionPaths {
            interruptedSessionPaths = next
        }
    }

    private func persistProjects() {
        UserDefaults.standard.set(projects.map(\.path), forKey: Self.projectsKey)
    }

    private func persistArchivedSessions() {
        UserDefaults.standard.set(Array(archivedSessionPaths).sorted(), forKey: Self.archivedSessionsKey)
    }

    private func persistPinnedSessions() {
        UserDefaults.standard.set(Array(userPinnedSessionPaths).sorted(), forKey: Self.pinnedSessionsKey)
    }

    private func persistProjectSidebarPreferences() {
        UserDefaults.standard.set(Array(pinnedProjectPaths).sorted(), forKey: Self.pinnedProjectsKey)
        UserDefaults.standard.set(projectDisplayNameOverrides, forKey: Self.projectDisplayNamesKey)
    }

    /// Stable grouping used by the sidebar and unit tests.
    static func orderedProjectPaths(_ paths: [String], pinnedPaths: Set<String>) -> [String] {
        paths.filter { pinnedPaths.contains($0) } + paths.filter { !pinnedPaths.contains($0) }
    }

    /// Removes stale project-name preference entries and normalizes saved titles.
    static func sanitizedProjectDisplayNameOverrides(
        _ overrides: [String: String],
        projectPaths: Set<String>
    ) -> [String: String] {
        Dictionary(uniqueKeysWithValues: overrides.compactMap { path, name in
            guard projectPaths.contains(path) else { return nil }
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return (path, trimmed)
        })
    }

    // MARK: - User pin (global sidebar section)

    func isSessionPinned(_ path: String) -> Bool {
        userPinnedSessionPaths.contains(path)
    }

    func pinSession(path: String) {
        guard !path.isEmpty, !archivedSessionPaths.contains(path) else { return }
        guard !userPinnedSessionPaths.contains(path) else { return }
        userPinnedSessionPaths.insert(path)
        persistPinnedSessions()
    }

    func unpinSession(path: String) {
        guard userPinnedSessionPaths.contains(path) else { return }
        userPinnedSessionPaths.remove(path)
        persistPinnedSessions()
    }

    func togglePinSession(path: String) {
        if isSessionPinned(path) {
            unpinSession(path: path)
        } else {
            pinSession(path: path)
        }
    }

    /// Pinned metas across all projects, newest activity first.
    var pinnedSessionMetas: [SessionMeta] {
        SessionPinLogic.pinnedMetas(
            sessionsByProject: sessionsByProject,
            pinned: userPinnedSessionPaths,
            sortBy: { effectiveModified($0) > effectiveModified($1) }
        )
    }

    /// Archived rows retain their owning project so the global sidebar section
    /// can restore/unarchive them without losing context.
    var archivedSessionMetas: [(meta: SessionMeta, project: URL)] {
        projects
            .flatMap { project in
                (archivedByProject[project.path] ?? []).map { (meta: $0, project: project) }
            }
            .sorted { lhs, rhs in
                effectiveModified(lhs.meta) > effectiveModified(rhs.meta)
            }
    }

    func project(forSessionPath path: String) -> URL? {
        guard let projectPath = SessionPinLogic.projectPath(
            forSessionPath: path,
            projects: projects,
            sessionDirectory: Self.sessionDirectory(forCwd:)
        ) else { return nil }
        return projects.first { $0.path == projectPath }
    }

    // MARK: - Projects

    func addProjectViaPanel() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "添加项目"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        addProject(url)
    }

    func addProject(_ url: URL) {
        guard !projects.contains(where: { $0.path == url.path }) else {
            selectedProjectPath = url.path
            return
        }
        projects.append(url)
        selectedProjectPath = url.path
        persistProjects()
        refreshSessions(for: url)
    }

    func isProjectPinned(_ project: URL) -> Bool {
        pinnedProjectPaths.contains(project.path)
    }

    func toggleProjectPin(_ project: URL) {
        guard projects.contains(where: { $0.path == project.path }) else { return }
        if pinnedProjectPaths.contains(project.path) {
            pinnedProjectPaths.remove(project.path)
        } else {
            pinnedProjectPaths.insert(project.path)
        }
        persistProjectSidebarPreferences()
    }

    /// Reorders projects inside their visible pin group. Pinned projects remain
    /// ahead of unpinned projects, while their individual order is persisted in
    /// the same project-path preference used at launch.
    @discardableResult
    func moveProject(path: String, before destinationPath: String) -> Bool {
        guard path != destinationPath,
              let source = projects.first(where: { $0.path == path }),
              let destination = projects.first(where: { $0.path == destinationPath }) else {
            return false
        }
        let isPinned = pinnedProjectPaths.contains(source.path)
        guard pinnedProjectPaths.contains(destination.path) == isPinned else { return false }

        var group = projects.filter { pinnedProjectPaths.contains($0.path) == isPinned }
        guard let sourceIndex = group.firstIndex(where: { $0.path == source.path }),
              let destinationIndex = group.firstIndex(where: { $0.path == destination.path }) else {
            return false
        }
        group.remove(at: sourceIndex)
        let insertionIndex = sourceIndex < destinationIndex ? destinationIndex - 1 : destinationIndex
        group.insert(source, at: insertionIndex)

        var iterator = group.makeIterator()
        projects = projects.map { project in
            pinnedProjectPaths.contains(project.path) == isPinned ? iterator.next()! : project
        }
        persistProjects()
        return true
    }

    func renameProject(_ project: URL, to name: String) {
        guard projects.contains(where: { $0.path == project.path }) else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if trimmed == project.lastPathComponent {
            projectDisplayNameOverrides.removeValue(forKey: project.path)
        } else {
            projectDisplayNameOverrides[project.path] = trimmed
        }
        persistProjectSidebarPreferences()
    }

    func removeProject(_ url: URL) {
        // Close every live session under this project so pi/subagent processes stop.
        let keys = openSessions.compactMap { key, session -> String? in
            session.projectURL.path == url.path ? key : nil
        }
        for key in keys {
            closeSession(key: key)
        }
        let pendingKeys = pendingHistoricalSessionOpens.compactMap { key, pending in
            pending.projectPath == url.path ? key : nil
        }
        for key in pendingKeys {
            closeSession(key: key)
        }
        // Drop global pins that belonged to this project's session directory.
        let dirPrefix: String = {
            let dir = Self.sessionDirectory(forCwd: url.path).path
            return dir.hasSuffix("/") ? dir : dir + "/"
        }()
        let before = userPinnedSessionPaths.count
        userPinnedSessionPaths = userPinnedSessionPaths.filter { path in
            !(path == Self.sessionDirectory(forCwd: url.path).path || path.hasPrefix(dirPrefix))
        }
        if userPinnedSessionPaths.count != before {
            persistPinnedSessions()
        }
        projects.removeAll { $0.path == url.path }
        pinnedProjectPaths.remove(url.path)
        projectDisplayNameOverrides.removeValue(forKey: url.path)
        persistProjectSidebarPreferences()
        persistProjects()
        if selectedProjectPath == url.path {
            selectedProjectPath = projects.first?.path
        }
    }

    // MARK: - Session discovery (~/.pi/agent/sessions)

    /// Sort key: max(disk mtime, optimistic pin time).
    private func effectiveModified(_ m: SessionMeta) -> Date {
        max(m.modified, pinnedToTop[m.path] ?? .distantPast)
    }

    /// pi 的会话目录命名规则：`--` + cwd 去掉开头斜杠、`/ \ :` 全部换成 `-` + `--`
    static func sessionDirectory(forCwd cwd: String) -> URL {
        var escaped = cwd
        if escaped.hasPrefix("/") || escaped.hasPrefix("\\") { escaped.removeFirst() }
        escaped = escaped.map { ch -> String in
            (ch == "/" || ch == "\\" || ch == ":") ? "-" : String(ch)
        }.joined()
        return URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".pi/agent/sessions/--\(escaped)--")
    }

    /// T7: 增量扫描缓存——projectPath → (session 文件路径 → (mtime, name, ephemeral))。
    /// 只有新增或 mtime 变化的文件才重新读内容解析 name/ephemeral，其余复用上次结果。
    private var sessionScanCache: [String: [String: (mtime: Date, name: String, ephemeral: Bool)]] = [:]
    private let sessionScanCacheLock = NSLock()
    /// Projects with at least one completed metadata scan may warm independently.
    private var completedSessionScans: Set<String> = []

    private func scheduleHistoryPreload() {
        let readyProjects = SessionHistoryPreloadPlan.readyProjects(
            projects,
            completedProjectPaths: completedSessionScans
        )
        guard !readyProjects.isEmpty else { return }
        let preferredSessionPath = UserDefaults.standard.string(forKey: Self.lastSessionFileKey)
        let candidates = SessionHistoryPreloadPlan.candidates(
            projects: readyProjects,
            sessionsByProject: sessionsByProject,
            selectedProjectPath: selectedProjectPath,
            preferredSessionPath: preferredSessionPath,
            archivedPaths: archivedSessionPaths
        )
        guard !candidates.isEmpty else { return }

        let selectedCandidates: Set<String>
        if let selectedProjectPath,
           let selectedProject = readyProjects.first(where: { $0.path == selectedProjectPath }) {
            selectedCandidates = Set(SessionHistoryPreloadPlan.candidates(
                projects: [selectedProject],
                sessionsByProject: sessionsByProject,
                selectedProjectPath: selectedProjectPath,
                preferredSessionPath: nil,
                archivedPaths: archivedSessionPaths
            ))
        } else {
            selectedCandidates = []
        }

        let preferred = candidates.filter { $0 == preferredSessionPath }
        let selected = candidates.filter {
            $0 != preferredSessionPath && selectedCandidates.contains($0)
        }
        let remaining = candidates.filter {
            $0 != preferredSessionPath && !selectedCandidates.contains($0)
        }
        historyPreloader.preload(paths: preferred, queuePriority: .veryHigh)
        historyPreloader.preload(paths: selected, queuePriority: .high)
        historyPreloader.preload(paths: remaining)
    }

    func refreshSessions(for project: URL) {
        let dir = Self.sessionDirectory(forCwd: project.path)
        let projectPath = project.path
        let archived = archivedSessionPaths
        sessionScanCacheLock.lock()
        let cachedEntries = sessionScanCache[projectPath] ?? [:]
        sessionScanCacheLock.unlock()
        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            let files = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]))?
                .filter { $0.pathExtension == "jsonl" } ?? []
            var active: [SessionMeta] = []
            var archivedMetas: [SessionMeta] = []
            var newCache: [String: (mtime: Date, name: String, ephemeral: Bool)] = [:]
            newCache.reserveCapacity(files.count)
            for url in files {
                let path = url.path
                let mtime = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                // 增量：mtime 未变直接复用上次的 name/ephemeral，不重复读文件内容
                let entry: (name: String, ephemeral: Bool)
                if let hit = cachedEntries[path], hit.mtime == mtime {
                    entry = (hit.name, hit.ephemeral)
                } else if Self.isEphemeralTitlePromptSession(url) {
                    entry = ("", true)
                } else {
                    entry = (Self.sessionDisplayName(url), false)
                }
                newCache[path] = (mtime: mtime, name: entry.name, ephemeral: entry.ephemeral)
                // Skip orphan side-channel title-gen sessions (pi ran without --no-session).
                if entry.ephemeral { continue }
                let meta = SessionMeta(path: path, name: entry.name, modified: mtime)
                if archived.contains(path) {
                    archivedMetas.append(meta)
                } else {
                    active.append(meta)
                }
            }
            self.sessionScanCacheLock.lock()
            self.sessionScanCache[projectPath] = newCache
            self.sessionScanCacheLock.unlock()
            active.sort { $0.modified > $1.modified }
            archivedMetas.sort { $0.modified > $1.modified }
            DispatchQueue.main.async {
                // 合并仍 open 但磁盘扫描尚未见到的 sessionFile（扫盘竞态），避免乐观行被刷掉
                var merged = active
                let scannedPaths = Set(active.map(\.path))
                let previous = self.sessionsByProject[projectPath] ?? []
                for open in self.openSessions.values where open.projectURL.path == projectPath {
                    guard let file = open.sessionFile,
                          !scannedPaths.contains(file),
                          !archived.contains(file) else { continue }
                    if let keep = previous.first(where: { $0.path == file }) {
                        merged.append(keep)
                    } else {
                        let name = open.sessionName?.trimmingCharacters(in: .whitespacesAndNewlines)
                        merged.append(SessionMeta(
                            path: file,
                            name: (name?.isEmpty == false ? name! : "新会话"),
                            modified: Date()
                        ))
                    }
                }
                merged.sort { self.effectiveModified($0) > self.effectiveModified($1) }
                // 主线程 apply 时用最新 archived 再滤，避免乱序 refresh 把已归档会话写回列表
                let liveArchived = self.archivedSessionPaths
                merged.removeAll { liveArchived.contains($0.path) }
                self.sessionsByProject[projectPath] = merged

                // 归档列表：扫盘结果 + 最新 archived 校正（只含本项目扫到的文件）
                var archivedList = archivedMetas.filter { liveArchived.contains($0.path) }
                // 乐观归档后扫盘尚未含该文件时，保留上一轮/乐观条目
                let archivedScanned = Set(archivedList.map(\.path))
                let previousArchived = self.archivedByProject[projectPath] ?? []
                for keep in previousArchived where liveArchived.contains(keep.path) && !archivedScanned.contains(keep.path) {
                    archivedList.append(keep)
                }
                // 从 previous 活跃列表补上刚被 liveArchived 滤掉、扫盘还没进归档侧的 path
                let archivedPathsNow = Set(archivedList.map(\.path))
                for prev in previous where liveArchived.contains(prev.path) && !archivedPathsNow.contains(prev.path) {
                    archivedList.append(prev)
                }
                archivedList.sort { self.effectiveModified($0) > self.effectiveModified($1) }
                self.archivedByProject[projectPath] = archivedList
                self.completedSessionScans.insert(projectPath)
                self.scheduleHistoryPreload()
            }
        }
    }

    /// 立刻把 live session 的文件路径写进侧边栏 metas（主线程），异步 refresh 会用真实 mtime/name 覆盖。
    /// Does NOT bump modified for existing sessions — ordering changes only via user submit pin or disk mtime.
    func upsertLiveSessionMeta(project: URL, file: String, name: String) {
        guard !archivedSessionPaths.contains(file) else { return }
        let projectPath = project.path
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = trimmed.isEmpty ? "新会话" : trimmed
        var metas = sessionsByProject[projectPath] ?? []
        if let idx = metas.firstIndex(where: { $0.path == file }) {
            let old = metas[idx]
            // Don't clobber a real title with placeholder / "新会话".
            let keptName = SessionTitleLogic.isPlaceholderName(displayName) ? old.name : displayName
            metas[idx] = SessionMeta(path: file, name: keptName, modified: old.modified)
        } else {
            // New session: optimistic insert at top with fresh timestamp.
            metas.insert(SessionMeta(path: file, name: displayName, modified: Date()), at: 0)
        }
        sessionsByProject[projectPath] = metas
    }

    /// True when this jsonl is a polluted side-channel title-generation session
    /// (first user message is the SessionTitleClient prompt fingerprint).
    private static func isEphemeralTitlePromptSession(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        // Title-prompt sessions are tiny; a modest prefix is enough to find the first user line.
        let data = handle.readData(ofLength: 64_000)
        guard let text = String(data: data, encoding: .utf8) else { return false }
        let fingerprint = SessionTitleClient.titlePromptFingerprint
        for line in text.split(separator: "\n") {
            guard line.contains("\"role\":\"user\"") else { continue }
            guard let j = J.parse(Data(line.utf8)), j["type"].string == "message" else { continue }
            let t = ChatSession.contentText(j["message"]["content"])
            if t.contains(fingerprint) { return true }
            // First real user message is decisive: only the title prompt matches this fingerprint.
            if !t.isEmpty { return false }
        }
        return false
    }

    /// 会话显示名：最后一条非 junk session_info name，否则第一条非 internal user 消息，否则「新会话」（不回退 ISO 文件名）。
    private static func sessionDisplayName(_ url: URL) -> String {
        let fileBase = url.deletingPathExtension().lastPathComponent
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return Self.displayNameFallback(fileBase: fileBase)
        }
        defer { try? handle.close() }
        let data = handle.readData(ofLength: 1_000_000)
        guard let text = String(data: data, encoding: .utf8) else {
            return Self.displayNameFallback(fileBase: fileBase)
        }

        var name: String?
        var firstUserText: String?
        for line in text.split(separator: "\n") {
            if line.contains("\"type\":\"session_info\"") {
                if let j = J.parse(Data(line.utf8)), let n = j["name"].string, !n.isEmpty {
                    // Ignore junk auto titles (ISO filenames, paths, placeholders, internal).
                    if !SessionTitleLogic.isJunkAutoTitle(n) {
                        name = n
                    }
                }
            } else if firstUserText == nil, line.contains("\"role\":\"user\"") {
                if let j = J.parse(Data(line.utf8)), j["type"].string == "message" {
                    let t = ChatSession.contentText(j["message"]["content"])
                    // Skip ghost title prompts and other PipiUI internal user lines.
                    if t.contains("[PipiUI internal") || t.contains("PipiUI internal") {
                        continue
                    }
                    if t.contains(SessionTitleClient.titlePromptFingerprint)
                        || t.contains("Write a short session title") {
                        continue
                    }
                    if !t.isEmpty {
                        let snippet = String(t.prefix(60))
                        if !SessionTitleLogic.isJunkAutoTitle(snippet) {
                            firstUserText = snippet
                        }
                    }
                }
            }
        }
        if let name { return name }
        if let firstUserText { return firstUserText }
        return Self.displayNameFallback(fileBase: fileBase)
    }

    /// Prefer「新会话」over raw ISO session filenames like `2026-07-23T15-31-40-489Z_…`.
    private static func displayNameFallback(fileBase: String) -> String {
        if fileBase.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}"#, options: .regularExpression) != nil {
            return SessionTitleLogic.placeholderName
        }
        if SessionTitleLogic.isJunkAutoTitle(fileBase) {
            return SessionTitleLogic.placeholderName
        }
        return fileBase
    }

    // MARK: - Open / create sessions

    func openSession(_ meta: SessionMeta, project: URL) {
        let key = "resume:\(meta.path)"
        // 历史会话第一次打开后始终使用这个稳定 key；重复点击不必扫描所有 live session。
        if openSessions[key] != nil {
            selectedSessionKey = key
            return
        }
        // 已经有进程挂着这个会话文件时直接切换过去
        if let existing = openSessions.first(where: { $0.value.sessionFile == meta.path }) {
            selectedSessionKey = existing.key
            return
        }

        // 先让 List/详情区域消费新的 selection；首次启动 pi 和扩展冲突扫描
        // 会在下一次主循环执行。已加载过的会话已经在 openSessions 中，会走上面的
        // 立即返回路径，不会重启 pi 或再次 get_messages。
        selectedSessionKey = key
        guard pendingHistoricalSessionOpens[key] == nil else { return }
        let token = UUID()
        pendingHistoricalSessionOpens[key] = (token, project.path)
        historyPreloader.loadPrioritized(path: meta.path) { [weak self] snapshot in
            guard let self,
                  self.pendingHistoricalSessionOpens[key]?.token == token else { return }
            self.pendingHistoricalSessionOpens.removeValue(forKey: key)
            // 归档、移除项目或关闭会话可能发生在这个短暂的排队窗口内。
            guard !self.archivedSessionPaths.contains(meta.path),
                  self.projects.contains(where: { $0.path == project.path }),
                  self.openSessions[key] == nil else { return }
            self.openSessions[key] = self.makeSession(
                key: key,
                project: project,
                sessionPath: meta.path,
                preloadedTranscript: snapshot?.transcript
            )
        }
    }

    func newSession(project: URL) {
        let key = "new:\(UUID().uuidString)"
        openSessions[key] = makeSession(key: key, project: project, sessionPath: nil)
        selectedSessionKey = key
    }

    func openBranchedSession(path: String, project: URL, suggestedName: String) {
        guard !path.isEmpty else { return }
        let key = "resume:\(path)"
        if openSessions[key] == nil {
            openSessions[key] = makeSession(key: key, project: project, sessionPath: path)
        }
        selectedSessionKey = key
        upsertLiveSessionMeta(project: project, file: path, name: suggestedName)
        refreshSessions(for: project)

        // The resumed process needs a moment to finish startup before accepting rename RPCs.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.openSessions[key]?.setSessionName(suggestedName)
        }
    }

    package static func branchSessionName(
        from currentName: String?,
        date: Date = Date(),
        timeZone: TimeZone = .current
    ) -> String {
        let base = currentName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let label: String
        if let base, !base.isEmpty, !SessionTitleLogic.isPlaceholderName(base) {
            label = "分支 · \(base)"
        } else {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = timeZone
            formatter.dateFormat = "HHmmss"
            label = "分支 · \(formatter.string(from: date))"
        }
        return label.count > 40 ? String(label.prefix(39)) + "…" : label
    }

    // MARK: - 扩展冲突

    /// 后台全量检测结果回流（主线程）：真有冲突时弹出可修复提示。
    /// 会话此时已经 spawn——真冲突下 pi 会自己 exit(1)，这里只负责给出修复入口，
    /// 不再杀进程重启，避免保守检测的误报打断健康会话。
    private func applyLateDetectedConflicts(_ found: [PiExtensionConflict], key: String) {
        guard openSessions[key] != nil else { return }
        let conflicts = found.filter { !ignoredConflicts.contains($0.entryPath) }
        if conflicts.isEmpty {
            extensionConflicts.removeValue(forKey: key)
        } else {
            extensionConflicts[key] = conflicts
        }
    }

    /// 把冲突扩展在 pi 的 settings.json 里关掉，然后重启会话让补丁版独占 subagent 工具名
    func resolveExtensionConflicts(sessionKey: String) {
        guard let conflicts = extensionConflicts[sessionKey] else { return }
        for conflict in conflicts {
            do {
                try PiExtensionConflicts.disable(conflict)
            } catch {
                openSessions[sessionKey]?.lastError =
                    "写入 \(conflict.settingsPath) 失败：\(error.localizedDescription)"
                return
            }
        }
        extensionConflicts.removeValue(forKey: sessionKey)
        restartSession(key: sessionKey)
    }

    func ignoreExtensionConflicts(sessionKey: String) {
        for conflict in extensionConflicts[sessionKey] ?? [] {
            ignoredConflicts.insert(conflict.entryPath)
        }
        extensionConflicts.removeValue(forKey: sessionKey)
    }

    /// 关掉当前 pi 进程并按原会话文件重开一个（没有会话文件时开新会话）。
    /// 等旧进程真正退出（最多约 2s）再 spawn，避免两进程并发写同一 .jsonl。
    func restartSession(key: String) {
        guard let old = openSessions[key] else { return }
        let project = old.projectURL
        let sessionPath = old.sessionFile
        old.shutdown { [weak self] in
            guard let self else { return }
            // 等待期间若用户已关会话或再次重启，不要用旧回调覆盖新状态
            guard self.openSessions[key] === old else { return }
            self.openSessions[key] = self.makeSession(key: key, project: project, sessionPath: sessionPath)
            self.selectedSessionKey = key
        }
    }

    func closeSession(key: String) {
        pendingHistoricalSessionOpens.removeValue(forKey: key)
        if let file = openSessions[key]?.sessionFile {
            pinnedToTop.removeValue(forKey: file)
        }
        openSessions[key]?.shutdown()
        openSessions.removeValue(forKey: key)
        if selectedSessionKey == key { selectedSessionKey = nil }
    }

    // MARK: - Archive / rename

    func archiveSession(path: String, project: URL) {
        pinnedToTop.removeValue(forKey: path)
        if userPinnedSessionPaths.contains(path) {
            userPinnedSessionPaths.remove(path)
            persistPinnedSessions()
        }
        archivedSessionPaths.insert(path)
        persistArchivedSessions()

        // Close any open process bound to this session file
        var keysToClose = openSessions.compactMap { key, session -> String? in
            if session.sessionFile == path || key == "resume:\(path)" { return key }
            return nil
        }
        // 也取消刚被点击、尚未开始 spawn 的历史会话。
        let pendingKey = "resume:\(path)"
        if pendingHistoricalSessionOpens[pendingKey] != nil {
            keysToClose.append(pendingKey)
        }
        for key in keysToClose {
            closeSession(key: key)
        }

        // 乐观：立刻从活跃列表移到归档列表
        let projectPath = project.path
        var active = sessionsByProject[projectPath] ?? []
        let moved = active.first(where: { $0.path == path })
        active.removeAll { $0.path == path }
        sessionsByProject[projectPath] = active
        if let moved {
            var archived = archivedByProject[projectPath] ?? []
            archived.removeAll { $0.path == path }
            archived.insert(moved, at: 0)
            archivedByProject[projectPath] = archived
        }

        refreshSessions(for: project)
    }

    func unarchiveSession(path: String, project: URL) {
        archivedSessionPaths.remove(path)
        persistArchivedSessions()

        // 乐观：立刻从归档列表移回活跃列表
        let projectPath = project.path
        var archived = archivedByProject[projectPath] ?? []
        let moved = archived.first(where: { $0.path == path })
        archived.removeAll { $0.path == path }
        archivedByProject[projectPath] = archived
        if let moved {
            var active = sessionsByProject[projectPath] ?? []
            active.removeAll { $0.path == path }
            active.insert(moved, at: 0)
            active.sort { self.effectiveModified($0) > self.effectiveModified($1) }
            sessionsByProject[projectPath] = active
        }

        refreshSessions(for: project)
    }

    /// 取消归档并打开会话
    func restoreSession(_ meta: SessionMeta, project: URL) {
        unarchiveSession(path: meta.path, project: project)
        openSession(meta, project: project)
    }

    /// Rename via pi RPC `set_session_name`. Opens the session if needed.
    func renameSession(meta: SessionMeta? = nil, openKey: String? = nil, project: URL, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if let openKey, let existing = openSessions[openKey] {
            selectedSessionKey = openKey
            applySessionName(trimmed, to: existing)
        } else if let meta {
            openSession(meta, project: project)
            // Historical first-open is intentionally deferred by one main-loop pass so
            // selection can render immediately. Continue the rename after that pass;
            // use the session path rather than current selection because the user may
            // click another row while this session is opening.
            let resumeKey = "resume:\(meta.path)"
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let session = self.openSessions[resumeKey]
                    ?? self.openSessions.first(where: { $0.value.sessionFile == meta.path })?.value
                guard let session else { return }
                self.applySessionName(trimmed, to: session)
            }
        } else if let openKey {
            if let session = openSessions[openKey] {
                applySessionName(trimmed, to: session)
            }
        }
    }

    private func applySessionName(_ name: String, to session: ChatSession) {
        // Belt-and-suspenders: stop auto titles even if setSessionName path changes.
        session.markUserRenamedTitle()
        // Optimistic local update so the sidebar reflects immediately
        session.sessionName = name
        session.setSessionName(name)
    }

    func shutdown() {
        pendingHistoricalSessionOpens.removeAll()
        for session in openSessions.values {
            session.subagents.saveNow()
            session.shutdown()
        }
        bridge?.stop()
        bridge = nil
    }

    static let markdownDemo = """
    ### 基本信息

    | 项 | 内容 |
    |---|---|
    | 技术栈 | Swift 5.9 / SwiftUI，macOS 14+ |
    | 规模 | 约 **1500 行** Swift |
    | 构建 | `./make-app.sh` 打包 |

    ---

    ## 架构

    ```
    ┌──────────────┐     ┌──────────────────┐
    │ SidebarView  │ --> │ ChatDetailView   │
    └──────────────┘     └──────────────────┘
    ```

    要点列表：
    - 每个会话独立 `pi --mode rpc` 子进程
    - 支持 *流式* 渲染
      - 嵌套项测试
    1. 第一步
    2. 第二步

    > 引用块：桥接服务仅监听 127.0.0.1
    """
}
