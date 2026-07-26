import Foundation

struct ComputerBatchExecutionResult {
    let outcomes: [ComputerActionOutcome]
    let screenshot: ComputerScreenshot?
    let finalApplication: ComputerApplicationIdentity
    let focusDrift: Bool
    let error: String?
}

extension ComputerCoordinator {
    @MainActor
    func executeBatch(
        _ request: ComputerRequest,
        execution: ComputerInFlightExecution,
        targetApplication: ComputerApplicationIdentity,
        descriptor: ComputerCaptureDescriptor
    ) async -> ComputerBatchExecutionResult {
        var outcomes: [ComputerActionOutcome] = []
        var focusDrift = false
        var batchError: String?

        var cursor = ComputerActionCursor(actions: request.actions)
        while let (index, action) = cursor.next(
            gate: execution.gate,
            isCurrent: { executionIsCurrent(execution) }
        ) {
            do {
                guard try ComputerUseSettings.captureDescriptor() == descriptor else {
                    throw ComputerCaptureDescriptorError.providerDescriptorMismatch
                }
            } catch {
                batchError = error.localizedDescription
                outcomes.append(.init(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: error.localizedDescription
                ))
                break
            }
            guard let before = frontmostApplicationProvider(),
                  Self.sameProcess(before, targetApplication) else {
                focusDrift = true
                batchError = "focus or process drift detected before action \(index)"
                outcomes.append(.init(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: batchError ?? "focus drift"
                ))
                break
            }

            do {
                let actionInputSynth = inputSynth
                let postGate = ComputerLivePostGate(
                    executionGate: execution.gate,
                    targetApplication: targetApplication,
                    frontmostApplicationProvider: frontmostApplicationProvider,
                    authorizePointer: { point in
                        try ComputerWindowConfinement.authorizeLive(
                            point: point,
                            targetPID: targetApplication.processID
                        )
                    },
                    isExecutionCurrent: { execution.isCurrent }
                )
                try await Task.detached(priority: .userInitiated) {
                    try actionInputSynth.execute(
                        action,
                        imageSize: descriptor.outputSize,
                        displayBounds: descriptor.globalBounds,
                        shouldStop: { execution.gate.isCancelled },
                        postGate: postGate
                    )
                }.value
            } catch {
                inputSynth.releaseAll()
                batchError = error.localizedDescription
                outcomes.append(.init(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: error.localizedDescription
                ))
                break
            }

            guard let after = frontmostApplicationProvider(),
                  Self.sameProcess(after, targetApplication) else {
                inputSynth.releaseAll()
                focusDrift = true
                batchError = "focus or process drift detected after action \(index)"
                outcomes.append(.init(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: batchError ?? "focus drift"
                ))
                break
            }
            outcomes.append(.init(
                index: index,
                kind: action.kind,
                ok: true,
                message: action.kind == .screenshot ? "capture requested" : "executed"
            ))
        }

        var finalApp = frontmostApplicationProvider() ?? targetApplication
        if !Self.sameProcess(finalApp, targetApplication) {
            focusDrift = true
            batchError = batchError ?? "focus or process drift detected after batch"
        }

        // Every non-cancelled accepted batch returns one fresh in-memory screenshot.
        // Cancellation skips read-only capture so a timed-out task finishes promptly.
        let screenshot: ComputerScreenshot?
        if execution.gate.isCancelled {
            screenshot = nil
            batchError = batchError ?? "computer execution cancelled"
        } else {
            do {
                screenshot = try await ComputerScreenCapture.capture(
                    descriptor: descriptor,
                    app: finalApp
                )
            } catch {
                screenshot = nil
                batchError = batchError ?? error.localizedDescription
            }
        }
        if let postCapture = frontmostApplicationProvider() {
            finalApp = postCapture
            if !Self.sameProcess(postCapture, targetApplication) {
                focusDrift = true
                batchError = batchError ?? "focus drift detected while capturing final state"
            }
        } else {
            focusDrift = true
            batchError = batchError ?? "frontmost application disappeared after batch"
        }

        return ComputerBatchExecutionResult(
            outcomes: outcomes,
            screenshot: screenshot,
            finalApplication: finalApp,
            focusDrift: focusDrift,
            error: batchError
        )
    }

    @MainActor
    func finishBatch(
        _ result: ComputerBatchExecutionResult,
        request: ComputerRequest,
        execution: ComputerInFlightExecution,
        auditSessionID: String
    ) {
        let ownsExecution = inFlightExecution === execution
        if ownsExecution {
            execution.watchdog?.cancel()
            execution.markNoLongerCurrent()
            inFlightExecution = nil
            activeApplication = result.finalApplication
        }

        ComputerAuditLog.shared.append(ComputerAuditRecord(
            timestamp: Date(),
            auditSessionID: auditSessionID,
            app: result.finalApplication,
            actions: request.actions,
            outcomes: result.outcomes,
            focusDrift: result.focusDrift
        ))

        let exhausted = leaseController.lease?.sessionKey == execution.sessionKey
            && leaseController.lease?.remainingActions == 0
        if ownsExecution && (result.focusDrift || result.error != nil) {
            release(sessionKey: execution.sessionKey)
            if result.focusDrift {
                statusMessage = "检测到焦点漂移，桌面 lease 已释放。"
            } else {
                statusMessage = "桌面动作失败，lease 与输入状态已释放。"
            }
        } else if ownsExecution && exhausted {
            _ = releaseIfActionBudgetExhausted(
                sessionKey: execution.sessionKey
            )
            statusMessage = "Computer Use 动作预算已耗尽，桌面 lease 已自动释放。"
        } else {
            refreshInputMonitoring()
        }

        guard let screenshot = result.screenshot else {
            execution.reply.respond(Self.failure(
                result.error ?? "final screenshot failed"
            ))
            return
        }
        var response: [String: Any] = [
            "ok": true,
            "batchOK": result.error == nil,
            "outcomes": result.outcomes.map(\.dictionary),
            "focusDrift": result.focusDrift,
            "foregroundApp": [
                "name": result.finalApplication.name,
                "bundleID": result.finalApplication.bundleID,
                "processID": result.finalApplication.processID,
            ],
            "windowTitle": result.finalApplication.windowTitle ?? "",
            "displayID": screenshot.displayID,
            "width": screenshot.imageSize.width,
            "height": screenshot.imageSize.height,
            "mimeType": "image/png",
            "base64": screenshot.base64,
        ]
        if let error = result.error { response["batchError"] = error }
        execution.reply.respond(response)
    }

    func executionIsCurrent(_ execution: ComputerInFlightExecution) -> Bool {
        execution.isCurrent
            && !execution.gate.isCancelled
            && inFlightExecution === execution
            && executionGeneration == execution.generation
    }
}
