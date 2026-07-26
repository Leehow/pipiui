import Foundation

extension ComputerCoordinator {
    func beginExecution(
        requestID: String,
        sessionKey: String,
        request: ComputerRequest,
        application: ComputerApplicationIdentity,
        descriptor: ComputerCaptureDescriptor,
        reply: ComputerResponseGate
    ) {
        guard ComputerUseSettings.isEnabled(),
              sessionConsents.contains(sessionKey),
              !pausedSessionKeys.contains(sessionKey) else {
            reply.respond(Self.failure(
                "computer authorization changed before the approved batch could start"
            ))
            return
        }
        guard inFlightExecution == nil else {
            reply.respond(Self.failure("computer busy: another desktop batch started"))
            return
        }
        let permissions = ComputerPermissions.snapshot()
        guard permissions.screenRecording,
              !request.actions.contains(where: \.emitsInput)
                || permissions.accessibility else {
            reply.respond(Self.failure(
                "required macOS permissions changed before the approved batch could start"
            ))
            return
        }
        guard let current = ComputerFrontmostApplication.current(),
              Self.sameProcess(current, application) else {
            reply.respond(Self.failure(
                "focus or process changed while the desktop batch awaited approval"
            ))
            return
        }
        let currentPolicy = ComputerAppPolicy.decision(
            for: current,
            sessionAllowed: sessionAllowedApps[sessionKey] ?? [],
            persistedAllowed: ComputerUseSettings.persistedAllowedBundleIDs(),
            persistedDenied: ComputerUseSettings.persistedDeniedBundleIDs()
        )
        guard currentPolicy == .allow else {
            reply.respond(Self.failure(
                "application authorization changed before the approved batch could start"
            ))
            return
        }

        do {
            let currentDescriptor = try ComputerUseSettings.captureDescriptor()
            guard currentDescriptor == descriptor else {
                throw ComputerCaptureDescriptorError.providerDescriptorMismatch
            }
            try ComputerInputSynth.shared.validate(
                actions: request.actions,
                imageSize: descriptor.outputSize,
                displayBounds: descriptor.globalBounds
            )
            try ComputerRuntimeBudget.validate(request.actions)
        } catch {
            reply.respond(Self.failure(error.localizedDescription))
            return
        }

        let lease: ComputerLease
        do {
            lease = try leaseController.acquire(
                sessionKey: sessionKey,
                targetBundleID: application.normalizedBundleID,
                actionCount: request.actions.count,
                now: Date()
            )
        } catch {
            if case ComputerLeaseError.targetChanged = error {
                release(sessionKey: sessionKey)
            }
            reply.respond(Self.failure(error.localizedDescription))
            return
        }

        activeSessionKey = sessionKey
        activeApplication = application
        remainingActions = lease.remainingActions
        executionGeneration &+= 1
        let gate = ComputerExecutionGate()
        let execution = ComputerInFlightExecution(
            requestID: requestID,
            sessionKey: sessionKey,
            generation: executionGeneration,
            gate: gate,
            reply: reply
        )
        inFlightExecution = execution
        scheduleExecutionWatchdog(execution)
        scheduleLeaseExpiry(for: lease)
        refreshInputMonitoring()

        let auditID = auditSessionIDs[sessionKey] ?? UUID().uuidString
        auditSessionIDs[sessionKey] = auditID
        Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.executeBatch(
                request,
                execution: execution,
                targetApplication: application,
                descriptor: descriptor
            )
            self.finishBatch(
                result,
                request: request,
                execution: execution,
                auditSessionID: auditID
            )
        }
    }

    func scheduleExecutionWatchdog(_ execution: ComputerInFlightExecution) {
        let work = DispatchWorkItem { [weak self, weak execution] in
            guard let self, let execution,
                  self.inFlightExecution === execution else { return }
            self.abortExecution(
                execution,
                reason: "computer execution exceeded its 20 second safety deadline",
                respond: true
            )
        }
        execution.watchdog = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + ComputerRuntimeBudget.maximumExecutionSeconds,
            execute: work
        )
    }

    func scheduleLeaseExpiry(for lease: ComputerLease) {
        expiryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.leaseController.purgeExpired(now: Date()) else { return }
            if let execution = self.inFlightExecution,
               execution.sessionKey == lease.sessionKey {
                self.abortExecution(
                    execution,
                    reason: "computer desktop lease expired",
                    respond: true
                )
            } else {
                self.clearLeasePresentation()
                ComputerInputSynth.shared.releaseAll()
                self.statusMessage = "Computer Use lease 已超时释放。"
                self.refreshInputMonitoring()
            }
        }
        expiryWork = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(0, lease.expiresAt.timeIntervalSinceNow),
            execute: work
        )
    }

    static func sameProcess(
        _ lhs: ComputerApplicationIdentity,
        _ rhs: ComputerApplicationIdentity
    ) -> Bool {
        lhs.processID == rhs.processID
            && lhs.normalizedBundleID == rhs.normalizedBundleID
    }
}
