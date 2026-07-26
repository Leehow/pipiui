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

    /// Cancellation and the final target check + event post share this lock.
    /// Whichever acquires it first wins: once cancellation returns, no later
    /// normal input post can begin.
    func withActivePost<T>(_ body: () throws -> T) throws -> T {
        try lock.withLock {
            guard !cancelled else {
                throw ComputerInputError.executionStopped
            }
            return try body()
        }
    }
}

final class ComputerResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var didRespond = false
    private let callback: ([String: Any]) -> Void

    init(_ callback: @escaping ([String: Any]) -> Void) {
        self.callback = callback
    }

    func respond(_ response: [String: Any]) {
        let shouldRespond = lock.withLock {
            guard !didRespond else { return false }
            didRespond = true
            return true
        }
        if shouldRespond { callback(response) }
    }
}

final class ComputerInFlightExecution {
    let requestID: String
    let sessionKey: String
    let generation: UInt64
    let gate: ComputerExecutionGate
    let reply: ComputerResponseGate
    var watchdog: DispatchWorkItem?
    private let stateLock = NSLock()
    private var current = true

    var isCurrent: Bool {
        stateLock.withLock { current }
    }

    init(
        requestID: String,
        sessionKey: String,
        generation: UInt64,
        gate: ComputerExecutionGate,
        reply: ComputerResponseGate
    ) {
        self.requestID = requestID
        self.sessionKey = sessionKey
        self.generation = generation
        self.gate = gate
        self.reply = reply
    }

    func markNoLongerCurrent() {
        stateLock.withLock { current = false }
    }
}

final class ComputerCoordinator: ObservableObject {
    static let shared = ComputerCoordinator()

    struct PendingApproval: Identifiable, Equatable {
        enum Kind: Equatable {
            case session
            case application(ComputerApplicationIdentity)
        }

        let id: UUID
        let sessionKey: String
        let kind: Kind

        init(id: UUID = UUID(), sessionKey: String, kind: Kind) {
            self.id = id
            self.sessionKey = sessionKey
            self.kind = kind
        }
    }

    struct PendingWriteApproval: Identifiable, Equatable {
        enum Phase: Equatable {
            case awaitingUserDecision
            case approvedAwaitingTargetRefocus
        }

        let id: UUID
        let requestID: String
        let sessionKey: String
        let fingerprint: String
        let actionKinds: [ComputerActionKind]
        let targetApplication: ComputerApplicationIdentity
        let expiresAt: Date
        var phase: Phase
    }

    @Published var pendingApproval: PendingApproval?
    @Published var pendingWriteApproval: PendingWriteApproval?
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
    var inFlightExecution: ComputerInFlightExecution?
    var pendingWriteContinuation: ComputerPendingWriteContinuation?
    var pendingWriteExpiryWork: DispatchWorkItem?
    var pendingWriteRefocusWork: DispatchWorkItem?
    var expiryWork: DispatchWorkItem?
    var globalMonitor: Any?
    var localMonitor: Any?
    var monitorAccessibilityState: Bool?
    var onEmergencyStop: ((String) -> Void)?
    let supportsInputMonitoring: Bool
    let supportsRefocusPolling: Bool
    let frontmostApplicationProvider:
        @Sendable () -> ComputerApplicationIdentity?
    let targetProcessValidator:
        @Sendable (ComputerApplicationIdentity) -> Bool
    let approvalClock: @Sendable () -> Date
    let inputSynth: ComputerInputSynth

