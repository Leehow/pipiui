import Foundation
import AppKit
import CoreGraphics
import Combine

final class ComputerExecutionGate: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.withLock { cancelled }
    }

    func cancel() {
        lock.withLock { cancelled = true }
    }
}

final class ComputerCoordinator: ObservableObject {
    static let shared = ComputerCoordinator()

    struct PendingApproval: Identifiable, Equatable {
        enum Kind: Equatable {
            case session
            case application(ComputerApplicationIdentity)
        }

        let id = UUID()
        let sessionKey: String
        let kind: Kind
    }

    @Published var pendingApproval: PendingApproval?
    @Published var activeSessionKey: String?
    @Published var activeApplication: ComputerApplicationIdentity?
    @Published var remainingActions: Int?
    @Published var pausedSessionKeys: Set<String> = []
    @Published var deniedSessionKeys: Set<String> = []
    @Published var statusMessage: String?

    var leaseController = ComputerLeaseController()
    var sessionConsents: Set<String> = []
    var sessionAllowedApps: [String: Set<String>] = [:]
    var auditSessionIDs: [String: String] = [:]
    var executionGeneration: UInt64 = 0
    var executionGate: ComputerExecutionGate?
    var batchInFlightSessionKey: String?
    var expiryWork: DispatchWorkItem?
    var globalMonitor: Any?
    var localMonitor: Any?
    private var onEmergencyStop: ((String) -> Void)?

    private init() {
        installInputMonitors()
    }

    func configure(onEmergencyStop: @escaping (String) -> Void) {
        self.onEmergencyStop = onEmergencyStop
    }

    func hasConsent(for sessionKey: String) -> Bool {
        sessionConsents.contains(sessionKey)
    }

    func isPaused(_ sessionKey: String) -> Bool {
        pausedSessionKeys.contains(sessionKey)
    }

    func isActive(_ sessionKey: String) -> Bool {
        activeSessionKey == sessionKey
    }

    func approvePendingSession(_ sessionKey: String) {
        guard pendingApproval?.sessionKey == sessionKey,
              pendingApproval?.kind == .session else { return }
        sessionConsents.insert(sessionKey)
        deniedSessionKeys.remove(sessionKey)
        pausedSessionKeys.remove(sessionKey)
        pendingApproval = nil
        statusMessage = "Computer Use 已授权给当前会话；请让模型重试。"
    }

    func denyPendingSession(_ sessionKey: String) {
        guard pendingApproval?.sessionKey == sessionKey else { return }
        deniedSessionKeys.insert(sessionKey)
        sessionConsents.remove(sessionKey)
        pendingApproval = nil
        statusMessage = "已拒绝当前会话的 Computer Use。"
    }

    func allowSessionFromToolbar(_ sessionKey: String) {
        sessionConsents.insert(sessionKey)
        deniedSessionKeys.remove(sessionKey)
        pausedSessionKeys.remove(sessionKey)
        statusMessage = "Computer Use 已授权给当前会话。"
    }

    func approvePendingApplication(
        _ sessionKey: String,
        persist: Bool
    ) {
        guard let pending = pendingApproval,
              pending.sessionKey == sessionKey,
              case .application(let app) = pending.kind else { return }
        let bundleID = app.normalizedBundleID
        sessionAllowedApps[sessionKey, default: []].insert(bundleID)
        if persist {
            ComputerUseSettings.setPersistedPolicy(bundleID: bundleID, decision: .allow)
        }
        pendingApproval = nil
        statusMessage = persist
            ? "已始终允许 \(app.name)；请让模型重试。"
            : "本会话已允许 \(app.name)；请让模型重试。"
    }

