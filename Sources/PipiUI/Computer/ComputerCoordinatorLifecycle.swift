import Foundation
import AppKit

enum ComputerInputMonitorPolicy {
    static func shouldInstall(enabled: Bool, hasRelevantState: Bool) -> Bool {
        _ = hasRelevantState
        return enabled
    }
}

extension ComputerCoordinator {
    var isPresentingDesktopOperation: Bool {
        isDesktopOperationActive
    }

    func cancelRequest(
        requestID: String,
        sessionKey: String,
        reason: String = "computer request transport was cancelled"
    ) {
        if cancelCuaRequest(
            requestID: requestID,
            sessionKey: sessionKey,
            reason: reason,
            respond: false
        ) {
            return
        }
        if let opening = inFlightApplicationOpen,
           opening.requestID == requestID,
           opening.sessionKey == sessionKey {
            abortOpenApplication(
                opening,
                reason: reason,
                respond: false
            )
            return
        }
        guard let execution = inFlightExecution,
              execution.requestID == requestID,
              execution.sessionKey == sessionKey else {
            return
        }
        abortExecution(execution, reason: reason, respond: false)
    }

    func release(sessionKey: String, revokeConsent: Bool = false) {
        releaseCuaSession(sessionKey)
        if pendingApproval?.sessionKey == sessionKey {
            pendingApproval = nil
        }
        if let pending = pendingWriteApproval,
           pending.sessionKey == sessionKey {
            _ = cancelPendingWrite(
                requestID: pending.requestID,
                sessionKey: sessionKey,
                reason: "computer session was released before batch approval"
            )
        }
        if let execution = inFlightExecution,
           execution.sessionKey == sessionKey {
            abortExecution(
                execution,
                reason: "computer session was released",
                respond: true
            )
        } else {
            _ = leaseController.release(sessionKey: sessionKey)
        }
        if let opening = inFlightApplicationOpen,
           opening.sessionKey == sessionKey {
            abortOpenApplication(
                opening,
                reason: "computer session was released during application launch",
                respond: true
            )
        }
        if revokeConsent {
            sessionConsents.remove(sessionKey)
            sessionAllowedApps.removeValue(forKey: sessionKey)
            sessionAllowedApplicationIdentities.removeValue(
                forKey: sessionKey
            )
            deniedSessionKeys.remove(sessionKey)
            pausedSessionKeys.remove(sessionKey)
            auditSessionIDs.removeValue(forKey: sessionKey)
        }
        if activeSessionKey == sessionKey {
            clearLeasePresentation()
        }
        inputSynth.releaseAll()
        refreshInputMonitoring()
    }

    func releaseAll(revokeConsent: Bool) {
        releaseAllCuaSessions()
        if let pending = pendingWriteApproval {
            _ = cancelPendingWrite(
                requestID: pending.requestID,
                sessionKey: pending.sessionKey,
                reason: "computer control was released before batch approval"
            )
        } else {
            clearPendingWriteState()
        }
        if let execution = inFlightExecution {
            abortExecution(
                execution,
                reason: "computer control was released",
                respond: true
            )
        }
        if let opening = inFlightApplicationOpen {
            abortOpenApplication(
                opening,
                reason: "computer control was released during application launch",
                respond: true
            )
        }
        pendingApproval = nil
        executionGeneration &+= 1
        _ = leaseController.release()
        expiryWork?.cancel()
        expiryWork = nil
        clearLeasePresentation()
        if revokeConsent {
            sessionConsents.removeAll()
            sessionAllowedApps.removeAll()
            sessionAllowedApplicationIdentities.removeAll()
            deniedSessionKeys.removeAll()
            pausedSessionKeys.removeAll()
            auditSessionIDs.removeAll()
        }
        inputSynth.releaseAll()
        refreshInputMonitoring()
    }

    /// Desktop-scoped shutdown used by the settings toggle (never the red
    /// 急停 button): cancels every in-flight CUA/legacy/open-application
    /// operation, pending approvals and consent, and releases held input — but
    /// does NOT set `emergencyStopped` and never invokes the `onEmergencyStop`
    /// session-abort callback, so normal main turns, tools and coding subagents
    /// keep running. New desktop calls are rejected by `guardSessionAuthorization`
    /// once the `computerUseEnabledProvider` reads the off state.
    func cancelAllDesktopOperations() {
        releaseAll(revokeConsent: true)
        statusMessage = "Computer Use 已关闭：已取消进行中的桌面操作，新的桌面调用会被拒绝。"
    }