    init(
        supportsInputMonitoring: Bool = true,
        supportsRefocusPolling: Bool = true,
        frontmostApplicationProvider:
            @escaping @Sendable () -> ComputerApplicationIdentity? = {
                ComputerFrontmostApplication.current()
            },
        targetProcessValidator:
            @escaping @Sendable (ComputerApplicationIdentity) -> Bool = {
                ComputerFrontmostApplication.isRunning($0)
            },
        approvalClock: @escaping @Sendable () -> Date = { Date() },
        inputSynth: ComputerInputSynth = .shared
    ) {
        self.supportsInputMonitoring = supportsInputMonitoring
        self.supportsRefocusPolling = supportsRefocusPolling
        self.frontmostApplicationProvider = frontmostApplicationProvider
        self.targetProcessValidator = targetProcessValidator
        self.approvalClock = approvalClock
        self.inputSynth = inputSynth
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

    func approvePendingSession(id: UUID, sessionKey: String) {
        guard pendingApproval?.id == id,
              pendingApproval?.sessionKey == sessionKey,
              pendingApproval?.kind == .session else { return }
        sessionConsents.insert(sessionKey)
        deniedSessionKeys.remove(sessionKey)
        pausedSessionKeys.remove(sessionKey)
        pendingApproval = nil
        statusMessage = "Computer Use 已授权给当前会话；请让模型重试。"
        refreshInputMonitoring()
    }

    func denyPendingSession(id: UUID, sessionKey: String) {
        guard pendingApproval?.id == id,
              pendingApproval?.sessionKey == sessionKey,
              pendingApproval?.kind == .session else { return }
        deniedSessionKeys.insert(sessionKey)
        sessionConsents.remove(sessionKey)
        pendingApproval = nil
        statusMessage = "已拒绝当前会话的 Computer Use。"
        refreshInputMonitoring()
    }

    func allowSessionFromToolbar(_ sessionKey: String) {
        sessionConsents.insert(sessionKey)
        deniedSessionKeys.remove(sessionKey)
        pausedSessionKeys.remove(sessionKey)
        statusMessage = "Computer Use 已授权给当前会话。"
        refreshInputMonitoring()
    }

    func approvePendingApplication(
        id: UUID,
        sessionKey: String,
        persist: Bool
    ) {
        guard let pending = pendingApproval,
              pending.id == id,
              pending.sessionKey == sessionKey,
              case .application(let app) = pending.kind else { return }
        sessionAllowedApps[sessionKey, default: []].insert(app.normalizedBundleID)
        if persist {
            ComputerUseSettings.setPersistedPolicy(
                bundleID: app.normalizedBundleID,
                decision: .allow
            )
        }
        pendingApproval = nil
        statusMessage = persist
            ? "已始终允许 \(app.name)；请让模型重试。"
            : "本会话已允许 \(app.name)；请让模型重试。"
        refreshInputMonitoring()
    }

    func denyPendingApplication(id: UUID, sessionKey: String, persist: Bool) {
        guard let pending = pendingApproval,
              pending.id == id,
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
        refreshInputMonitoring()
    }

    func resumeAfterUserTakeover(_ sessionKey: String) {
        pausedSessionKeys.remove(sessionKey)
        statusMessage = "已解除用户接管暂停；请先切回目标应用，再让模型重试。"
        refreshInputMonitoring()
    }

    func handle(
        request rawRequest: J,
        sessionKey: String,
        respond: @escaping ([String: Any]) -> Void
    ) {
        let reply = ComputerResponseGate(respond)
        guard let requestID = rawRequest["requestID"].string,
              UUID(uuidString: requestID) != nil else {
            reply.respond(Self.failure("computer request is missing a valid requestID"))
            return
        }
        guard ComputerUseSettings.isEnabled() else {
            reply.respond(Self.failure("computer tool is disabled globally"))
            return
        }
        guard !deniedSessionKeys.contains(sessionKey) else {
            reply.respond(Self.failure(
                "computer consent denied for this session; use the toolbar to allow it"
            ))
            return
        }
        guard !pausedSessionKeys.contains(sessionKey) else {
            reply.respond(Self.failure(
                "computer paused after user input; explicitly resume it in PipiUI"
            ))
            return
        }
        guard sessionConsents.contains(sessionKey) else {
            requestSessionApproval(sessionKey: sessionKey, reply: reply)
            return
        }

        let request: ComputerRequest
        do {
            request = try ComputerRequest.normalize(rawRequest)
        } catch {
            reply.respond(Self.failure(error.localizedDescription))
            return
        }
        guard guardPermissions(for: request, reply: reply) else { return }

        guard let application = frontmostApplicationProvider() else {
            reply.respond(Self.failure("frontmost application identity is unavailable"))
            return
        }
        guard authorizeApplication(
            application,
            sessionKey: sessionKey,
            reply: reply
        ) else { return }
        guard inFlightExecution == nil else {
            let message = inFlightExecution?.sessionKey == sessionKey
                ? "computer busy: this session already has a batch in flight"
                : "computer busy: another PipiUI session owns the desktop"
            reply.respond(Self.failure(message))
            return
        }

        let descriptor: ComputerCaptureDescriptor
        do {
            descriptor = try ComputerUseSettings.captureDescriptor()
            try descriptor.validateAdvertisement(
                displayID: rawRequest["displayID"].int,
                width: rawRequest["displayWidth"].int,
                height: rawRequest["displayHeight"].int
            )
            try inputSynth.validate(
                actions: request.actions,
                imageSize: descriptor.outputSize,
                displayBounds: descriptor.globalBounds
            )
            try ComputerRuntimeBudget.validate(request.actions)
        } catch {
            reply.respond(Self.failure(error.localizedDescription))
            return
        }

        if request.requiresWriteApproval {
            do {
                try requestWriteApproval(
                    requestID: requestID,
                    sessionKey: sessionKey,
                    request: request,
                    application: application,
                    descriptor: descriptor,
                    reply: reply
                )
            } catch {
                reply.respond(Self.failure(error.localizedDescription))
            }
            return
        }
        beginExecution(
            requestID: requestID,
            sessionKey: sessionKey,
            request: request,
            application: application,
            descriptor: descriptor,
            reply: reply
        )
    }

    private func guardPermissions(
        for request: ComputerRequest,
        reply: ComputerResponseGate
    ) -> Bool {
        let permissions = ComputerPermissions.snapshot()
        if !permissions.screenRecording {
            statusMessage = "缺少屏幕录制权限。"
            reply.respond(Self.failure(
                "Screen Recording permission is missing; grant it in System Settings"
            ))
            return false
        } else if request.actions.contains(where: \.emitsInput),
                  !permissions.accessibility {
            statusMessage = "缺少辅助功能权限。"
            reply.respond(Self.failure(
                "Accessibility permission is missing; grant it in System Settings"
            ))
            return false
        }
        return true
    }

    static func failure(_ message: String) -> [String: Any] {
        ["ok": false, "error": message]
    }
}
