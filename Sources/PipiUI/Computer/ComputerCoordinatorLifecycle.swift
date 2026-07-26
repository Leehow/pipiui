import Foundation
import AppKit

enum ComputerInputMonitorPolicy {
    static func shouldInstall(enabled: Bool, hasRelevantState: Bool) -> Bool {
        enabled && hasRelevantState
    }
}

extension ComputerCoordinator {
    func cancelRequest(
        requestID: String,
        sessionKey: String,
        reason: String = "computer request transport was cancelled"
    ) {
        if cancelPendingWrite(
            requestID: requestID,
            sessionKey: sessionKey,
            reason: reason
        ) {
            statusMessage = "待确认的桌面动作请求已取消。"
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
        if revokeConsent {
            sessionConsents.remove(sessionKey)
            sessionAllowedApps.removeValue(forKey: sessionKey)
            deniedSessionKeys.remove(sessionKey)
            pausedSessionKeys.remove(sessionKey)
            auditSessionIDs.removeValue(forKey: sessionKey)
        }
        if activeSessionKey == sessionKey {
            clearLeasePresentation()
        }
        ComputerInputSynth.shared.releaseAll()
        refreshInputMonitoring()
    }

    func releaseAll(revokeConsent: Bool) {
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
        pendingApproval = nil
        executionGeneration &+= 1
        _ = leaseController.release()
        expiryWork?.cancel()
        expiryWork = nil
        clearLeasePresentation()
        if revokeConsent {
            sessionConsents.removeAll()
            sessionAllowedApps.removeAll()
            deniedSessionKeys.removeAll()
            pausedSessionKeys.removeAll()
            auditSessionIDs.removeAll()
        }
        ComputerInputSynth.shared.releaseAll()
        refreshInputMonitoring()
    }

    func emergencyStop(sessionKey: String? = nil) {
        let affected = affectedSessionKeys()
        if let sessionKey {
            release(sessionKey: sessionKey, revokeConsent: true)
            statusMessage = "急停已触发：桌面控制权与会话授权已撤销，输入状态已释放。"
            onEmergencyStop?(sessionKey)
            return
        }

        // Snapshot every affected process before state is cleared. This includes
        // pending consent, pending write approval, in-flight, lease, and takeover pause.
        releaseAll(revokeConsent: true)
        for key in affected.sorted() {
            onEmergencyStop?(key)
        }
        statusMessage = affected.isEmpty
            ? "Computer Use 已全局停止；所有会话授权已撤销。"
            : "全局急停已触发：所有相关会话生成、桌面控制与授权均已撤销。"
    }

    func affectedSessionKeys() -> Set<String> {
        var keys = sessionConsents
        keys.formUnion(pausedSessionKeys)
        if let key = pendingApproval?.sessionKey { keys.insert(key) }
        if let key = pendingWriteApproval?.sessionKey { keys.insert(key) }
        if let key = inFlightExecution?.sessionKey { keys.insert(key) }
        if let key = activeSessionKey { keys.insert(key) }
        if let key = leaseController.lease?.sessionKey { keys.insert(key) }
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
        inFlightExecution = nil
        executionGeneration &+= 1
        _ = leaseController.release(sessionKey: execution.sessionKey)
        expiryWork?.cancel()
        expiryWork = nil
        clearLeasePresentation()
        ComputerInputSynth.shared.releaseAll()
        if respond {
            execution.reply.respond(Self.failure(reason))
        }
        statusMessage = reason
        refreshInputMonitoring()
    }

    func clearLeasePresentation() {
        activeSessionKey = nil
        activeApplication = nil
        remainingActions = nil
    }

    @discardableResult
    func releaseIfActionBudgetExhausted(sessionKey: String) -> Bool {
        guard leaseController.lease?.sessionKey == sessionKey,
              leaseController.lease?.remainingActions == 0 else {
            return false
        }
        release(sessionKey: sessionKey)
        return true
    }

    func refreshInputMonitoring(
        permissionSnapshot: ComputerPermissionSnapshot = ComputerPermissions.snapshot()
    ) {
        let hasRelevantState = pendingApproval != nil
            || pendingWriteApproval != nil
            || inFlightExecution != nil
            || activeSessionKey != nil
            || !pausedSessionKeys.isEmpty
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
        let userInputMask: NSEvent.EventTypeMask = [
            .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown,
            .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel,
        ]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: userInputMask) {
            [weak self] event in
            Task { @MainActor in self?.observePhysicalInput(event) }
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
        refreshInputMonitoring()
    }

    static func isEmergencyHotkey(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, event.keyCode == 53 else { return false }
        return event.modifierFlags.contains(.option)
            && event.modifierFlags.contains(.shift)
    }
}
