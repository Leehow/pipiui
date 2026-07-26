import Foundation

struct ComputerApplicationIdentity: Equatable, Sendable {
    let bundleID: String
    let name: String
    let processID: Int32
    let windowTitle: String?

    var normalizedBundleID: String {
        bundleID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

enum ComputerAppPolicyDecision: Equatable {
    case allow
    case deny(String)
    case needsConfirmation
}

enum ComputerAppPolicy {
    private static let permanentDeniedBundleIDs: Set<String> = [
        "com.leehow.pipiui",
        "com.apple.systempreferences",
        "com.apple.systemsettings",
        "com.apple.securityagent",
        "com.apple.authorizationhost",
        "com.apple.loginwindow",
        "com.apple.installer",
        "com.apple.terminal",
        "com.googlecode.iterm2",
        "com.mitchellh.ghostty",
        "com.1password.1password",
        "com.agilebits.onepassword7",
        "com.bitwarden.desktop",
        "com.lastpass.lastpass",
        "com.dashlane.dashlane",
        "com.apple.keychainaccess",
    ]

    private static let permanentlyDeniedNameFragments = [
        "password", "1password", "bitwarden", "lastpass", "dashlane",
        "keychain access", "terminal", "iterm", "ghostty",
        "authentication", "authorization", "securityagent",
    ]

    static func decision(
        for app: ComputerApplicationIdentity,
        sessionAllowed: Set<String>,
        persistedAllowed: Set<String>,
        persistedDenied: Set<String>,
        ownBundleID: String? = Bundle.main.bundleIdentifier
    ) -> ComputerAppPolicyDecision {
        let bundle = app.normalizedBundleID
        let name = app.name.lowercased()
        let own = ownBundleID?.lowercased()

        if bundle.isEmpty {
            return .deny("frontmost application has no bundle identifier")
        }
        if bundle == own || permanentDeniedBundleIDs.contains(bundle) {
            return .deny("computer use is permanently denied for \(app.name)")
        }
        if permanentlyDeniedNameFragments.contains(where: { name.contains($0) }) {
            return .deny("computer use is permanently denied for \(app.name)")
        }
        if persistedDenied.contains(bundle) {
            return .deny("\(app.name) is denied in Computer Use settings")
        }
        if sessionAllowed.contains(bundle) || persistedAllowed.contains(bundle) {
            return .allow
        }
        return .needsConfirmation
    }
}

enum ComputerSensitiveTextPolicy {
    private static let patterns = [
        #"(?i)\b(password|passwd|pwd|token|secret|api[\s_-]?key)\s*[:=]"#,
        #"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b"#,
        #"\bgh[pousr]_[A-Za-z0-9_]{16,}\b"#,
        #"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"#,
        #"\bAKIA[A-Z0-9]{16}\b"#,
        #"\bAIza[A-Za-z0-9_-]{30,}\b"#,
        #"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"#,
    ]

    static func appearsSensitive(_ text: String) -> Bool {
        patterns.contains {
            text.range(of: $0, options: .regularExpression) != nil
        }
    }
}

struct ComputerLease: Equatable, Sendable {
    let sessionKey: String
    let targetBundleID: String
    let acquiredAt: Date
    let expiresAt: Date
    var remainingActions: Int
}

enum ComputerLeaseError: LocalizedError, Equatable {
    case busy(ownerSessionKey: String)
    case targetChanged(expected: String, actual: String)
    case actionBudgetExceeded(remaining: Int)

    var errorDescription: String? {
        switch self {
        case .busy:
            return "computer busy: another PipiUI session owns the desktop lease"
        case .targetChanged(let expected, let actual):
            return "focus drift: lease targets \(expected), frontmost app is \(actual)"
        case .actionBudgetExceeded(let remaining):
            return "computer action budget exceeded (\(remaining) actions remain)"
        }
    }
}

struct ComputerLeaseController {
    let leaseDuration: TimeInterval
    let actionBudget: Int
    private(set) var lease: ComputerLease?

    init(leaseDuration: TimeInterval = 300, actionBudget: Int = 50) {
        self.leaseDuration = leaseDuration
        self.actionBudget = actionBudget
    }

    mutating func purgeExpired(now: Date) -> Bool {
        guard let lease, now >= lease.expiresAt else { return false }
        self.lease = nil
        return true
    }

    mutating func acquire(
        sessionKey: String,
        targetBundleID: String,
        actionCount: Int,
        now: Date
    ) throws -> ComputerLease {
        _ = purgeExpired(now: now)
        let normalizedTarget = targetBundleID.lowercased()
        if var current = lease {
            guard current.sessionKey == sessionKey else {
                throw ComputerLeaseError.busy(ownerSessionKey: current.sessionKey)
            }
            guard current.targetBundleID == normalizedTarget else {
                throw ComputerLeaseError.targetChanged(
                    expected: current.targetBundleID,
                    actual: normalizedTarget
                )
            }
            guard actionCount <= current.remainingActions else {
                throw ComputerLeaseError.actionBudgetExceeded(
                    remaining: current.remainingActions
                )
            }
            current.remainingActions -= actionCount
            lease = current
            return current
        }

        guard actionCount <= actionBudget else {
            throw ComputerLeaseError.actionBudgetExceeded(remaining: actionBudget)
        }
        let acquired = ComputerLease(
            sessionKey: sessionKey,
            targetBundleID: normalizedTarget,
            acquiredAt: now,
            expiresAt: now.addingTimeInterval(leaseDuration),
            remainingActions: actionBudget - actionCount
        )
        lease = acquired
        return acquired
    }

    mutating func release(sessionKey: String? = nil) -> ComputerLease? {
        guard let current = lease else { return nil }
        if let sessionKey, current.sessionKey != sessionKey {
            return nil
        }
        lease = nil
        return current
    }
}