    func emergencyStop(sessionKey: String? = nil) {
        _ = sessionKey
        let affected = affectedSessionKeys()
        // Emergency stop is global. It is the only local-input path that
        // interrupts a desktop operation, and ON explicitly clears this latch.
        emergencyStopped = true
        releaseAll(revokeConsent: true)
        for key in affected.sorted() {
            onEmergencyStop?(key)
        }
        statusMessage = affected.isEmpty
            ? "Computer Use 已全局急停；点击底部桌面按钮可重新开启。"
            : "全局急停已触发：所有相关会话生成与桌面控制均已停止。"
    }

    func affectedSessionKeys() -> Set<String> {
        var keys = sessionConsents
        keys.formUnion(pausedSessionKeys)
        if let key = pendingApproval?.sessionKey { keys.insert(key) }
        if let key = pendingWriteApproval?.sessionKey { keys.insert(key) }
        if let key = inFlightExecution?.sessionKey { keys.insert(key) }
        if let key = inFlightApplicationOpen?.sessionKey { keys.insert(key) }
        if let key = cuaInFlightOperation?.sessionKey { keys.insert(key) }
        keys.formUnion(cuaSessionTargets.keys)
        if let key = activeSessionKey { keys.insert(key) }
        return keys
    }

    func abortExecution(
        _ execution: ComputerInFlightExecution,
        reason: String,
        respond: Bool
    ) {
        guard inFlightExecution === execution else { return }
        execution.watchdog?.cancel()
        execution.gate.cancel()
        execution.markNoLongerCurrent()
        inFlightExecution = nil
        executionGeneration &+= 1
        _ = leaseController.release(sessionKey: execution.sessionKey)
        expiryWork?.cancel()
        expiryWork = nil
        clearLeasePresentation()
        inputSynth.releaseAll()
        if respond {
            execution.reply.respond(Self.failure(reason))
        }
        statusMessage = reason
        refreshInputMonitoring()
    }

    func clearLeasePresentation() {
        activeSessionKey = nil
        activeApplication = nil
        activeWindowID = nil
        isDesktopOperationActive = false
        remainingActions = nil
        Task { @MainActor in
            ComputerUseWindowPresentation.shared.update(for: self)
        }
    }

    @discardableResult
    func releaseIfActionBudgetExhausted(sessionKey: String) -> Bool {
        _ = sessionKey
        return false
    }

    func refreshInputMonitoring(
        permissionSnapshot: ComputerPermissionSnapshot = ComputerPermissions.snapshot()
    ) {
        let hasRelevantState = inFlightExecution != nil
            || inFlightApplicationOpen != nil
        let desired = supportsInputMonitoring
            && ComputerInputMonitorPolicy.shouldInstall(
                enabled: ComputerUseSettings.isEnabled(),
                hasRelevantState: hasRelevantState
            )
        guard desired else {
            removeInputMonitors()
            return
        }
        if monitorAccessibilityState != permissionSnapshot.accessibility {
            removeInputMonitors()
        }
        guard globalMonitor == nil, localMonitor == nil else { return }
        installInputMonitors(accessibility: permissionSnapshot.accessibility)
    }

    func installInputMonitors(accessibility: Bool) {
        let emergencyKeyMask: NSEvent.EventTypeMask = [.keyDown]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: emergencyKeyMask) {
            [weak self] event in
            guard Self.isEmergencyHotkey(event) else { return }
            Task { @MainActor in self?.emergencyStop() }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: emergencyKeyMask) {
            [weak self] event in
            if Self.isEmergencyHotkey(event) {
                Task { @MainActor in self?.emergencyStop() }
                return nil
            }
            return event
        }
        monitorAccessibilityState = accessibility
    }

    func removeInputMonitors() {
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        globalMonitor = nil
        localMonitor = nil
        monitorAccessibilityState = nil
    }

    func shutdownInputMonitoring() {
        removeInputMonitors()
    }

    func observePhysicalInput(_ event: NSEvent) {
        if Self.isEmergencyHotkey(event) {
            emergencyStop()
        }
        // All ordinary local/global mouse, keyboard, drag and scroll activity
        // is deliberately ignored in unrestricted mode.
    }

    static func isEmergencyHotkey(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, event.keyCode == 53 else { return false }
        return event.modifierFlags.contains(.option)
            && event.modifierFlags.contains(.shift)
    }
}
