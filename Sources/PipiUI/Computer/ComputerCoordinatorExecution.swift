import Foundation
import AppKit
import CoreGraphics

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
        sessionKey: String,
        generation: UInt64,
        gate: ComputerExecutionGate,
        targetApplication: ComputerApplicationIdentity,
        displayID: CGDirectDisplayID,
        imageSize: ComputerImageSize,
        displayBounds: CGRect
    ) async -> ComputerBatchExecutionResult {
        var outcomes: [ComputerActionOutcome] = []
        var focusDrift = false
        var batchError: String?

        for (index, action) in request.actions.enumerated() {
            guard !gate.isCancelled,
                  executionGeneration == generation,
                  batchInFlightSessionKey == sessionKey else {
                batchError = "computer execution stopped before action \(index)"
                outcomes.append(ComputerActionOutcome(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: batchError ?? "stopped"
                ))
                break
            }
            if action.emitsInput {
                guard let current = ComputerFrontmostApplication.current(),
                      current.normalizedBundleID == targetApplication.normalizedBundleID else {
                    focusDrift = true
                    batchError = "focus drift detected before action \(index); input stopped"
                    outcomes.append(ComputerActionOutcome(
                        index: index,
                        kind: action.kind,
                        ok: false,
                        message: batchError ?? "focus drift"
                    ))
                    break
                }
            }
            do {
                try await Task.detached(priority: .userInitiated) {
                    try ComputerInputSynth.shared.execute(
                        action,
                        imageSize: imageSize,
                        displayBounds: displayBounds,
                        shouldStop: { gate.isCancelled }
                    )
                }.value
                outcomes.append(ComputerActionOutcome(
                    index: index,
                    kind: action.kind,
                    ok: true,
                    message: action.kind == .screenshot ? "capture requested" : "executed"
                ))
            } catch {
                ComputerInputSynth.shared.releaseAll()
                batchError = error.localizedDescription
                outcomes.append(ComputerActionOutcome(
                    index: index,
                    kind: action.kind,
                    ok: false,
                    message: error.localizedDescription
                ))
                break
            }
        }

        var finalApp = ComputerFrontmostApplication.current() ?? targetApplication
        if finalApp.normalizedBundleID != targetApplication.normalizedBundleID {
            focusDrift = true
            batchError = batchError ?? "focus drift detected after batch"
        }

        // Every accepted batch finishes with one fresh in-memory screenshot, including
        // partial action failures. Emergency stop may invalidate the generation, but the
        // capture remains read-only and gives the model an honest final state.
        let screenshot: ComputerScreenshot?
        do {
            screenshot = try await ComputerScreenCapture.capture(
                displayID: displayID,
                maxLongEdge: ComputerUseSettings.maxLongEdge(),
                app: finalApp
            )
        } catch {
            screenshot = nil
            batchError = batchError ?? error.localizedDescription
        }
        if let postCaptureApp = ComputerFrontmostApplication.current(),
           postCaptureApp.normalizedBundleID != targetApplication.normalizedBundleID {
            finalApp = postCaptureApp
            focusDrift = true
            batchError = batchError ?? "focus drift detected while capturing final state"
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
        sessionKey: String,
        gate: ComputerExecutionGate,
        auditSessionID: String,
        respond: @escaping ([String: Any]) -> Void
    ) {
        let ownsCurrentExecution = executionGate === gate
        if ownsCurrentExecution {
            executionGate = nil
            batchInFlightSessionKey = nil
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

        if result.focusDrift, ownsCurrentExecution {
            release(sessionKey: sessionKey)
            statusMessage = "检测到焦点漂移，桌面 lease 已释放。"
        }

        guard let screenshot = result.screenshot else {
            respond(Self.failure(result.error ?? "final screenshot failed"))
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
        if let error = result.error {
            response["batchError"] = error
        }
        respond(response)
    }

    func scheduleExpiry(for lease: ComputerLease) {
        expiryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if self.leaseController.purgeExpired(now: Date()) {
                self.executionGeneration &+= 1
                self.executionGate?.cancel()
                self.executionGate = nil
                self.batchInFlightSessionKey = nil
                self.activeSessionKey = nil
                self.activeApplication = nil
                self.remainingActions = nil
                ComputerInputSynth.shared.releaseAll()
                self.statusMessage = "Computer Use lease 已超时释放。"
            }
        }
        expiryWork = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(0, lease.expiresAt.timeIntervalSinceNow),
            execute: work
        )
    }

    func installInputMonitors() {
        let userInputMask: NSEvent.EventTypeMask = [
            .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel,
        ]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: userInputMask) {
            [weak self] event in
            Task { @MainActor in
                self?.observePhysicalInput(event)
            }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: userInputMask) {
            [weak self] event in
            if Self.isEmergencyHotkey(event) {
                Task { @MainActor in self?.emergencyStop() }
                return nil
            }
            self?.observePhysicalInput(event)
            return event
        }
    }

    func observePhysicalInput(_ event: NSEvent) {
        if Self.isEmergencyHotkey(event) {
            emergencyStop()
            return
        }
        if event.cgEvent?.getIntegerValueField(.eventSourceUserData)
            == ComputerInputSynth.syntheticEventTag {
            return
        }
        guard let owner = activeSessionKey else { return }
        pausedSessionKeys.insert(owner)
        release(sessionKey: owner)
        statusMessage = "检测到用户鼠标或键盘输入，Computer Use 已暂停并释放控制权。"
    }

    static func isEmergencyHotkey(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, event.keyCode == 53 else { return false }
        return event.modifierFlags.contains(.option)
            && event.modifierFlags.contains(.shift)
    }
}
