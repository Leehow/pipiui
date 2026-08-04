import Foundation

struct EmptyStateConfiguredProvider: Equatable, Identifiable, Sendable {
    let providerId: String
    var id: String { providerId }
}

/// Loads configured AI providers for the empty-state landing page.
/// Search-only env keys are ignored; see `ProviderEnvMap.searchEnvVars`.
enum EmptyStateCredentialSummary {
    /// Disk I/O; call off main thread.
    static func load(
        envStore: EnvFileStore = EnvFileStore(),
        authURL: URL = PiAuthStore.defaultAuthURL()
    ) -> [EmptyStateConfiguredProvider] {
        var ids = Set<String>()

        for (providerId, envVars) in ProviderEnvMap.envVarsByProvider {
            if envVars.contains(where: { envStore.isConfigured(forKey: $0) }) {
                ids.insert(providerId)
            }
        }

        for cred in PiAuthStore.list(authURL: authURL) {
            ids.insert(cred.providerId)
        }

        return ids.sorted().map { EmptyStateConfiguredProvider(providerId: $0) }
    }

    /// Pure formatter for a row's trailing status.
    /// Prefer quota over balance when both are available.
    static func statusText(quotaUsedPercent: Double?, balanceText: String?) -> String {
        if let q = quotaUsedPercent {
            return "已用 \(Int(q.rounded()))%"
        }
        if let b = balanceText, !b.isEmpty {
            return b
        }
        return "已配置"
    }
}
