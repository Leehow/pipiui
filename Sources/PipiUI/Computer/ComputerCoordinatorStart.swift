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
        guard computerUseEnabledProvider(),
              !emergencyStopped else {
            reply.respond(Self.failure(
                "computer authorization changed before the desktop batch could start"
            ))
            return
        }
        guard inFlightExecution == nil,
              inFlightApplicationOpen == nil else {
            reply.respond(Self.failure("computer busy: another desktop operation started"))
            return
        }
        // Retire any compatibility lease state created by an older build.
        _ = leaseController.release()
        let permissions = openApplicationPermissionProvider()
        guard permissions.screenRecording,
              !request.actions.contains(where: \.emitsInput)
                || permissions.accessibility else {
            reply.respond(Self.failure(
                "required macOS permissions changed before the desktop batch could start"
            ))
            return
        }
        guard let current = frontmostApplicationProvider(),
              Self.sameProcess(current, application),
              targetProcessValidator(current) else {
            reply.respond(Self.failure(
                "focus or process changed while preparing the desktop batch"
            ))
            return
        }
        do {
            let currentDescriptor = try openApplicationDescriptorProvider()
            guard currentDescriptor == descriptor else {
                throw ComputerCaptureDescriptorError.providerDescriptorMismatch
            }
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

        activeSessionKey = sessionKey
        activeApplication = application
        remainingActions = nil
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
                reason: "computer execution exceeded its transport-safe technical deadline",
                respond: true
            )
        }
        execution.watchdog = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + ComputerRuntimeBudget.maximumExecutionSeconds,
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
