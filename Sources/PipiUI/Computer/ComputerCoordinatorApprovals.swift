import Foundation

struct ComputerPendingWriteContinuation {
    let approvalID: UUID
    let requestID: String
    let sessionKey: String
    let fingerprint: String
    let targetApplication: ComputerApplicationIdentity
    let validateContext: () throws -> Void
    let approve: () -> Void
    let deny: (String) -> Void
}

extension ComputerCoordinator {
    static let writeRefocusPollInterval: TimeInterval = 0.05

    func requestSessionApproval(
        sessionKey: String,
        reply: ComputerResponseGate
    ) {
        if let pending = pendingApproval {
            guard pending.sessionKey == sessionKey,
                  pending.kind == .session else {
                reply.respond(Self.failure(
                    "computer busy: another authorization is awaiting a decision"
                ))
                return
            }
        } else {
            pendingApproval = PendingApproval(
                sessionKey: sessionKey,
                kind: .session
            )
        }
        statusMessage = "Computer Use 等待当前会话授权。"
        refreshInputMonitoring()
        reply.respond(Self.failure(
            "computer session consent required; approve it in the PipiUI consent bar, then retry"
        ))
    }

    func authorizeApplication(
        _ application: ComputerApplicationIdentity,
        sessionKey: String,
        reply: ComputerResponseGate
    ) -> Bool {
        let policy = ComputerAppPolicy.decision(
            for: application,
            sessionAllowed: sessionAllowedApps[sessionKey] ?? [],
            persistedAllowed: ComputerUseSettings.persistedAllowedBundleIDs(),
            persistedDenied: ComputerUseSettings.persistedDeniedBundleIDs()
        )
        switch policy {
        case .deny(let reason):
            statusMessage = reason
            reply.respond(Self.failure(reason))
            return false
        case .allow:
            return true
        case .needsConfirmation:
            if let pending = pendingApproval {
                guard pending.sessionKey == sessionKey,
                      pending.kind == .application(application) else {
                    reply.respond(Self.failure(
                        "computer busy: another authorization is awaiting a decision"
                    ))
                    return false
                }
            } else {
                pendingApproval = PendingApproval(
                    sessionKey: sessionKey,
                    kind: .application(application)
                )
            }
            statusMessage = "Computer Use 等待 \(application.name) 的应用级授权。"
            refreshInputMonitoring()
            reply.respond(Self.failure(
                "application authorization required for \(application.name) "
                    + "(\(application.bundleID)); approve the captured identity in PipiUI, then retry"
            ))
            return false
        }
    }

    func requestWriteApproval(
        requestID: String,
        sessionKey: String,
        request: ComputerRequest,
        application: ComputerApplicationIdentity,
        descriptor: ComputerCaptureDescriptor,
        reply: ComputerResponseGate,
        now: Date = Date()
    ) throws {
        guard pendingWriteApproval == nil,
              pendingWriteContinuation == nil else {
            throw ComputerRequestError.invalidRequest(
                "computer busy: a sensitive desktop batch is awaiting approval"
            )
        }
        let fingerprint = try request.approvalFingerprint()
        let approval = PendingWriteApproval(
            id: UUID(),
            requestID: requestID,
            sessionKey: sessionKey,
            fingerprint: fingerprint,
            actionKinds: request.actions.map(\.kind),
            targetApplication: application,
            expiresAt: now.addingTimeInterval(
                ComputerRuntimeBudget.maximumApprovalSeconds
            ),
            phase: .awaitingUserDecision
        )
        pendingWriteApproval = approval
        pendingWriteContinuation = ComputerPendingWriteContinuation(
            approvalID: approval.id,
            requestID: requestID,
            sessionKey: sessionKey,
            fingerprint: fingerprint,
            targetApplication: application,
            validateContext: { [weak self] in
                guard let self else {
                    throw ComputerRequestError.invalidRequest(
                        "computer coordinator disappeared before approved batch start"
                    )
                }
                try self.validateApprovedWriteContext(
                    sessionKey: sessionKey,
                    request: request,
                    application: application,
                    descriptor: descriptor
                )
            },
            approve: { [weak self] in
                self?.beginExecution(
                    requestID: requestID,
                    sessionKey: sessionKey,
                    request: request,
                    application: application,
                    descriptor: descriptor,
                    reply: reply
                )
            },
            deny: { reason in
                reply.respond(Self.failure(reason))
            }
        )
        scheduleWriteApprovalExpiry(approval)
        statusMessage = "Computer Use 等待本批 \(request.actions.count) 个桌面动作的确认。"
        refreshInputMonitoring()
    }

