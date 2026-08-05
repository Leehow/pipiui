import Foundation
import AppKit
import Combine

struct SessionMeta: Identifiable, Hashable {
    let path: String
    let name: String
    let modified: Date
    /// `provider/modelId` of the latest main-agent model selection in the session file.
    let modelRef: String?
    /// Which engine backs this session. Plan A only ever produces `.pi`;
    /// disk persistence of `engine_kind` is deferred to Plan B, so sessions
    /// read from disk default to `.pi`.
    var engineKind: EngineKind = .pi

    init(path: String, name: String, modified: Date, modelRef: String? = nil,
         engineKind: EngineKind = .pi) {
        self.path = path
        self.name = name
        self.modified = modified
        self.modelRef = modelRef
        self.engineKind = engineKind
    }

    var id: String { path }
}

/// Extracts the newest main-agent model selection from a pi session JSONL tail.
enum SessionModelReferenceParser {
    static func latestModelRef(in jsonlTail: Data) -> String? {
        guard let text = String(data: jsonlTail, encoding: .utf8) else { return nil }

        // The first line can be truncated because callers read only a tail window.
        // Work backwards so the first valid model record is the latest selection.
        for line in text.split(separator: "\n").reversed() {
            guard let entry = J.parse(Data(line.utf8)),
                  let type = entry["type"].string,
                  type == "model_change" || type == "set_model"
            else {
                continue
            }

            let provider = entry["provider"].string ?? entry["model"]["provider"].string
            let modelId = entry["modelId"].string
                ?? entry["model"]["modelId"].string
                ?? entry["model"]["id"].string
            guard let normalizedProvider = normalized(provider),
                  let normalizedModelId = normalized(modelId)
            else {
                continue
            }
            return "\(normalizedProvider)/\(normalizedModelId)"
        }
        return nil
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return value
    }
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
    @Published var isAutomationsPresented = false
    @Published var automationDraftRequest: AutomationDraftRequest?
    private var automationSchedulerStorage: AutomationScheduler?

    @MainActor var automations: AutomationScheduler {
        if let automationSchedulerStorage { return automationSchedulerStorage }
        let scheduler = AutomationScheduler { [weak self] job in
            guard let self else { return .failure("Pipi 已关闭") }
            return await self.executeAutomation(job)
        }
        scheduler.onOutcome = { job, outcome in
            if outcome.status == .succeeded {
                TaskNotifier.shared.notifyAutomationCompletion(
                    title: job.title,
                    summary: outcome.summary
                )
            } else {
                TaskNotifier.shared.notifyAutomationError(
                    title: job.title,
                    message: outcome.summary
                )
            }
        }
        automationSchedulerStorage = scheduler
        return scheduler
    }
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
            // A background session retains raw stream/tool updates; materialize once
            // before its detail view observes StreamingState for the first frame.
            openSessions[key]?.flushPendingStreamingForSelection()
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
    /// Async conflict scans are keyed to one makeSession generation. Restarting,
    /// rebinding, closing, or disabling subagent invalidates old callbacks.
    private var extensionConflictScanGenerations: [String: UUID] = [:]
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

    /// Bumped when a philosophy toggle changes, so Settings rows recompute their effective state.
    @Published var philosophyRevision: UInt64 = 0

    /// Shared source of truth for the sidebar shortcut and Settings panel.
    /// Persisted state remains default-off in `ComputerUseSettings`; callers must
    /// use `setComputerUseEnabled` so lifecycle side effects cannot diverge.
    @Published private(set) var computerUseEnabled = ComputerUseSettings.isEnabled()

    /// Independent default-off loopback web test host. This never changes the
    /// BridgeServer listener or exposes either bridge capability.
    @Published private(set) var localRemoteEnabled = LocalRemoteSettings.isEnabled()
    @Published private(set) var localRemoteURL: URL?
    @Published private(set) var localRemoteStatus = "已关闭"
    /// Session-scoped and intentionally never persisted. Every launch returns
    /// to loopback-only even if the local web host itself is enabled.
    @Published private(set) var localRemoteLANEnabled =
        LocalRemoteSettings.isLANEnabledForNewLaunch
    @Published private(set) var localRemoteLANURL: URL?
    @Published private(set) var localRemoteLANStatus = "已关闭"
    /// Session-scoped WebRTC viability spike. It is never persisted and serves
    /// only a loopback Chrome harness backed by a retained WKWebView host.
    @Published private(set) var remotePeerTestEnabled = false
    @Published private(set) var remotePeerTestURL: URL?
    @Published private(set) var remotePeerTestStatus = "已关闭"
    @Published private(set) var remotePeerTestEchoVerified = false
    @Published private(set) var remoteRelayConfiguration = RemoteRelaySettings.load()
    @Published private(set) var remoteRelayState: RemoteRelayConnectionState = .disabled
    @Published private(set) var remotePeerProductionState: RemotePeerProductionState = .disabled
    @Published private(set) var remotePairingPayload: String?
    @Published private(set) var remotePairingMessage = ""
    @Published private(set) var remotePairingPairID: String?
    @Published private(set) var remotePairingFingerprint: String?
    @Published private(set) var remotePairingExpiresAt: Date?
    @Published private(set) var remoteLegacyMigrationRequired = false
    private var localRemoteHost: RemoteHostService?
    private var localRemoteHostGeneration = UUID()
    private var remotePeerTransport: WebKitRemotePeerTransport?
    private var remotePeerGeneration = UUID()
    private lazy var remoteHostController = RemoteHostController(store: self)
    private var remoteRelayClient: RemoteRelayClient?
    private var remoteRelayPeerTransport: WebKitRemotePeerTransport?
    private var remoteRelayGeneration = UUID()
    private var remotePairingExpiryWorkItem: DispatchWorkItem?

    /// Bumped when model picker visibility preferences change so InputBar refreshes.
    @Published var modelVisibilityRevision: Int = 0
    /// Bumped when skill enable/disable toggles change so slash menu refreshes.
    @Published var skillVisibilityRevision: Int = 0

    // MARK: - pi 更新检查

    @Published private(set) var piUpdateInfo = PiVersionInfo()
    @Published private(set) var piIsChecking = false
    @Published private(set) var piIsUpdating = false
    @Published private(set) var piUpdateLog = ""
    @Published var isPiUpdatePresented = false

    /// Restart every open pi RPC process so auth.json changes take effect.
    func restartAllOpenSessions() {
        for key in Array(openSessions.keys) {
            restartSession(key: key)
        }
    }

