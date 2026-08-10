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
    // This is a maintained set of known high-risk identities, supplemented by
    // known display-name fragments below. A match requests an informed user
    // decision; it is not a categorical deny and is deliberately not presented
    // as complete detection of every terminal, password manager, or system UI.
    private static let sensitiveBundleIDs: Set<String> = [
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
        "dev.warp.warp-stable",
        "dev.warp.warp",
        "net.kovidgoyal.kitty",
        "com.github.wez.wezterm",
        "org.alacritty",
        "co.zeit.hyper",
        "com.raphaelamorim.rio",
        "org.tabby",
        "com.termius-dmg.mac",
        "com.1password.1password",
        "com.agilebits.onepassword7",
        "com.bitwarden.desktop",
        "com.lastpass.lastpass",
        "com.dashlane.dashlane",
        "com.apple.keychainaccess",
    ]

    private static let sensitiveNameFragments = [
        "pipiui", "system settings", "system preferences",
        "password", "1password", "bitwarden", "lastpass", "dashlane",
        "keychain access", "terminal", "iterm", "ghostty", "warp",
        "kitty", "wezterm", "alacritty", "hyper", "tabby", "termius",
        "authentication", "authorization", "securityagent",
    ]

    /// Shared memory boundary: automatic operator recipes must never be
    /// collected for sensitive desktop targets. This deliberately reuses the
    /// same maintained identity/name policy as Computer Use itself, while
    /// ignoring any allow decisions because memory cannot alter authorization.
    static func isSensitiveForMemory(
        bundleID: String?,
        appName: String?
    ) -> Bool {
        let bundle = bundleID?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        let name = appName?.lowercased() ?? ""
        guard !bundle.isEmpty || !name.isEmpty else { return true }
        return bundle == ComputerHostSelfProtection.bundleID.lowercased()
            || sensitiveBundleIDs.contains(bundle)
            || sensitiveNameFragments.contains { name.contains($0) }
    }

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

        // A user-authored persisted deny is the only application-category hard
        // deny. It must win over both session and persisted allows.
        if persistedDenied.contains(bundle) {
            return .deny("\(app.name) is denied in Computer Use settings")
        }
        let isSensitive = bundle.isEmpty
            || bundle == own
            || sensitiveBundleIDs.contains(bundle)
            || sensitiveNameFragments.contains(where: { name.contains($0) })
        if isSensitive {
            // Legacy bundle-level allows remain readable for migration and
            // ordinary applications, but can never authorize a sensitive
            // running process. Sensitive targets are authorized only by their
            // exact ComputerApplicationCodeIdentity in the coordinator.
            return .needsConfirmation
        }
        if sessionAllowed.contains(bundle) || persistedAllowed.contains(bundle) {
            return .allow
        }
        // The bottom desktop-control toggle is the authorization for ordinary
        // installed apps. Unknown neutral apps do not create an approval prompt.
        return .allow
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
    case expired

    var errorDescription: String? {
        switch self {
        case .busy:
            return "computer busy: another PipiUI session owns the desktop lease"
        case .targetChanged(let expected, let actual):
            return "focus drift: lease targets \(expected), frontmost app is \(actual)"
        case .actionBudgetExceeded(let remaining):
            return "computer action budget exceeded (\(remaining) actions remain)"
        case .expired:
            return "computer desktop lease expired; explicitly resume the session before starting a new control epoch"
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

    /// Change the target inside one existing control epoch without renewing its
    /// expiry or budget. Opening/activating an app is charged as an action even
    /// when the target bundle is unchanged.
    mutating func retarget(
        sessionKey: String,
        targetBundleID: String,
        actionCount: Int = 1,
        now: Date
    ) throws -> ComputerLease {
        guard var current = lease else {
            return try acquire(
                sessionKey: sessionKey,
                targetBundleID: targetBundleID,
                actionCount: actionCount,
                now: now
            )
        }
        guard current.sessionKey == sessionKey else {
            throw ComputerLeaseError.busy(
                ownerSessionKey: current.sessionKey
            )
        }
        guard now < current.expiresAt else {
            lease = nil
            throw ComputerLeaseError.expired
        }
        guard actionCount <= current.remainingActions else {
            throw ComputerLeaseError.actionBudgetExceeded(
                remaining: current.remainingActions
            )
        }
        current = ComputerLease(
            sessionKey: current.sessionKey,
            targetBundleID: targetBundleID.lowercased(),
            acquiredAt: current.acquiredAt,
            expiresAt: current.expiresAt,
            remainingActions: current.remainingActions - actionCount
        )
        lease = current
        return current
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