    @discardableResult
    func approvePendingWrite(
        id: UUID,
        requestID: String,
        fingerprint: String,
        now: Date = Date()
    ) -> Bool {
        guard var approval = pendingWriteApproval,
              let continuation = pendingWriteContinuation,
              approval.phase == .awaitingUserDecision,
              approval.id == id,
              approval.requestID == requestID,
              approval.fingerprint == fingerprint,
              continuation.approvalID == id,
              continuation.requestID == requestID,
              continuation.fingerprint == fingerprint,
              continuation.targetApplication == approval.targetApplication else {
            return false
        }
        guard now < approval.expiresAt else {
            resolvePendingWrite(
                approvalID: id,
                reason: "sensitive desktop batch approval expired"
            )
            return false
        }

        approval.phase = .approvedAwaitingTargetRefocus
        pendingWriteApproval = approval
        statusMessage = "动作已确认；请切回 \(approval.targetApplication.name)，保持原进程不变。"
        refreshInputMonitoring()

        _ = evaluateApprovedWriteRefocus(
            approvalID: id,
            now: now,
            scheduleNext: supportsRefocusPolling
        )
        return true
    }

    /// Evaluates one refocus transition synchronously. Tests inject the
    /// frontmost provider and disable automatic polling to make every state
    /// transition deterministic.
    @discardableResult
    func evaluateApprovedWriteRefocus(
        approvalID: UUID,
        now: Date = Date(),
        scheduleNext: Bool = false
    ) -> Bool {
        guard let approval = pendingWriteApproval,
              let continuation = pendingWriteContinuation,
              approval.id == approvalID,
              approval.phase == .approvedAwaitingTargetRefocus,
              continuation.approvalID == approvalID,
              continuation.requestID == approval.requestID,
              continuation.sessionKey == approval.sessionKey,
              continuation.fingerprint == approval.fingerprint,
              continuation.targetApplication == approval.targetApplication else {
            return false
        }
        guard now < approval.expiresAt else {
            resolvePendingWrite(
                approvalID: approvalID,
                reason: "approved desktop batch expired while awaiting target refocus"
            )
            return false
        }

        do {
            try continuation.validateContext()
        } catch {
            resolvePendingWrite(
                approvalID: approvalID,
                reason: error.localizedDescription
            )
            return false
        }

        guard let current = frontmostApplicationProvider() else {
            if scheduleNext { scheduleWriteRefocusCheck(approvalID: approvalID) }
            return false
        }
        let target = approval.targetApplication
        if current.normalizedBundleID == target.normalizedBundleID,
           current.processID != target.processID {
            resolvePendingWrite(
                approvalID: approvalID,
                reason: "target application process was replaced while awaiting refocus"
            )
            return false
        }
        guard Self.sameProcess(current, target) else {
            if scheduleNext { scheduleWriteRefocusCheck(approvalID: approvalID) }
            return false
        }
        guard approvalClock() < approval.expiresAt else {
            let reason = "approved desktop batch expired while awaiting target refocus"
            resolvePendingWrite(approvalID: approvalID, reason: reason)
            return false
        }

        clearPendingWriteState()
        statusMessage = "已回到精确目标进程，开始执行批准的桌面动作。"
        continuation.approve()
        refreshInputMonitoring()
        return true
    }