    /// Persist one non-transactional built-in master switch and restart all
    /// sessions. Subagent-off invalidates every in-flight conflict scan
    /// immediately — before UserDefaults changes or asynchronous restarts — so a
    /// rapid off→on cannot revive an old callback against the same key.
    /// `.computerUse` is the one hot-swappable exception: the coordinator host
    /// guard reads it live (see `ComputerCoordinator.computerUseEnabledProvider`)
    /// and spawn-time mounting reads it per session, so no restart is needed —
    /// turning it off cancels in-flight desktop work and rejects every further
    /// computer/open_application call; turning it on applies to new spawns and
    /// re-admits already-mounted harnesses.
    func setBuiltInFeatureEnabled(
        _ enabled: Bool,
        id: BuiltInFeatureSettings.FeatureID
    ) {
        // Philosophy must go through BuiltInPhilosophyTransition because its pi
        // settings mutation is fallible.
        guard id != .philosophy else { return }
        let persisted = BuiltInFeatureSettings.isEnabled(id)
        guard persisted != enabled else { return }
        if id == .subagent, !enabled {
            extensionConflictScanGenerations.removeAll()
        }
        BuiltInFeatureSettings.setEnabled(enabled, id: id)
        if id == .computerUse {
            // Hot swap: never restart sessions. Existing sessions keep their
            // mounted harness but the host guard rejects every call until the
            // master switch is on again.
            if !enabled {
                ComputerCoordinator.shared.cancelAllDesktopOperations()
            }
            return
        }
        restartAllOpenSessions()
    }

    /// Mount or unmount the desktop harness for every open top-level session.
    /// Turning it on is the only PipiUI authorization gate for all current and
    /// future sessions and subagents. macOS TCC, the in-flight mutex, technical
    /// target validation, cleanup, and emergency stop remain independent.
    ///
    /// This toggle is hot-swappable and never touches open sessions: enabling
    /// clears the emergency latch and re-arms global authorization + input
    /// monitoring; disabling cancels only in-flight desktop work and stops new
    /// computer/open_application calls via the host guard. Normal main turns,
    /// tools, coding subagents and build/test keep running. The red 急停 button
    /// keeps its forced semantics (`emergencyStop` may abort affected sessions).
    func setComputerUseEnabled(_ enabled: Bool) {
        let coordinator = ComputerCoordinator.shared
        ComputerUseTogglePolicy(
            isEnabled: { ComputerUseSettings.isEnabled() },
            isEmergencyStopped: { coordinator.emergencyStopped },
            currentPublished: { self.computerUseEnabled },
            persist: { ComputerUseSettings.setEnabled($0) },
            publish: { self.computerUseEnabled = $0 },
            onEnable: {
                coordinator.enableGlobalAuthorization()
                coordinator.refreshInputMonitoring(
                    permissionSnapshot: ComputerPermissions.snapshot()
                )
            },
            onDisable: {
                coordinator.cancelAllDesktopOperations()
                coordinator.shutdownInputMonitoring()
            }
        ).set(enabled)
    }

    func toggleComputerUse() {
        if computerUseEnabled,
           ComputerCoordinator.shared.emergencyStopped {
            setComputerUseEnabled(true)
            return
        }
        setComputerUseEnabled(!computerUseEnabled)
    }

    func setComputerUseStrategyKind(_ kind: ComputerUseStrategyKind) {
        guard ComputerUseSettings.strategyKind() != kind else { return }
        ComputerUseSettings.setStrategyKind(kind)
        if computerUseEnabled {
            restartAllOpenSessions()
        }
    }

    func setLocalRemoteEnabled(_ enabled: Bool) {
        guard enabled != localRemoteEnabled || (enabled && localRemoteHost == nil) else {
            return
        }
        LocalRemoteSettings.setEnabled(enabled)
        localRemoteEnabled = enabled
        if enabled {
            startLocalRemoteHost()
        } else {
            stopRemotePeerTest()
            localRemoteHostGeneration = UUID()
            localRemoteHost?.stop()
            localRemoteHost = nil
            localRemoteURL = nil
            localRemoteStatus = "已关闭"
            localRemoteLANEnabled = false
            localRemoteLANURL = nil
            localRemoteLANStatus = "已关闭"
        }
    }

    func setRemotePeerTestEnabled(_ enabled: Bool) {
        guard enabled != remotePeerTestEnabled
                || (enabled && remotePeerTransport == nil) else {
            return
        }
        if !enabled {
            stopRemotePeerTest()
            return
        }

        let generation = UUID()
        remotePeerGeneration = generation
        remotePeerTestEnabled = true
        remotePeerTestURL = localRemoteURL?.appendingPathComponent(
            "p2p-test",
            isDirectory: true
        )
        remotePeerTestStatus = "正在载入 WKWebView host…"
        remotePeerTestEchoVerified = false
        let transport = WebKitRemotePeerTransport { [weak self] state in
            guard let self,
                  self.remotePeerGeneration == generation,
                  self.remotePeerTestEnabled else {
                return
            }
            self.remotePeerTestStatus = state.displayText
            self.remotePeerTestEchoVerified = state == .echoVerified
        }
        remotePeerTransport = transport
        localRemoteHost?.setPeerTransport(transport)
        transport.start()
        if !localRemoteEnabled {
            setLocalRemoteEnabled(true)
        }
    }

    private func stopRemotePeerTest() {
        remotePeerGeneration = UUID()
        remotePeerTestEnabled = false
        remotePeerTestURL = nil
        remotePeerTestStatus = "已关闭"
        remotePeerTestEchoVerified = false
        localRemoteHost?.setPeerTransport(nil)
        remotePeerTransport?.stop()
        remotePeerTransport = nil
    }

    func setLocalRemoteLANEnabled(_ enabled: Bool) {
        guard enabled != localRemoteLANEnabled else { return }
        guard localRemoteEnabled else {
            localRemoteLANEnabled = false
            localRemoteLANURL = nil
            localRemoteLANStatus = "请先启用本机网页测试"
            return
        }
        if enabled, LocalRemoteNetwork.currentPrivateIPv4() == nil {
            localRemoteLANEnabled = false
            localRemoteLANURL = nil
            localRemoteLANStatus = "未找到可用的私有 IPv4 地址"
            return
        }
        localRemoteLANEnabled = enabled
        localRemoteLANURL = nil
        localRemoteLANStatus = enabled ? "正在启动…" : "已关闭"
        startLocalRemoteHost()
    }