    func denyPendingApplication(_ sessionKey: String, persist: Bool) {
        guard let pending = pendingApproval,
              pending.sessionKey == sessionKey,
              case .application(let app) = pending.kind else { return }
        if persist {
            ComputerUseSettings.setPersistedPolicy(
                bundleID: app.normalizedBundleID,
                decision: .deny
            )
        }
        pendingApproval = nil
        statusMessage = persist
            ? "已始终拒绝 \(app.name)。"
            : "已拒绝本次对 \(app.name) 的请求。"
    }

    func resumeAfterUserTakeover(_ sessionKey: String) {
        pausedSessionKeys.remove(sessionKey)
        statusMessage = "已解除用户接管暂停；请先切回目标应用，再让模型重试。"
    }

    func release(sessionKey: String, revokeConsent: Bool = false) {
        if pendingApproval?.sessionKey == sessionKey {
            pendingApproval = nil
        }
        if revokeConsent {
            sessionConsents.remove(sessionKey)
            sessionAllowedApps.removeValue(forKey: sessionKey)
            deniedSessionKeys.remove(sessionKey)
            pausedSessionKeys.remove(sessionKey)
            auditSessionIDs.removeValue(forKey: sessionKey)
        }
        guard leaseController.release(sessionKey: sessionKey) != nil
                || batchInFlightSessionKey == sessionKey else {
            return
        }
        executionGeneration &+= 1
        executionGate?.cancel()
        executionGate = nil
        batchInFlightSessionKey = nil
        expiryWork?.cancel()
        expiryWork = nil
        activeSessionKey = nil
        activeApplication = nil
        remainingActions = nil
        ComputerInputSynth.shared.releaseAll()
    }

    func releaseAll(revokeConsent: Bool) {
        if revokeConsent {
            sessionConsents.removeAll()
            sessionAllowedApps.removeAll()
            deniedSessionKeys.removeAll()
            pausedSessionKeys.removeAll()
            auditSessionIDs.removeAll()
            pendingApproval = nil
        }
        executionGeneration &+= 1
        executionGate?.cancel()
        executionGate = nil
        batchInFlightSessionKey = nil
        _ = leaseController.release()
        expiryWork?.cancel()
        expiryWork = nil
        activeSessionKey = nil
        activeApplication = nil
        remainingActions = nil
        ComputerInputSynth.shared.releaseAll()
    }

    func emergencyStop(sessionKey: String? = nil) {
        if let sessionKey {
            release(sessionKey: sessionKey, revokeConsent: true)
            statusMessage = "急停已触发：桌面控制权与会话授权已撤销，输入状态已释放。"
            onEmergencyStop?(sessionKey)
            return
        }
        let target = activeSessionKey
        releaseAll(revokeConsent: true)
        guard let target else {
            statusMessage = "Computer Use 已全局停止；所有会话授权已撤销。"
            return
        }
        statusMessage = "全局急停已触发：所有桌面控制与会话授权已撤销，输入状态已释放。"
        onEmergencyStop?(target)
    }

