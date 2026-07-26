import Foundation

struct ComputerPendingWriteContinuation {
    let approvalID: UUID
    let requestID: String
    let sessionKey: String
    let fingerprint: String
    let approve: () -> Void
    let deny: (String) -> Void
}

extension ComputerCoordinator {
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
            expiresAt: now.addingTimeInterval(
                ComputerRuntimeBudget.maximumApprovalSeconds
            )
        )
        pendingWriteApproval = approval
        pendingWriteContinuation = ComputerPendingWriteContinuation(
            approvalID: approval.id,
            requestID: requestID,
            sessionKey: sessionKey,
            fingerprint: fingerprint,
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
        guard let approval = pendingWriteApproval,
              let continuation = pendingWriteContinuation,
              approval.id == id,
              approval.requestID == requestID,
              approval.fingerprint == fingerprint,
              continuation.approvalID == id,
              continuation.requestID == requestID,
              continuation.fingerprint == fingerprint else {
            return false
        }
        guard now < approval.expiresAt else {
            resolvePendingWrite(
                approvalID: id,
                approved: false,
                reason: "sensitive desktop batch approval expired"
            )
            return false
        }
        clearPendingWriteState()
        statusMessage = "已确认精确匹配的桌面动作批次，正在执行。"
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
            approved: false,
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
            approved: false,
            reason: reason
        )
        return true
    }

    private func scheduleWriteApprovalExpiry(_ approval: PendingWriteApproval) {
        pendingWriteExpiryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.resolvePendingWrite(
                approvalID: approval.id,
                approved: false,
                reason: "sensitive desktop batch approval expired"
            )
        }
        pendingWriteExpiryWork = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(0, approval.expiresAt.timeIntervalSinceNow),
            execute: work
        )
    }

    private func resolvePendingWrite(
        approvalID: UUID,
        approved: Bool,
        reason: String
    ) {
        guard pendingWriteApproval?.id == approvalID,
              let continuation = pendingWriteContinuation,
              continuation.approvalID == approvalID else {
            return
        }
        clearPendingWriteState()
        if approved {
            continuation.approve()
        } else {
            continuation.deny(reason)
        }
        refreshInputMonitoring()
    }

    func clearPendingWriteState() {
        pendingWriteExpiryWork?.cancel()
        pendingWriteExpiryWork = nil
        pendingWriteApproval = nil
        pendingWriteContinuation = nil
    }
}