    func setRemoteRelayEnabled(_ enabled: Bool) {
        remoteRelayConfiguration.enabled = enabled
        RemoteRelaySettings.save(remoteRelayConfiguration)
        if enabled {
            startRemoteRelay()
        } else {
            remoteRelayGeneration = UUID()
            clearRemotePairing()
            remoteRelayClient?.stop()
            remoteRelayClient = nil
            remoteRelayPeerTransport?.stop()
            remoteRelayPeerTransport = nil
            remoteRelayState = .disabled
            remotePeerProductionState = .disabled
        }
    }

    func beginRemotePairing() {
        guard let remoteRelayClient else {
            remotePairingPayload = nil
            remotePairingMessage = "配对创建失败，请先启用 Relay"
            return
        }
        remotePairingMessage = "正在创建配对链接…"
        // Lifecycle events carry ownership of visible pairing state. A delayed
        // completion from a replaced request must never clear the replacement QR.
        remoteRelayClient.beginPairing { _ in }
    }

    func cancelRemotePairing() {
        remoteRelayClient?.cancelPairing()
        clearRemotePairing(message: "配对已取消")
    }

    func refreshRemoteLegacyMigrationStatus() {
        remoteLegacyMigrationRequired = RemoteRelaySettings.needsLegacyMigration(
            remoteRelayConfiguration,
            hasLegacyCredentials: false
        )
    }

    @discardableResult
    func migrateLegacyRemoteConfiguration() -> Bool {
        let deletion = RemoteRelayCredentialStore.deleteAll()
        remoteRelayConfiguration = RemoteRelaySettings.migratedFromLegacy(
            remoteRelayConfiguration
        )
        RemoteRelaySettings.save(remoteRelayConfiguration)
        remoteLegacyMigrationRequired = false
        clearRemotePairing(message: deletion.succeeded
            ? "旧试点配置和凭据已清理，已切换到服务器隧道默认地址"
            : "已切换现代地址，但旧 Keychain 凭据清理未完成")
        if remoteRelayConfiguration.enabled {
            startRemoteRelay()
        } else {
            remoteRelayState = .disabled
            remotePeerProductionState = .disabled
        }
        return deletion.succeeded
    }

