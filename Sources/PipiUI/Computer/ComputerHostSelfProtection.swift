import Foundation
import AppKit

/// Immutable host identity used to keep Computer Use from controlling PipiUI.
/// Either the known host bundle or this process's PID is sufficient to reject:
/// a mismatched/spoofed identity must never make the host controllable.
struct ComputerHostSelfProtection: Sendable {
    static let bundleID = CuaDriverProcessRuntime.hostBundleID

    let processID: Int32

    init(processID: Int32 = ProcessInfo.processInfo.processIdentifier) {
        self.processID = processID
    }

    func match(processID candidatePID: Int32, bundleID candidateBundleID: String) -> Match {
        Match(
            processID: candidatePID == processID,
            bundleID: candidateBundleID.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).caseInsensitiveCompare(Self.bundleID) == .orderedSame
        )
    }

    func match(_ application: ComputerApplicationIdentity) -> Match {
        match(processID: application.processID, bundleID: application.bundleID)
    }

    func match(_ target: CuaComputerTarget) -> Match {
        match(processID: target.processID, bundleID: target.bundleID)
    }

    func match(_ application: NSRunningApplication) -> Match {
        match(
            processID: application.processIdentifier,
            bundleID: application.bundleIdentifier ?? ""
        )
    }

    func matches(windowOwnerPID: Int32) -> Bool {
        windowOwnerPID == processID
    }

    struct Match: Equatable, Sendable {
        let processID: Bool
        let bundleID: Bool

        var isHost: Bool { processID || bundleID }
    }
}

enum ComputerHostSelfProtectionError: LocalizedError, Equatable {
    case hostTarget

    var errorDescription: String? {
        "Computer Use cannot control the PipiUI host application itself"
    }

    static let code = "computer_host_self_protection"
}

extension ComputerCoordinator {
    func rejectHostControl(
        actionKind: ComputerActionKind,
        match: ComputerHostSelfProtection.Match
    ) -> ComputerHostSelfProtectionError {
        // Deliberately omit typed text, key values, names, PIDs, and bundle IDs.
        Log.warn(
            "computer host self-protection blocked action=\(actionKind.rawValue) hostPID=\(match.processID) hostBundle=\(match.bundleID)",
            category: .app
        )
        return .hostTarget
    }
}
