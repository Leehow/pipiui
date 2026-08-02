import Foundation

/// ProviderEnvMap — static mapping between pi provider IDs and the
/// environment variable names that carry their API keys.
///
/// Sync sources (keep in sync when pi updates):
/// - pi docs/providers.md "API Keys" table (~lines 54–96)
///   /Users/haoli/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/docs/providers.md
/// - packages/ai `const envMap`:
///   https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/env-api-keys.ts
///
/// Last synced: 2025-01 (verify against the sources above when editing).
///
/// Provider IDs present in this repo (grep-verified in SettingsSheet /
/// PiAuthHelper / ChatSession): `anthropic`, `openai` (incl. `openai-codex`),
/// `google`, `xai`, `kimi-coding`, `zai` (+ `zai-coding-cn`, `zhipu` alias).
/// The table below additionally covers the full pi provider list so future
/// integrations don't need to extend it.
public enum ProviderEnvMap {

    // MARK: - Model providers

    /// pi provider ID → environment variable name.
    /// Some providers accept multiple variables; the first is canonical.
    public static let envVarsByProvider: [String: [String]] = [
        "anthropic": ["ANTHROPIC_API_KEY"],
        "ant-ling": ["ANT_LING_API_KEY"],
        "azure-openai-responses": ["AZURE_OPENAI_API_KEY"],
        "openai": ["OPENAI_API_KEY"],
        "openai-codex": ["OPENAI_API_KEY"],
        "deepseek": ["DEEPSEEK_API_KEY"],
        "siliconflow": ["SILICONFLOW_API_KEY"],
        "nvidia": ["NVIDIA_API_KEY"],
        "google": ["GEMINI_API_KEY"],
        "amazon-bedrock": ["AWS_BEARER_TOKEN_BEDROCK"],
        "mistral": ["MISTRAL_API_KEY"],
        "groq": ["GROQ_API_KEY"],
        "cerebras": ["CEREBRAS_API_KEY"],
        "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY"],
        "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY"],
        "xai": ["XAI_API_KEY"],
        "openrouter": ["OPENROUTER_API_KEY"],
        "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
        "zai": ["ZAI_API_KEY"],
        "zai-coding-cn": ["ZAI_CODING_CN_API_KEY"],
        // Repo-internal alias for Zhipu/GLM endpoints (see ChatSession.swift).
        "zhipu": ["ZAI_API_KEY"],
        "opencode": ["OPENCODE_API_KEY"],
        "opencode-go": ["OPENCODE_API_KEY"],
        "radius": ["RADIUS_API_KEY"],
        "huggingface": ["HF_TOKEN"],
        "fireworks": ["FIREWORKS_API_KEY"],
        "together": ["TOGETHER_API_KEY"],
        "kimi-coding": ["KIMI_API_KEY"],
        // Moonshot open platform shares the Kimi key convention.
        "moonshot": ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
        "minimax": ["MINIMAX_API_KEY"],
        "minimax-cn": ["MINIMAX_CN_API_KEY"],
        "qwen-token-plan": ["QWEN_TOKEN_PLAN_API_KEY"],
        "qwen-token-plan-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
        "xiaomi": ["XIAOMI_API_KEY"],
        "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
        "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
        "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
    ]

    // MARK: - Search backends

    /// Search/web backends used by extensions; keyed by backend name.
    public static let searchEnvVars: [String: String] = [
        "tavily": "TAVILY_API_KEY",
        "brave": "BRAVE_API_KEY",
        "serpapi": "SERPAPI_API_KEY",
        "exa": "EXA_API_KEY",
        // Kimi Code membership search (`api.kimi.com/coding/v1/search`).
        // Shares KIMI_API_KEY with the kimi-coding chat provider; TS also
        // accepts KIMI_CODE_API_KEY / KIMI_SEARCH_API_KEY and auth.json.
        "kimi": "KIMI_API_KEY",
    ]

    // MARK: - Lookups

    /// Canonical (first) env var for a provider ID, or nil if unknown.
    public static func envVar(forProvider provider: String) -> String? {
        envVarsByProvider[provider]?.first
    }

    /// All env vars accepted for a provider ID.
    public static func envVars(forProvider provider: String) -> [String] {
        envVarsByProvider[provider] ?? []
    }

    /// Reverse lookup: provider IDs whose canonical env var matches.
    /// (Search backends are included via `searchEnvVars`.)
    public static func providers(forEnvVar envVar: String) -> [String] {
        var hits = envVarsByProvider
            .filter { $0.value.contains(envVar) }
            .map(\.key)
        hits += searchEnvVars.filter { $0.value == envVar }.map(\.key)
        return hits.sorted()
    }

    /// Whether a provider ID is known to the map.
    public static func isKnown(provider: String) -> Bool {
        envVarsByProvider[provider] != nil
    }
}
