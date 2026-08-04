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

        var configuredEnvVars = Set<String>()
        for envVars in ProviderEnvMap.envVarsByProvider.values {
            for envVar in envVars where envStore.isConfigured(forKey: envVar) {
                configuredEnvVars.insert(envVar)
            }
        }

        // Shared/alias env vars (e.g. OPENAI_API_KEY for both `openai` and
        // `openai-codex`) must collapse to a single canonical provider row
        // per configured key, not one row per aliasing provider.
        for envVar in configuredEnvVars {
            let canonicalOwners = ProviderEnvMap.envVarsByProvider
                .filter { $0.value.first == envVar }
                .map(\.key)
                .sorted()
            if let canonical = canonicalOwners.first {
                ids.insert(canonical)
                continue
            }
            let anyOwners = ProviderEnvMap.envVarsByProvider
                .filter { $0.value.contains(envVar) }
                .map(\.key)
                .sorted()
            if let fallback = anyOwners.first {
                ids.insert(fallback)
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