    @discardableResult
    func denyPendingWrite(
        id: UUID,
        requestID: String,
        fingerprint: String
    ) -> Bool {
        guard let approval = pendingWriteApproval,
              approval.id == id,
              approval.requestID == requestID,
              approval.fingerprint == fingerprint else {
            return false
        }
        resolvePendingWrite(
            approvalID: id,
            reason: "sensitive desktop batch denied by the user"
        )
        statusMessage = "已拒绝该精确桌面动作批次。"
        return true
    }

    func cancelPendingWrite(
        requestID: String,
        sessionKey: String,
        reason: String
    ) -> Bool {
        guard let approval = pendingWriteApproval,
              approval.requestID == requestID,
              approval.sessionKey == sessionKey else {
            return false
        }
        resolvePendingWrite(
            approvalID: approval.id,
            reason: reason
        )
        return true
    }

    private func validateApprovedWriteContext(
        sessionKey: String,
        request: ComputerRequest,
        application: ComputerApplicationIdentity,
        descriptor: ComputerCaptureDescriptor
    ) throws {
        guard ComputerUseSettings.isEnabled(),
              sessionConsents.contains(sessionKey),
              !pausedSessionKeys.contains(sessionKey) else {
            throw ComputerRequestError.invalidRequest(
                "computer authorization changed while awaiting target refocus"
            )
        }
        guard targetProcessValidator(application) else {
            throw ComputerRequestError.invalidRequest(
                "target application process exited while awaiting refocus"
            )
        }
        let permissions = ComputerPermissions.snapshot()
        guard permissions.screenRecording,
              !request.actions.contains(where: \.emitsInput)
                || permissions.accessibility else {
            throw ComputerRequestError.invalidRequest(
                "required macOS permissions changed while awaiting target refocus"
            )
        }
        let policy = ComputerAppPolicy.decision(
            for: application,
            sessionAllowed: sessionAllowedApps[sessionKey] ?? [],
            persistedAllowed: ComputerUseSettings.persistedAllowedBundleIDs(),
            persistedDenied: ComputerUseSettings.persistedDeniedBundleIDs()
        )
        guard policy == .allow else {
            throw ComputerRequestError.invalidRequest(
                "application authorization changed while awaiting target refocus"
            )
        }
        guard try ComputerUseSettings.captureDescriptor() == descriptor else {
            throw ComputerCaptureDescriptorError.providerDescriptorMismatch
        }
        try inputSynth.validate(
            actions: request.actions,
            imageSize: descriptor.outputSize,
            displayBounds: descriptor.globalBounds
        )
        try ComputerRuntimeBudget.validate(request.actions)
    }

    private func scheduleWriteApprovalExpiry(_ approval: PendingWriteApproval) {
        pendingWriteExpiryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.resolvePendingWrite(
                approvalID: approval.id,
                reason: "sensitive desktop batch approval/refocus expired"
            )
        }
        pendingWriteExpiryWork = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(0, approval.expiresAt.timeIntervalSinceNow),
            execute: work
        )
    }

    private func scheduleWriteRefocusCheck(approvalID: UUID) {
        guard supportsRefocusPolling else { return }
        pendingWriteRefocusWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            _ = self?.evaluateApprovedWriteRefocus(
                approvalID: approvalID,
                scheduleNext: true
            )
        }
        pendingWriteRefocusWork = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.writeRefocusPollInterval,
            execute: work
        )
    }

    private func resolvePendingWrite(
        approvalID: UUID,
        reason: String
    ) {
        guard pendingWriteApproval?.id == approvalID,
              let continuation = pendingWriteContinuation,
              continuation.approvalID == approvalID else {
            return
        }
        clearPendingWriteState()
        continuation.deny(reason)
        statusMessage = reason
        refreshInputMonitoring()
    }

    func clearPendingWriteState() {
        pendingWriteExpiryWork?.cancel()
        pendingWriteExpiryWork = nil
        pendingWriteRefocusWork?.cancel()
        pendingWriteRefocusWork = nil
        pendingWriteApproval = nil
        pendingWriteContinuation = nil
    }
}
