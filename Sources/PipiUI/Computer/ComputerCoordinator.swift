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
    static let shared = ComputerCoordinator(
        cuaDriver: CuaDriverProcessRuntime()
    )

    struct PendingApproval: Identifiable, Equatable {
        enum Kind: Equatable {
            case session
            case application(ComputerRunningApplicationAuthorization)
            case applicationLaunch(ComputerResolvedApplication)
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
    /// Cua Driver pins an exact CGWindowID; the legacy path follows the
    /// frontmost window belonging to `activeApplication` instead.
    @Published var activeWindowID: UInt32?
    /// Published separately from the concrete in-flight object so the AppKit
    /// presentation controller reliably transitions into and out of mini mode.
    @Published var isDesktopOperationActive = false
    @Published var remainingActions: Int?
    @Published var pausedSessionKeys: Set<String> = []
    @Published var deniedSessionKeys: Set<String> = []
    @Published var emergencyStopped = false
    @Published var statusMessage: String?

    var leaseController = ComputerLeaseController()
    var sessionConsents: Set<String> = []
    var sessionAllowedApps: [String: Set<String>] = [:]
    var sessionAllowedApplicationIdentities:
        [String: Set<ComputerApplicationCodeIdentity>] = [:]
    var auditSessionIDs: [String: String] = [:]
    var executionGeneration: UInt64 = 0
    var inFlightExecution: ComputerInFlightExecution?
    var inFlightApplicationOpen: ComputerOpenApplicationExecution?
    var cuaSessionTargets: [String: CuaComputerTarget] = [:]
    var cuaInFlightOperation: CuaInFlightOperation?
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
    let runningApplicationBundleURLResolver:
        @Sendable (ComputerApplicationIdentity) throws -> URL
    let applicationPolicyDefaults: UserDefaults
    let approvalClock: @Sendable () -> Date
    let inputSynth: ComputerInputSynth
    let applicationResolver:
        @Sendable (String) throws -> ComputerResolvedApplication
    let applicationActivator:
        @Sendable (ComputerResolvedApplication) async throws
            -> ComputerActivatedApplication
    let applicationCodeIdentityResolver:
        @Sendable (URL) throws -> ComputerApplicationCodeIdentity
    let runningApplicationCodeIdentityResolver:
        @Sendable (
            ComputerApplicationIdentity,
            ComputerApplicationCodeIdentity
        ) throws -> ComputerApplicationCodeIdentity
    let openApplicationPermissionProvider:
        @Sendable () -> ComputerPermissionSnapshot
    let openApplicationDescriptorProvider:
        @Sendable () throws -> ComputerCaptureDescriptor
    let openApplicationScreenshotProvider:
        @Sendable (
            ComputerCaptureDescriptor,
            ComputerApplicationIdentity
        ) async throws -> ComputerScreenshot
    let computerUseEnabledProvider: @Sendable () -> Bool
    let activationGenerationProvider: @Sendable () -> UInt64
    let openApplicationAuditSink:
        @Sendable (ComputerApplicationOpenAuditRecord) -> Void
    let openApplicationTimeout: TimeInterval
    let openApplicationVerificationTimeout: TimeInterval
    let openApplicationPollInterval: TimeInterval
    let openApplicationQuarantineDelay: TimeInterval
    let cuaDriver: CuaDriverTransport?
    let cuaTargetValidator: @Sendable (CuaComputerTarget) -> Bool

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
        runningApplicationBundleURLResolver:
            @escaping @Sendable (
                ComputerApplicationIdentity
            ) throws -> URL = {
                try ComputerApplicationCodeIdentityResolver
                    .exactRunningBundleURL(for: $0)
            },
        applicationPolicyDefaults: UserDefaults = .standard,
        approvalClock: @escaping @Sendable () -> Date = { Date() },
        inputSynth: ComputerInputSynth = .shared,
        applicationResolver:
            @escaping @Sendable (String) throws -> ComputerResolvedApplication = {
                try ComputerApplicationResolver.resolve(bundleIdentifier: $0)
            },
        applicationActivator:
            @escaping @Sendable (ComputerResolvedApplication) async throws
                -> ComputerActivatedApplication = {
                    try await ComputerApplicationLauncher.activate($0)
                },
        applicationCodeIdentityResolver:
            @escaping @Sendable (URL) throws
                -> ComputerApplicationCodeIdentity = {
                    try ComputerApplicationCodeIdentityResolver.resolve(
                        bundleURL: $0
                    )
                },
        runningApplicationCodeIdentityResolver:
            @escaping @Sendable (
                ComputerApplicationIdentity,
                ComputerApplicationCodeIdentity
            ) throws -> ComputerApplicationCodeIdentity = {
                application,
                expectedIdentity in
                try ComputerApplicationCodeIdentityResolver
                    .resolveRunningApplication(
                        processID: application.processID,
                        expectedIdentity: expectedIdentity
                    )
            },
        openApplicationPermissionProvider:
            @escaping @Sendable () -> ComputerPermissionSnapshot = {
                ComputerPermissions.snapshot()
            },
        openApplicationDescriptorProvider:
            @escaping @Sendable () throws -> ComputerCaptureDescriptor = {
                try ComputerUseSettings.captureDescriptor()
            },
        openApplicationScreenshotProvider:
            @escaping @Sendable (
                ComputerCaptureDescriptor,
                ComputerApplicationIdentity
            ) async throws -> ComputerScreenshot = { descriptor, application in
                try await ComputerScreenCapture.capture(
                    descriptor: descriptor,
                    app: application
                )
            },
        computerUseEnabledProvider: @escaping @Sendable () -> Bool = {
            ComputerUseSettings.isEnabled()
        },
        activationGenerationProvider: @escaping @Sendable () -> UInt64 = {
            ComputerActivationGenerationMonitor.shared.generation
        },
        openApplicationAuditSink:
            @escaping @Sendable (
                ComputerApplicationOpenAuditRecord
            ) -> Void = {
                ComputerAuditLog.shared.append($0)
            },
        openApplicationTimeout: TimeInterval = 20,
        openApplicationVerificationTimeout: TimeInterval = 5,
        openApplicationPollInterval: TimeInterval = 0.05,
        openApplicationQuarantineDelay: TimeInterval = 0.15,
        cuaDriver: CuaDriverTransport? = nil,
        cuaTargetValidator:
            @escaping @Sendable (CuaComputerTarget) -> Bool = { target in
                guard let running = NSRunningApplication(
                    processIdentifier: target.processID
                ), !running.isTerminated else {
                    return false
                }
                return running.bundleIdentifier?.caseInsensitiveCompare(
                    target.bundleID
                ) == .orderedSame
            }
    ) {
        self.supportsInputMonitoring = supportsInputMonitoring
        self.supportsRefocusPolling = supportsRefocusPolling
        self.frontmostApplicationProvider = frontmostApplicationProvider
        self.targetProcessValidator = targetProcessValidator
        self.runningApplicationBundleURLResolver =
            runningApplicationBundleURLResolver
        self.applicationPolicyDefaults = applicationPolicyDefaults
        self.approvalClock = approvalClock
        self.inputSynth = inputSynth
        self.applicationResolver = applicationResolver
        self.applicationActivator = applicationActivator
        self.applicationCodeIdentityResolver =
            applicationCodeIdentityResolver
        self.runningApplicationCodeIdentityResolver =
            runningApplicationCodeIdentityResolver
        self.openApplicationPermissionProvider =
            openApplicationPermissionProvider
        self.openApplicationDescriptorProvider =
            openApplicationDescriptorProvider
        self.openApplicationScreenshotProvider =
            openApplicationScreenshotProvider
        self.computerUseEnabledProvider = computerUseEnabledProvider
        self.activationGenerationProvider = activationGenerationProvider
        self.openApplicationAuditSink = openApplicationAuditSink
        self.openApplicationTimeout = max(0.05, openApplicationTimeout)
        self.openApplicationVerificationTimeout = max(
            0.01,
            min(openApplicationVerificationTimeout, openApplicationTimeout)
        )
        self.openApplicationPollInterval = max(
            0.001,
            openApplicationPollInterval
        )
        self.openApplicationQuarantineDelay = max(
            0.01,
            openApplicationQuarantineDelay
        )
        self.cuaDriver = cuaDriver
        self.cuaTargetValidator = cuaTargetValidator
    }

    func configure(onEmergencyStop: @escaping (String) -> Void) {
        self.onEmergencyStop = onEmergencyStop
    }

    func hasConsent(for sessionKey: String) -> Bool {
        _ = sessionKey
        return computerUseEnabledProvider() && !emergencyStopped
    }

    func isPaused(_ sessionKey: String) -> Bool {
        _ = sessionKey
        return false
    }

    func isActive(_ sessionKey: String) -> Bool {
        activeSessionKey == sessionKey
    }

    /// The global desktop button is the only PipiUI authorization gate.
    /// Re-enabling it clears the emergency-stop latch and retires any stale
    /// approval/takeover state left by an older build.
    func enableGlobalAuthorization() {
        emergencyStopped = false
        deniedSessionKeys.removeAll()
        pausedSessionKeys.removeAll()
        pendingApproval = nil
        clearPendingWriteState()
        statusMessage = "Computer Use 无限制模式已开启。"
        refreshInputMonitoring()
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
              pending.sessionKey == sessionKey else { return }
        let normalizedBundleID: String
        switch pending.kind {
        case .application(let target):
            normalizedBundleID = target.application.normalizedBundleID
        case .applicationLaunch(let target):
            normalizedBundleID = target.codeIdentity.normalizedBundleID
        case .session:
            return
        }
        // A settings change can race an already-rendered approval sheet. The
        // latest user-authored persisted deny always wins over that stale allow
        // button, including when the button requested persistence.
        if ComputerUseSettings.persistedDeniedBundleIDs(
            defaults: applicationPolicyDefaults
        ).contains(normalizedBundleID) {
            pendingApproval = nil
            statusMessage =
                "该目标已被你的持久拒绝规则阻止；旧的允许按钮未生效。"
            refreshInputMonitoring()
            return
        }
        let successMessage: String
        switch pending.kind {
        case .application(let target):
            let current: ComputerRunningApplicationAuthorization
            do {
                current = try resolveRunningApplicationAuthorization(
                    target.application
                )
                guard current.codeIdentity == target.codeIdentity else {
                    throw ComputerApplicationCodeIdentityError.identityDrift
                }
                guard !ComputerUseSettings.persistedDeniedBundleIDs(
                    defaults: applicationPolicyDefaults
                ).contains(normalizedBundleID) else {
                    throw ComputerRequestError.invalidRequest(
                        "application is denied in Computer Use settings"
                    )
                }
            } catch {
                pendingApproval = nil
                statusMessage =
                    "高风险目标身份已变化或被拒绝；旧的允许按钮未生效。"
                refreshInputMonitoring()
                return
            }
            sessionAllowedApplicationIdentities[
                sessionKey,
                default: []
            ].insert(target.codeIdentity)
            if persist {
                ComputerUseSettings.setPersistedApplicationIdentity(
                    target.codeIdentity,
                    allowed: true,
                    defaults: applicationPolicyDefaults
                )
            }
            successMessage = persist
                ? "已持久允许高风险目标 \(target.application.name) 的精确代码身份；请让模型重试。"
                : "本会话已允许高风险目标 \(target.application.name) 的精确代码身份；请让模型重试。"
        case .applicationLaunch(let target):
            sessionAllowedApplicationIdentities[
                sessionKey,
                default: []
            ].insert(target.codeIdentity)
            if persist {
                ComputerUseSettings.setPersistedApplicationIdentity(
                    target.codeIdentity,
                    allowed: true,
                    defaults: applicationPolicyDefaults
                )
            }
            successMessage = persist
                ? "已持久允许 \(target.name) 的精确代码身份；请让模型重试。"
                : "本会话已允许 \(target.name) 的精确代码身份；请让模型重试。"
        case .session:
            return
        }
        pendingApproval = nil
        statusMessage = successMessage
        refreshInputMonitoring()
    }

    func denyPendingApplication(id: UUID, sessionKey: String, persist: Bool) {
        guard let pending = pendingApproval,
              pending.id == id,
              pending.sessionKey == sessionKey else { return }
        let app: ComputerApplicationIdentity
        switch pending.kind {
        case .application(let target):
            app = target.application
        case .applicationLaunch(let target):
            app = target.authorizationIdentity
        case .session:
            return
        }
        if persist {
            ComputerUseSettings.setPersistedPolicy(
                bundleID: app.normalizedBundleID,
                decision: .deny,
                defaults: applicationPolicyDefaults
            )
        }
        pendingApproval = nil
        statusMessage = persist
            ? "已按你的规则持久拒绝 \(app.name)。"
            : "已拒绝本次对 \(app.name) 的请求。"
        refreshInputMonitoring()
    }

    func resumeAfterUserTakeover(_ sessionKey: String) {
        pausedSessionKeys.remove(sessionKey)
        statusMessage = "已解除用户接管暂停；请先切回目标应用，再让模型重试。"
        refreshInputMonitoring()
    }

    func guardSessionAuthorization(
        sessionKey: String,
        reply: ComputerResponseGate
    ) -> Bool {
        guard computerUseEnabledProvider() else {
            reply.respond(Self.failure("computer tool is disabled globally"))
            return false
        }
        guard !emergencyStopped else {
            reply.respond(Self.failure(
                "computer is emergency-stopped; click the global desktop control button to re-enable it"
            ))
            return false
        }
        // Retained only for audit/lifecycle compatibility. There is no
        // per-session approval, deny, pause, or takeover state in unrestricted
        // mode.
        sessionConsents.insert(sessionKey)
        deniedSessionKeys.remove(sessionKey)
        return true
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
        guard guardSessionAuthorization(
            sessionKey: sessionKey,
            reply: reply
        ) else { return }
        if cuaDriver != nil {
            handleCuaBatch(
                request: rawRequest,
                requestID: requestID,
                sessionKey: sessionKey,
                reply: reply
            )
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
        guard inFlightExecution == nil,
              inFlightApplicationOpen == nil else {
            let owner = inFlightExecution?.sessionKey
                ?? inFlightApplicationOpen?.sessionKey
            let message = owner == sessionKey
                ? "computer busy: this session already has desktop work in flight"
                : "computer busy: another PipiUI session owns the desktop"
            reply.respond(Self.failure(message))
            return
        }

        let descriptor: ComputerCaptureDescriptor
        do {
            guard targetProcessValidator(application) else {
                throw ComputerInputError.targetProcessChanged
            }
            guard let current = frontmostApplicationProvider(),
                  Self.sameProcess(current, application) else {
                throw ComputerRequestError.invalidRequest(
                    "frontmost application changed while verifying the target process"
                )
            }
            descriptor = try openApplicationDescriptorProvider()
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

        beginExecution(
            requestID: requestID,
            sessionKey: sessionKey,
            request: request,
            application: application,
            descriptor: descriptor,
            reply: reply
        )
    }

    func guardPermissions(
        for request: ComputerRequest,
        reply: ComputerResponseGate
    ) -> Bool {
        let permissions = openApplicationPermissionProvider()
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