    func handle(
        request rawRequest: J,
        sessionKey: String,
        respond: @escaping ([String: Any]) -> Void
    ) {
        guard ComputerUseSettings.isEnabled() else {
            respond(Self.failure("computer tool is disabled globally"))
            return
        }
        guard !deniedSessionKeys.contains(sessionKey) else {
            respond(Self.failure(
                "computer consent denied for this session; use the toolbar to allow it"
            ))
            return
        }
        guard !pausedSessionKeys.contains(sessionKey) else {
            respond(Self.failure(
                "computer paused after user input; explicitly resume it in PipiUI"
            ))
            return
        }
        guard sessionConsents.contains(sessionKey) else {
            guard pendingApproval == nil || pendingApproval?.sessionKey == sessionKey else {
                respond(Self.failure("computer busy: another session is awaiting approval"))
                return
            }
            pendingApproval = PendingApproval(sessionKey: sessionKey, kind: .session)
            statusMessage = "Computer Use 等待当前会话授权。"
            respond(Self.failure(
                "computer session consent required; approve it in the PipiUI consent bar, then retry"
            ))
            return
        }

        let request: ComputerRequest
        do {
            request = try ComputerRequest.normalize(rawRequest)
        } catch {
            respond(Self.failure(error.localizedDescription))
            return
        }

        let permissions = ComputerPermissions.snapshot()
        guard permissions.screenRecording else {
            statusMessage = "缺少屏幕录制权限。"
            respond(Self.failure(
                "Screen Recording permission is missing; grant it in System Settings"
            ))
            return
        }
        if request.actions.contains(where: \.emitsInput), !permissions.accessibility {
            statusMessage = "缺少辅助功能权限。"
            respond(Self.failure(
                "Accessibility permission is missing; grant it in System Settings"
            ))
            return
        }
        guard let application = ComputerFrontmostApplication.current() else {
            respond(Self.failure("frontmost application identity is unavailable"))
            return
        }

        let policy = ComputerAppPolicy.decision(
            for: application,
            sessionAllowed: sessionAllowedApps[sessionKey] ?? [],
            persistedAllowed: ComputerUseSettings.persistedAllowedBundleIDs(),
            persistedDenied: ComputerUseSettings.persistedDeniedBundleIDs()
        )
        switch policy {
        case .deny(let reason):
            statusMessage = reason
            respond(Self.failure(reason))
            return
        case .needsConfirmation:
            guard pendingApproval == nil || pendingApproval?.sessionKey == sessionKey else {
                respond(Self.failure("computer busy: another session is awaiting approval"))
                return
            }
            pendingApproval = PendingApproval(
                sessionKey: sessionKey,
                kind: .application(application)
            )
            statusMessage = "Computer Use 等待 \(application.name) 的应用级授权。"
            respond(Self.failure(
                "application authorization required for \(application.name) "
                    + "(\(application.bundleID)); approve the captured identity in PipiUI, then retry"
            ))
            return
        case .allow:
            break
        }

        if let inFlight = batchInFlightSessionKey {
            let error = inFlight == sessionKey
                ? "computer busy: this session already has a batch in flight"
                : "computer busy: another PipiUI session owns the desktop"
            respond(Self.failure(error))
            return
        }

        let displayID = ComputerUseSettings.selectedDisplayID()
        let imageSize = ComputerUseSettings.providerDisplaySize()
        let displayBounds = CGDisplayBounds(displayID)
        do {
            try ComputerInputSynth.shared.validate(
                actions: request.actions,
                imageSize: imageSize,
                displayBounds: displayBounds
            )
        } catch {
            respond(Self.failure(error.localizedDescription))
            return
        }

        let now = Date()
        let lease: ComputerLease
        do {
            lease = try leaseController.acquire(
                sessionKey: sessionKey,
                targetBundleID: application.normalizedBundleID,
                actionCount: request.actions.count,
                now: now
            )
        } catch {
            if case ComputerLeaseError.targetChanged = error {
                release(sessionKey: sessionKey)
            }
            respond(Self.failure(error.localizedDescription))
            return
        }

        activeSessionKey = sessionKey
        activeApplication = application
        remainingActions = lease.remainingActions
        batchInFlightSessionKey = sessionKey
        executionGeneration &+= 1
        let generation = executionGeneration
        let gate = ComputerExecutionGate()
        executionGate = gate
        scheduleExpiry(for: lease)
        let auditID = auditSessionIDs[sessionKey] ?? UUID().uuidString
        auditSessionIDs[sessionKey] = auditID

        Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.executeBatch(
                request,
                sessionKey: sessionKey,
                generation: generation,
                gate: gate,
                targetApplication: application,
                displayID: displayID,
                imageSize: imageSize,
                displayBounds: displayBounds
            )
            self.finishBatch(
                result,
                request: request,
                sessionKey: sessionKey,
                gate: gate,
                auditSessionID: auditID,
                respond: respond
            )
        }
    }

    static func failure(_ message: String) -> [String: Any] {
        ["ok": false, "error": message]
    }
}
