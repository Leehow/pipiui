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
                guard try openApplicationDescriptorProvider() == descriptor else {
                    throw ComputerCaptureDescriptorError.providerDescriptorMismatch
                }
                guard let before = frontmostApplicationProvider(),
                      Self.sameProcess(before, targetApplication),
                      targetProcessValidator(before) else {
                    throw ComputerInputError.targetProcessChanged
                }
            } catch {
                if case .targetProcessChanged? =
                    error as? ComputerInputError {
                    focusDrift = true
                }
                batchError = error.localizedDescription
                outcomes.append(.init(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: error.localizedDescription
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
                  Self.sameProcess(after, targetApplication),
                  targetProcessValidator(after) else {
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
        let finalContextAuthorized = Self.sameProcess(
            finalApp,
            targetApplication
        ) && targetProcessValidator(finalApp)
        if !finalContextAuthorized {
            focusDrift = true
            batchError = batchError ?? "focus or process drift detected after batch"
        }

        // Every non-cancelled accepted batch returns one fresh in-memory screenshot.
        // Cancellation skips read-only capture so a timed-out task finishes promptly.
        var screenshot: ComputerScreenshot?
        if execution.gate.isCancelled {
            screenshot = nil
            batchError = batchError ?? "computer execution cancelled"
        } else if !finalContextAuthorized {
            screenshot = nil
            batchError = batchError
                ?? "application authorization changed before final capture"
        } else {
            do {
                screenshot = try await openApplicationScreenshotProvider(
                    descriptor,
                    finalApp
                )
            } catch {
                screenshot = nil
                batchError = batchError ?? error.localizedDescription
            }
        }
        if let postCapture = frontmostApplicationProvider() {
            finalApp = postCapture
            if !Self.sameProcess(postCapture, targetApplication)
                || !targetProcessValidator(postCapture) {
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
        // Capture ownership before teardown. A superseded/cancelled task may still
        // finish its post-await screenshot path; without this gate it would retain
        // orphan PNGs in the FIFO cache even when ComputerResponseGate no-ops.
        let ownsExecution = executionIsCurrent(execution)
        if ownsExecution {
            execution.watchdog?.cancel()
            execution.markNoLongerCurrent()
            inFlightExecution = nil
            // Soft end: keep mini chrome through the model-thinking gap.
            scheduleDesktopPresentationGrace(
                statusMessage: result.error == nil
                    ? "桌面操作已完成，等待下一步…"
                    : "桌面操作已结束，等待下一步…"
            )
            _ = leaseController.release(sessionKey: execution.sessionKey)
            inputSynth.releaseAll()
        }

        ComputerAuditLog.shared.append(ComputerAuditRecord(
            timestamp: Date(),
            auditSessionID: auditSessionID,
            app: result.finalApplication,
            actions: request.actions,
            outcomes: result.outcomes,
            focusDrift: result.focusDrift
        ))

        // Lost ownership: never cache, never respond (abort/cancel already settled).
        guard ownsExecution else { return }

        refreshInputMonitoring()

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
        ]
        ComputerScreenshotMemoryCache.attach(
            to: &response,
            pngData: screenshot.pngData
        )
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