    @discardableResult
    func updateRemoteRelayConfiguration(
        webSocketURL: String,
        publicURL: String,
        displayName: String
    ) -> Bool {
        guard let (webSocketURL, publicURL) = RemoteRelaySettings.validatedURLPair(
            webSocketURL: webSocketURL,
            publicURL: publicURL
        ),
              webSocketURL.path == "/tunnel/ws",
              !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }
        remoteRelayConfiguration.webSocketURL = webSocketURL
        remoteRelayConfiguration.publicURL = publicURL
        remoteRelayConfiguration.displayName = String(
            displayName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)
        )
        RemoteRelaySettings.save(remoteRelayConfiguration)
        if remoteRelayConfiguration.enabled {
            startRemoteRelay()
        }
        return true
    }

    @discardableResult
    func saveRemoteRelayCredentials(
        accessClientID: String,
        accessClientSecret: String,
        deviceSecret: String
    ) -> Bool {
        guard RemoteRelaySettings.validatedURLPair(
            webSocketURL: remoteRelayConfiguration.webSocketURL,
            publicURL: remoteRelayConfiguration.publicURL
        ) != nil else {
            return false
        }
        let values = [
            (RemoteRelayCredential.accessClientID, accessClientID),
            (RemoteRelayCredential.accessClientSecret, accessClientSecret),
            (RemoteRelayCredential.deviceSecret, deviceSecret),
        ]
        guard values.allSatisfy({
            let count = $0.1.trimmingCharacters(in: .whitespacesAndNewlines).utf8.count
            return (16...4_096).contains(count)
        }) else {
            return false
        }
        let written = values.allSatisfy {
            RemoteRelayCredentialStore.write(
                $0.1.trimmingCharacters(in: .whitespacesAndNewlines),
                credential: $0.0
            )
        }
        if written, remoteRelayConfiguration.enabled {
            startRemoteRelay()
        }
        return written
    }

    func deleteRemoteRelayCredentials() {
        _ = RemoteRelayCredentialStore.deleteAll()
        remoteRelayClient?.stop()
        remoteRelayClient = nil
        remoteRelayPeerTransport?.stop()
        remoteRelayPeerTransport = nil
        remoteLegacyMigrationRequired = false
        if remoteRelayConfiguration.enabled {
            startRemoteRelay()
        }
    }

    private func startRemoteRelay() {
        if remoteRelayConfiguration.webSocketURL.path != "/tunnel/ws" {
            remoteRelayConfiguration = RemoteRelaySettings.migratedFromLegacy(
                remoteRelayConfiguration
            )
            RemoteRelaySettings.save(remoteRelayConfiguration)
        }
        let generation = UUID()
        remoteRelayGeneration = generation
        clearRemotePairing()
        remoteRelayClient?.stop()
        remoteRelayPeerTransport?.stop()
        remoteRelayPeerTransport = nil
        remotePeerProductionState = .disabled
        let peerTransport: WebKitRemotePeerTransport?
        if remoteRelayConfiguration.webSocketURL.path == "/tunnel/ws" {
            let transport = WebKitRemotePeerTransport(
                productionStateChanged: { [weak self] state in
                    DispatchQueue.main.async {
                        guard let self,
                              self.remoteRelayGeneration == generation,
                              self.remoteRelayPeerTransport != nil else { return }
                        self.remotePeerProductionState = state
                    }
                },
                stateChanged: { _ in }
            )
            transport.start()
            remoteRelayPeerTransport = transport
            peerTransport = transport
        } else {
            peerTransport = nil
        }
        let client = RemoteRelayClient(
            controller: remoteHostController,
            configuration: remoteRelayConfiguration,
            peerTransport: peerTransport,
            pairingChanged: { [weak self] event in
                DispatchQueue.main.async {
                    guard let self,
                          self.remoteRelayGeneration == generation,
                          self.remoteRelayClient != nil else { return }
                    self.handleRemotePairingEvent(event)
                }
            },
            stateChanged: { [weak self] state in
                DispatchQueue.main.async {
                    guard let self,
                          self.remoteRelayGeneration == generation,
                          self.remoteRelayClient != nil else { return }
                    self.remoteRelayState = state
                }
            }
        )
        remoteRelayClient = client
        client.start()
    }

    func handleRemotePairingEvent(_ event: RemotePairingLifecycleEvent) {
        switch event {
        case .created(let pairing):
            remotePairingPayload = pairing.url.absoluteString
            remotePairingPairID = pairing.pairID
            remotePairingFingerprint = pairing.fingerprint
            remotePairingExpiresAt = pairing.expiresAt
            remotePairingMessage = "配对链接已生成（24 小时内有效）"
            scheduleRemotePairingExpiry(
                expiresAt: pairing.expiresAt,
                pairID: pairing.pairID
            )
        case .claimed:
            // The link stays visible: other browsers can still pair with it.
            // A renewed expiry (if the Relay confirmed one) refreshes the
            // countdown and its scheduled teardown.
            if let pairID = remotePairingPairID,
               let renewedExpiry = remoteRelayClient?.currentPairingExpiry() {
                remotePairingExpiresAt = renewedExpiry
                scheduleRemotePairingExpiry(
                    expiresAt: renewedExpiry,
                    pairID: pairID
                )
            }
            remotePairingMessage = "已有浏览器配对，链接持续可用"
        case .cancelled:
            clearRemotePairing(message: "配对已取消")
        case .invalidated:
            clearRemotePairing(message: "配对链接已失效")
        }
    }

    private func scheduleRemotePairingExpiry(
        expiresAt: Date,
        pairID: String
    ) {
        remotePairingExpiryWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.remotePairingPairID == pairID else { return }
            self.remoteRelayClient?.cancelPairing()
            self.clearRemotePairing(message: "配对链接已过期")
        }
        remotePairingExpiryWorkItem = item
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(0, expiresAt.timeIntervalSinceNow),
            execute: item
        )
    }

    private func clearRemotePairing(message: String = "") {
        remotePairingExpiryWorkItem?.cancel()
        remotePairingExpiryWorkItem = nil
        remotePairingPayload = nil
        remotePairingPairID = nil
        remotePairingFingerprint = nil
        remotePairingExpiresAt = nil
        remotePairingMessage = message
    }

    private func startLocalRemoteHost() {
        let generation = UUID()
        localRemoteHostGeneration = generation
        localRemoteHost?.stop()
        localRemoteHost = nil
        localRemoteURL = nil
        localRemoteLANURL = nil
        localRemoteStatus = "正在启动…"
        let accessMode: LocalRemoteAccessMode
        if localRemoteLANEnabled {
            guard let address = LocalRemoteNetwork.currentPrivateIPv4() else {
                localRemoteLANEnabled = false
                localRemoteLANStatus = "未找到可用的私有 IPv4 地址"
                startLocalRemoteHost()
                return
            }
            accessMode = .trustedLAN(
                privateIPv4: address,
                pairingSecret: BridgeCapabilityToken.generate()
            )
        } else {
            accessMode = .loopbackOnly
        }
        guard let host = RemoteHostService(
            controller: remoteHostController,
            accessMode: accessMode,
            peerTransport: remotePeerTransport,
            stateChanged: { [weak self] state in
                guard let self,
                      self.localRemoteHostGeneration == generation else { return }
                switch state {
                case .starting:
                    self.localRemoteStatus = "正在启动…"
                    self.localRemoteURL = nil
                    self.localRemoteLANURL = nil
                case .listening(let loopbackURL, let lanURL):
                    self.localRemoteURL = loopbackURL
                    self.localRemoteLANURL = lanURL
                    self.remotePeerTestURL = self.remotePeerTestEnabled
                        ? loopbackURL.appendingPathComponent(
                            "p2p-test",
                            isDirectory: true
                        )
                        : nil
                    if lanURL != nil {
                        self.localRemoteStatus = "本机与受信任局域网可访问"
                        self.localRemoteLANStatus = "仅限受信任局域网测试"
                    } else {
                        self.localRemoteStatus = "仅监听 127.0.0.1"
                        if !self.localRemoteLANEnabled {
                            self.localRemoteLANStatus = "已关闭"
                        }
                    }
                case .failed(let message):
                    self.localRemoteStatus = "启动失败：\(message)"
                    self.localRemoteURL = nil
                    self.localRemoteLANURL = nil
                    self.remotePeerTestURL = nil
                    if self.localRemoteLANEnabled {
                        self.localRemoteLANStatus = "启动失败：\(message)"
                    }
                case .stopped:
                    if !self.localRemoteEnabled {
                        self.localRemoteStatus = "已关闭"
                    }
                    self.localRemoteURL = nil
                    self.localRemoteLANURL = nil
                    self.remotePeerTestURL = nil
                }
            }
        ) else {
            localRemoteEnabled = false
            localRemoteLANEnabled = false
            LocalRemoteSettings.setEnabled(false)
            localRemoteStatus = "启动失败"
            localRemoteLANStatus = "启动失败"
            return
        }
        localRemoteHost = host
    }

    func setExternalComputerUseStrategyPath(_ path: String) {
        let decision = ComputerUseSettings.externalStrategyApplyDecision(
            submittedPath: path,
            currentPath: ComputerUseSettings.externalStrategyPath(),
            computerUseEnabled: computerUseEnabled,
            strategyKind: ComputerUseSettings.strategyKind()
        )
        if decision.shouldPersist {
            ComputerUseSettings.setExternalStrategyPath(
                decision.normalizedPath
            )
        }
        if decision.shouldRestartSessions {
            restartAllOpenSessions()
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
        ComputerCoordinator.shared.configure { sessionCapability in
            let session = AppStore.shared.openSessions.values.first {
                BridgeCapabilityToken.matches(
                    sessionCapability,
                    expected: $0.bridgeRoutingKey
                )
            }
            session?.abort()
        }
        bridge = BridgeServer(authorize: { request in
            let candidate = request["sessionKey"].string ?? ""
            return AppStore.shared.openSessions.values.contains {
                BridgeCapabilityToken.matches(candidate, expected: $0.bridgeRoutingKey)
            }
        }) { request, respond, registerCancellation in
            // Handler 已在主线程；按 sessionKey 精确路由到对应会话。
            // 未知/已关闭 key 必须拒绝，避免子 agent 孤儿请求落到「当前选中」会话上乱 eval。
            let store = AppStore.shared
            let key = request["sessionKey"].string ?? ""
            guard !key.isEmpty,
                  let session = store.openSessions.values.first(where: {
                      BridgeCapabilityToken.matches(key, expected: $0.bridgeRoutingKey)
                  }) else {
                respond(["ok": false, "error": "unknown session key"])
                return
            }
            let action = request["action"].string ?? ""
            if action == "agent_event" {
                let shouldAutoOpen = session.subagents.enqueue(request)
                if shouldAutoOpen, session.rightPanel == nil {
                    session.rightPanel = .agents
                }
                respond(["ok": true])
                return
            }
            if ComputerRuntimeContract.operations.contains(action) {
                let computerCapability = request["computerCapability"].string ?? ""
                guard BridgeCapabilityToken.matches(
                    computerCapability,
                    expected: session.computerRoutingKey
                ) else {
                    respond(ComputerRuntimeContract.failure(
                        code: "unauthorized_computer_capability",
                        message: "unauthorized computer capability",
                        retryable: false,
                        requiresObservation: false
                    ))
                    return
                }
                if let versionFailure = ComputerRuntimeContract.validateVersion(request) {
                    respond(versionFailure)
                    return
                }
                if action == ComputerRuntimeContract.capabilitiesAction {
                    do {
                        let descriptor = try ComputerUseSettings.captureDescriptor()
                        respond(ComputerRuntimeContract.capabilities(
                            descriptor: descriptor,
                            permissions: ComputerPermissions.snapshot()
                        ))
                    } catch {
                        respond(ComputerRuntimeContract.failure(
                            code: "runtime_unavailable",
                            message: error.localizedDescription,
                            retryable: false,
                            requiresObservation: false
                        ))
                    }
                    return
                }
                let computerRespond: ([String: Any]) -> Void = {
                    respond(ComputerRuntimeContract.compatibilityEnvelope($0))
                }
                let requestID = request["requestID"].string ?? ""
                if action == "computer_cancel" {
                    ComputerCoordinator.shared.cancelRequest(
                        requestID: requestID,
                        sessionKey: session.bridgeRoutingKey,
                        reason: "computer request cancelled by the pi extension"
                    )
                    computerRespond(["ok": true])
                    return
                }
                guard registerCancellation({
                    Task { @MainActor in
                        ComputerCoordinator.shared.cancelRequest(
                            requestID: requestID,
                            sessionKey: session.bridgeRoutingKey,
                            reason: "computer bridge disconnected or timed out"
                        )
                    }
                }) else {
                    computerRespond(ComputerRuntimeContract.failure(
                        code: "request_cancelled",
                        message: "computer bridge request was already cancelled",
                        retryable: true,
                        requiresObservation: true
                    ))
                    return
                }
                if action == "computer_open_application" {
                    ComputerCoordinator.shared.handleOpenApplication(
                        request: request,
                        sessionKey: session.bridgeRoutingKey,
                        respond: computerRespond
                    )
                } else {
                    ComputerCoordinator.shared.handle(
                        request: request,
                        sessionKey: session.bridgeRoutingKey,
                        respond: computerRespond
                    )
                }
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
        if localRemoteEnabled {
            DispatchQueue.main.async { [weak self] in
                self?.startLocalRemoteHost()
            }
        }
        if remoteRelayConfiguration.enabled {
            DispatchQueue.main.async { [weak self] in
                self?.startRemoteRelay()
            }
        }
    }

    private func makeSession(
        key: String,
        project: URL,
        sessionPath: String?,
        preloadedTranscript: InitialTranscriptBuild? = nil,
        taskNotificationMode: SessionTaskNotificationMode = .standard,
        engine: EngineKind = .pi
    ) -> ChatSession {
        // spawn 前自检：撞名扩展会让 pi 直接退出，先把它变成可修复的提示而不是一行崩溃日志。
        // T11: 主路径只做便宜的 stamp 检查 + 缓存命中；未缓存时先放行 spawn，
        // 全量扫描挪后台，结果回来真有冲突再把会话切成 blocked 态提示修复。
        // Master on/off snapshot for PipiUI-owned extensions. Computed once per
        // session spawn so the whole assembly sees a consistent view; the
        // "内置" settings tab is the only writer.
        let builtInFeatures = BuiltInFeatureSettings.enabledSet()

        // Conflict detection matters only for the patched subagent (-e) that can
        // collide with a user-installed same-name extension. When the built-in
        // subagent feature is off, no PipiUI `-e` can collide, so skip the check
        // and never block the session on a phantom conflict.
        let conflictDetectionEnabled = PipiSpawnAssembly.shouldDetectSubagentConflicts(
            subagentDir: plugin.subagentDir,
            features: builtInFeatures
        )
        let conflictScanGeneration = UUID()
        let cachedConflicts: [PiExtensionConflict]?
        if conflictDetectionEnabled {
            // Always advance the generation, even on a cache hit, to invalidate
            // any older async callback for the same key.
            extensionConflictScanGenerations[key] = conflictScanGeneration
            cachedConflicts = PiExtensionConflicts.cached(projectDir: project)
        } else {
            extensionConflictScanGenerations.removeValue(forKey: key)
            cachedConflicts = nil
            extensionConflicts.removeValue(forKey: key)
        }
        let conflicts = (cachedConflicts ?? []).filter { !ignoredConflicts.contains($0.entryPath) }
        if conflicts.isEmpty {
            extensionConflicts.removeValue(forKey: key)
        } else {
            extensionConflicts[key] = conflicts
        }
        if conflictDetectionEnabled, cachedConflicts == nil {
            PiExtensionConflicts.detectAsync(projectDir: project) { [weak self] found in
                self?.applyLateDetectedConflicts(
                    found,
                    key: key,
                    generation: conflictScanGeneration
                )
            }
        }

        // Computer Use strategy resolution is gated by BOTH the standalone
        // authorization and the built-in capability switch. Turning the
        // capability off must not even parse/validate a configured strategy.
        let selectedComputerStrategy: ComputerUseStrategySelection?
        let computerStrategyError: String?
        if ComputerUseSettings.isEnabled() && builtInFeatures.isEnabled(.computerUse) {
            do {
                selectedComputerStrategy = try ComputerUseSettings.resolveStrategy(
                    builtInPath: plugin.computerUseExtension
                )
                computerStrategyError = nil
            } catch {
                selectedComputerStrategy = nil
                computerStrategyError =
                    "Computer Use 策略无法加载：\(error.localizedDescription)"
            }
        } else {
            selectedComputerStrategy = nil
            computerStrategyError = nil
        }
        let sessionBlockedReason = [
            conflicts.isEmpty
                ? nil
                : "扩展撞名，pi 未启动。修复上方冲突后会自动重启会话。",
            computerStrategyError,
        ].compactMap { $0 }.joined(separator: "\n")

        let cachedTranscript = preloadedTranscript ?? sessionPath.flatMap {
            historyPreloader.snapshotIfCurrent(path: $0)?.transcript
        }
        let initialTranscript = SessionInitialTranscriptSeed.select(
            sessionPath: sessionPath,
            cachedTranscript: cachedTranscript
        )
        // Resolve every App-owned path to explicit nil/path values before
        // constructing ChatSession. In particular, disabled subagent does not
        // receive its extension/agents dir, and disabled philosophy does not
        // even inspect package registration for a fallback path.
        let philosophyExtension = builtInFeatures.isEnabled(.philosophy)
            ? PhilosophyPackage.fallbackExtensionPath : nil
        let paths = PipiSpawnAssembly.Paths.resolved(
            installed: plugin,
            features: builtInFeatures,
            philosophyExtension: philosophyExtension,
            computerUseExtension: selectedComputerStrategy?.extensionPath,
            memoryEnabled: ControlledMemoryStore.isEnabledOnDisk()
        )
        let session = ChatSession(
            id: key, projectURL: project, sessionPath: sessionPath,
            bridgePort: bridge?.port ?? 0,
            webviewExtension: paths.webview,
            mediaExtension: paths.media,
            gitExtension: paths.git,
            reloadExtension: paths.reload,
            webSearchExtension: paths.webSearch,
            mcpExtension: paths.mcp,
            skillLoaderExtension: paths.skillLoader,
            codexServerToolsExtension: paths.codexServerTools,
            claudeServerToolsExtension: paths.claudeServerTools,
            computerUseExtension: paths.computerUse,
            subagentDir: paths.subagentDir,
            agentsDir: paths.agentsDir,
            philosophyExtension: paths.philosophy,
            searchScopeExtension: paths.searchScope,
            memoryExtension: paths.memory,
            builtInFeatures: builtInFeatures,
            taskNotificationMode: taskNotificationMode,
            blockedReason: sessionBlockedReason.isEmpty
                ? nil : sessionBlockedReason,
            initialTranscript: initialTranscript,
            engineKind: engine
        )
        session.onSessionMetaChanged = { [weak self, weak session] in
            guard let self, let session else { return }
            // 乐观插入：sessionFile 一到立刻进侧边栏磁盘列表，避免 refresh 异步扫描空窗导致选中行消失
            if let file = session.sessionFile {
                self.upsertLiveSessionMeta(
                    project: project,
                    file: file,
                    name: session.sessionName ?? "新会话",
                    engine: session.engineKind
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
        // 停止升级 Tier-3 兜底：复用 restartSession 的 kill+respawn 路径（shutdown →
        // 等旧进程退出 → 按原 sessionFile 重开），恢复卡死的前台 turn。
        session.onRequestRestart = { [weak self, weak session] in
            guard let self, let session,
                  let currentKey = self.openSessions.first(where: { $0.value === session })?.key else {
                return
            }
            self.restartSession(key: currentKey)
        }
        session.onRequestScheduleDraft = { [weak self] prompt in
            self?.presentAutomationDraft(prefilledPrompt: prompt)
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
            // Late scan callbacks capture oldKey; invalidate them rather than
            // letting a pre-rebind result attach to either identity.
            extensionConflictScanGenerations.removeValue(forKey: oldKey)
            extensionConflictScanGenerations.removeValue(forKey: newKey)
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
            name: session.sessionName ?? "新会话",
            engine: session.engineKind
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
        // 新项目插入到未固定分组的最顶部（紧跟所有固定项目之后），
        // 这样用户添加后立即在侧边栏顶部看到新项目，而不是被追加到底部。
        let insertIndex = projects.firstIndex { !pinnedProjectPaths.contains($0.path) }
            ?? projects.endIndex
        projects.insert(url, at: insertIndex)
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

    /// T7: 增量扫描缓存——projectPath → (session 文件路径 → (mtime, name, modelRef, ephemeral))。
    /// 只有新增或 mtime 变化的文件才重新读内容解析元数据，其余复用上次结果。
    private var sessionScanCache: [String: [String: (mtime: Date, name: String, modelRef: String?, ephemeral: Bool)]] = [:]
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
            var newCache: [String: (mtime: Date, name: String, modelRef: String?, ephemeral: Bool)] = [:]
            newCache.reserveCapacity(files.count)
            for url in files {
                let path = url.path
                let mtime = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                // 增量：mtime 未变直接复用上次的元数据，不重复读文件内容。
                let entry: (name: String, modelRef: String?, ephemeral: Bool)
                if let hit = cachedEntries[path], hit.mtime == mtime {
                    entry = (hit.name, hit.modelRef, hit.ephemeral)
                } else if Self.isEphemeralTitlePromptSession(url) {
                    entry = ("", nil, true)
                } else {
                    entry = (
                        Self.sessionDisplayName(url),
                        Self.sessionModelRef(url),
                        false
                    )
                }
                newCache[path] = (
                    mtime: mtime,
                    name: entry.name,
                    modelRef: entry.modelRef,
                    ephemeral: entry.ephemeral
                )
                // Skip orphan side-channel title-gen sessions (pi ran without --no-session).
                if entry.ephemeral { continue }
                let meta = SessionMeta(
                    path: path,
                    name: entry.name,
                    modified: mtime,
                    modelRef: entry.modelRef,
                    engineKind: .pi
                )
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
                            modified: Date(),
                            engineKind: open.engineKind
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
    func upsertLiveSessionMeta(project: URL, file: String, name: String, engine: EngineKind = .pi) {
        guard !archivedSessionPaths.contains(file) else { return }
        let projectPath = project.path
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = trimmed.isEmpty ? "新会话" : trimmed
        var metas = sessionsByProject[projectPath] ?? []
        if let idx = metas.firstIndex(where: { $0.path == file }) {
            let old = metas[idx]
            // Don't clobber a real title with placeholder / "新会话".
            let keptName = SessionTitleLogic.isPlaceholderName(displayName) ? old.name : displayName
            metas[idx] = SessionMeta(
                path: file,
                name: keptName,
                modified: old.modified,
                modelRef: old.modelRef,
                engineKind: engine
            )
        } else {
            // New session: optimistic insert at top with fresh timestamp.
            metas.insert(
                SessionMeta(path: file, name: displayName, modified: Date(), engineKind: engine),
                at: 0
            )
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

    /// Reads only the final 64 KiB: enough to find a recent pi `model_change`,
    /// while keeping session discovery bounded even for very large transcripts.
    private static func sessionModelRef(_ url: URL) -> String? {
        let tailWindowBytes: UInt64 = 64 * 1024
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        do {
            let endOffset = try handle.seekToEnd()
            try handle.seek(toOffset: endOffset > tailWindowBytes ? endOffset - tailWindowBytes : 0)
            guard let tail = try handle.readToEnd() else { return nil }
            return SessionModelReferenceParser.latestModelRef(in: tail)
        } catch {
            return nil
        }
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
        selectedSessionKey = openSessionInBackground(meta, project: project)
    }

    /// Loads/opens a historical session without touching either desktop
    /// selection. Disk parsing remains in SessionHistoryPreloader's utility queue.
    @discardableResult
    func openSessionInBackground(
        _ meta: SessionMeta,
        project: URL
    ) -> String {
        RemoteSelectionNeutralMutation.perform(selection: { [self] in
            RemoteDesktopSelectionState(
                projectPath: self.selectedProjectPath,
                sessionKey: self.selectedSessionKey
            )
        }) { [self] in
            self.openSessionInBackgroundUnchecked(meta, project: project)
        }
    }

    private func openSessionInBackgroundUnchecked(
        _ meta: SessionMeta,
        project: URL
    ) -> String {
        let key = "resume:\(meta.path)"
        // 历史会话第一次打开后始终使用这个稳定 key；重复点击不必扫描所有 live session。
        if openSessions[key] != nil { return key }
        // 已经有进程挂着这个会话文件时直接切换过去
        if let existing = openSessions.first(where: { $0.value.sessionFile == meta.path }) {
            return existing.key
        }

        guard pendingHistoricalSessionOpens[key] == nil else { return key }
        let token = UUID()
        pendingHistoricalSessionOpens[key] = (token, project.path)
        historyPreloader.loadPrioritized(path: meta.path) { [weak self] snapshot in
            guard let self,
                  self.pendingHistoricalSessionOpens[key]?.token == token else {
                return
            }
            self.pendingHistoricalSessionOpens.removeValue(forKey: key)
            // 归档、移除项目或关闭会话可能发生在这个短暂的排队窗口内。
            guard !self.archivedSessionPaths.contains(meta.path),
                  self.projects.contains(where: { $0.path == project.path }),
                  self.openSessions[key] == nil else { return }
            let session = self.makeSession(
                key: key,
                project: project,
                sessionPath: meta.path,
                preloadedTranscript: snapshot?.transcript
            )
            RemoteSelectionNeutralMutation.perform(selection: { [self] in
                RemoteDesktopSelectionState(
                    projectPath: self.selectedProjectPath,
                    sessionKey: self.selectedSessionKey
                )
            }) { [self] in
                self.openSessions[key] = session
            }
        }
        return key
    }

    func newSession(project: URL, engine: EngineKind? = nil) {
        let resolved = engine ?? (JcodeSettings.isEnabled ? .jcode : .pi)
        let (key, _) = createSessionInBackground(project: project, engine: resolved)
        selectedSessionKey = key
    }

    /// Creates a live Pi session without changing desktop selection.
    @discardableResult
    func createSessionInBackground(
        project: URL,
        engine: EngineKind = .pi,
        taskNotificationMode: SessionTaskNotificationMode = .standard
    ) -> (key: String, session: ChatSession) {
        RemoteSelectionNeutralMutation.perform(selection: { [self] in
            RemoteDesktopSelectionState(
                projectPath: self.selectedProjectPath,
                sessionKey: self.selectedSessionKey
            )
        }) { [self] in
            let key = "new:\(UUID().uuidString)"
            let session = self.makeSession(
                key: key,
                project: project,
                sessionPath: nil,
                taskNotificationMode: taskNotificationMode,
                engine: engine
            )
            self.openSessions[key] = session
            return (key, session)
        }
    }

    func openBranchedSession(path: String, project: URL, suggestedName: String) {
        guard !path.isEmpty else { return }
        let key = "resume:\(path)"
        if openSessions[key] == nil {
            openSessions[key] = makeSession(key: key, project: project, sessionPath: path)
        }
        selectedSessionKey = key
        upsertLiveSessionMeta(
            project: project,
            file: path,
            name: suggestedName,
            engine: openSessions[key]?.engineKind ?? .pi
        )
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
    private func applyLateDetectedConflicts(
        _ found: [PiExtensionConflict],
        key: String,
        generation: UUID
    ) {
        guard PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: generation,
            currentGeneration: extensionConflictScanGenerations[key],
            subagentEnabled: BuiltInFeatureSettings.isEnabled(.subagent),
            sessionExists: openSessions[key] != nil
        ) else { return }
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
        extensionConflictScanGenerations.removeValue(forKey: key)
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
        MainActor.assumeIsolated {
            automationSchedulerStorage?.stop()
        }
        pendingHistoricalSessionOpens.removeAll()
        stopRemotePeerTest()
        localRemoteHost?.stop()
        localRemoteHost = nil
        remoteRelayClient?.stop()
        remoteRelayClient = nil
        clearRemotePairing()
        remoteRelayPeerTransport?.stop()
        remoteRelayPeerTransport = nil
        remotePeerProductionState = .disabled
        remoteHostController.resetRuntimeState()
        ComputerCoordinator.shared.releaseAll(revokeConsent: true)
        ComputerCoordinator.shared.shutdownInputMonitoring()
        for session in openSessions.values {
            session.subagents.saveNow()
            session.shutdown()
        }
        bridge?.stop()
        bridge = nil
    }

    @MainActor func startAutomations() {
        automations.start()
        checkPiUpdateNow()
    }

    // MARK: - pi 更新检查

    /// Check the installed pi version against the npm registry latest. Swift/async,
    /// runs on the main actor; network failure just records an error (never blocks UI).
    @MainActor
    func checkPiUpdateNow() {
        guard !piIsChecking else { return }
        piIsChecking = true
        Task {
            let installed = PiVersionChecker.installedVersion()
            let latest = await PiVersionChecker.latestVersion()
            let now = Date()
            let error = installed == nil
                ? "未能定位已安装的 pi 可执行文件"
                : (latest == nil ? "无法获取最新版本（网络失败或超时）" : nil)
            piUpdateInfo = PiVersionInfo(
                installed: installed,
                latest: latest,
                checkedAt: now,
                error: error
            )
            piIsChecking = false
            Log.info(
                "pi update check -> installed=\(installed ?? "nil") latest=\(latest ?? "nil") update=\(piUpdateInfo.updateAvailable)",
                category: .app
            )
        }
    }

    /// Re-run the pi update check.
    @MainActor
    func refreshPiUpdate() {
        checkPiUpdateNow()
    }

    /// Run `pi update -na` to update pi itself, capturing output into `piUpdateLog`.
    @MainActor
    func runPiUpdate() {
        guard !piIsUpdating, let executable = PiProcess.findPiExecutable() else { return }
        piIsUpdating = true
        piUpdateLog = ""
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = ["update", "-na"]
        proc.environment = ProcessInfo.processInfo.environment

        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(data: handle.availableData, encoding: .utf8) ?? ""
            guard !text.isEmpty else { return }
            DispatchQueue.main.async { self?.appendPiUpdateLog(text) }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(data: handle.availableData, encoding: .utf8) ?? ""
            guard !text.isEmpty else { return }
            DispatchQueue.main.async { self?.appendPiUpdateLog(text) }
        }

        let timeoutItem = DispatchWorkItem {
            if proc.isRunning { proc.terminate() }
        }

        proc.terminationHandler = { [weak self] p in
            DispatchQueue.main.async {
                timeoutItem.cancel()
                guard let self else { return }
                if p.terminationStatus == 0 {
                    self.appendPiUpdateLog("\n[完成] pi 更新成功")
                } else {
                    self.appendPiUpdateLog("\n[结束] pi 更新进程退出码 \(p.terminationStatus)")
                }
                self.piIsUpdating = false
                self.checkPiUpdateNow()
            }
        }

        do {
            try proc.run()
            DispatchQueue.global().asyncAfter(deadline: .now() + 120, execute: timeoutItem)
        } catch {
            timeoutItem.cancel()
            piUpdateLog += "\n[错误] 无法启动 pi 更新：\(error.localizedDescription)"
            piIsUpdating = false
        }
    }

    /// Append incremental output to the update log (main thread).
    @MainActor
    private func appendPiUpdateLog(_ text: String) {
        if piUpdateLog.isEmpty {
            piUpdateLog = text
        } else {
            piUpdateLog += text
        }
    }

    func presentAutomations() {
        automationDraftRequest = nil
        isAutomationsPresented = true
    }

    func presentAutomationDraft(prefilledPrompt: String) {
        automationDraftRequest = AutomationDraftRequestCoordinator.issue(prompt: prefilledPrompt)
        isAutomationsPresented = true
    }

    @MainActor
    private func executeAutomation(_ job: AutomationJob) async -> AutomationExecutionResult {
        guard projects.contains(where: { $0.path == job.projectPath }),
              FileManager.default.fileExists(atPath: job.projectPath) else {
            return .failure("项目不存在或已从 Pipi 移除：\(job.projectPath)", shouldPause: true)
        }

        let selectionBefore = RemoteDesktopSelectionState(
            projectPath: selectedProjectPath,
            sessionKey: selectedSessionKey
        )
        let (key, session) = createSessionInBackground(
            project: URL(fileURLWithPath: job.projectPath),
            taskNotificationMode: .schedulerOnly
        )
        let selectionImmediatelyAfterCreation = RemoteDesktopSelectionState(
            projectPath: selectedProjectPath,
            sessionKey: selectedSessionKey
        )
        guard AutomationSelectionGuard.remainedNeutral(
            before: selectionBefore,
            immediatelyAfterCreation: selectionImmediatelyAfterCreation
        ) else {
            return .failure("创建后台任务会话时改变了桌面选择", sessionKey: key, sessionPath: session.sessionFile)
        }
        let readinessDeadline = Date().addingTimeInterval(30)
        while session.isInitializing && session.processAlive && Date() < readinessDeadline {
            guard !Task.isCancelled else {
                return .failure("自动任务已取消", sessionKey: key, sessionPath: session.sessionFile)
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        guard !session.isInitializing, session.processAlive else {
            return .failure(session.lastError ?? "后台会话启动超时", sessionKey: key, sessionPath: session.sessionFile)
        }
        var prompt = job.prompt
        if let skill = job.skillName?.trimmingCharacters(in: .whitespacesAndNewlines), !skill.isEmpty {
            let skillDeadline = Date().addingTimeInterval(5)
            while !session.availableCommands.contains(where: { $0.source == .skill && $0.name == skill }),
                  session.processAlive,
                  Date() < skillDeadline {
                guard !Task.isCancelled else {
                    return .failure("自动任务已取消", sessionKey: key, sessionPath: session.sessionFile)
                }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            guard session.availableCommands.contains(where: { $0.source == .skill && $0.name == skill }) else {
                return .failure(
                    "所选 Skill 当前不可用：\(skill)",
                    sessionKey: key,
                    sessionPath: session.sessionFile,
                    shouldPause: true
                )
            }
            prompt = "/\(skill) \(prompt)"
        }

        let initialCount = session.transcript.count
        switch session.submitAutomationPrompt(prompt) {
        case .accepted:
            break
        case .empty:
            return .failure("自动任务提示词为空", sessionKey: key, sessionPath: session.sessionFile, shouldPause: true)
        case .rejectedBuiltin(let name):
            return .failure("自动任务不能执行 PipiUI 本地命令：/\(name)", sessionKey: key, sessionPath: session.sessionFile, shouldPause: true)
        case .grantResetFailed:
            return .failure("自动任务未发送：无法清除上一轮路径授权", sessionKey: key, sessionPath: session.sessionFile, shouldPause: true)
        case .unavailable:
            return .failure("后台会话尚不可用", sessionKey: key, sessionPath: session.sessionFile)
        }

        let deadline = Date().addingTimeInterval(30 * 60)
        var observedWork = false
        while Date() < deadline {
            guard !Task.isCancelled else {
                session.abort()
                return .failure("自动任务已取消", sessionKey: key, sessionPath: session.sessionFile)
            }
            if !session.processAlive {
                return .failure(session.lastError ?? "后台 pi 进程已退出", sessionKey: key, sessionPath: session.sessionFile)
            }
            observedWork = observedWork || session.isWorking || session.transcript.count > initialCount
            if observedWork,
               !session.isWorking,
               session.messageQueue.isEmpty,
               session.subagents.runningCount == 0 {
                if let error = session.lastError, !error.isEmpty {
                    return .failure(error, sessionKey: key, sessionPath: session.sessionFile)
                }
                return .success(
                    session.automationResultSummary(afterTranscriptCount: initialCount) ?? "任务已完成",
                    sessionKey: key,
                    sessionPath: session.sessionFile
                )
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        session.abort()
        return AutomationExecutionResult(
            status: .timedOut,
            summary: "任务运行超过 30 分钟，已停止等待。",
            sessionKey: key,
            sessionPath: session.sessionFile,
            shouldPause: true
        )
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
