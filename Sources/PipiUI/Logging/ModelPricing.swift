import Foundation

/// Official / models.dev list-price catalog for usage-tab cost estimates (CNY).
///
/// Rates are USD-per-1M-tokens unless `currency == .cny`. Long-context tiers
/// (e.g. OpenAI >272k, Gemini/Claude-style >200k) bill the **entire** request
/// at the above-threshold rates when prompt size exceeds the threshold —
/// matching CodexBar / provider docs.
enum ModelPricing {
    enum Currency: String, Equatable {
        case usd
        case cny
    }

    /// Mid-market fallback (≈ BOC / Xe around 2026-07). Refreshed when possible.
    static let defaultUsdToCny: Double = 6.80

    struct RateCard: Equatable {
        var inputPerMTok: Double
        var outputPerMTok: Double
        var cacheReadPerMTok: Double?
        var cacheWritePerMTok: Double?
        /// Prompt-size threshold (tokens). When exceeded, use `above*` rates for the whole turn.
        var thresholdTokens: Int?
        var aboveInputPerMTok: Double?
        var aboveOutputPerMTok: Double?
        var aboveCacheReadPerMTok: Double?
        var aboveCacheWritePerMTok: Double?
        var currency: Currency

        static func usd(
            input: Double,
            output: Double,
            cacheRead: Double? = nil,
            cacheWrite: Double? = nil,
            threshold: Int? = nil,
            aboveInput: Double? = nil,
            aboveOutput: Double? = nil,
            aboveCacheRead: Double? = nil,
            aboveCacheWrite: Double? = nil
        ) -> RateCard {
            RateCard(
                inputPerMTok: input,
                outputPerMTok: output,
                cacheReadPerMTok: cacheRead,
                cacheWritePerMTok: cacheWrite,
                thresholdTokens: threshold,
                aboveInputPerMTok: aboveInput,
                aboveOutputPerMTok: aboveOutput,
                aboveCacheReadPerMTok: aboveCacheRead,
                aboveCacheWritePerMTok: aboveCacheWrite,
                currency: .usd
            )
        }

        static func cny(
            input: Double,
            output: Double,
            cacheRead: Double? = nil,
            cacheWrite: Double? = nil
        ) -> RateCard {
            RateCard(
                inputPerMTok: input,
                outputPerMTok: output,
                cacheReadPerMTok: cacheRead,
                cacheWritePerMTok: cacheWrite,
                thresholdTokens: nil,
                aboveInputPerMTok: nil,
                aboveOutputPerMTok: nil,
                aboveCacheReadPerMTok: nil,
                aboveCacheWritePerMTok: nil,
                currency: .cny
            )
        }
    }

    final class Catalog: @unchecked Sendable {
        static let shared = Catalog()

        private let lock = NSLock()
        private var ratesByModelID: [String: RateCard] = [:]
        private var usdToCny: Double = ModelPricing.defaultUsdToCny

        init(bundledJSON: Data? = nil) {
            loadBundled(bundledJSON)
            applyHardcodedOverrides()
        }

        var exchangeRate: Double {
            lock.lock(); defer { lock.unlock() }
            return usdToCny
        }

        func setExchangeRate(_ rate: Double) {
            guard rate > 0, rate.isFinite else { return }
            lock.lock(); usdToCny = rate; lock.unlock()
        }

        /// Resolve a rate card for a ledger `model` string (`provider/id` or bare id).
        func rate(forModel raw: String) -> RateCard? {
            let aliases = Self.lookupKeys(for: raw)
            lock.lock(); defer { lock.unlock() }
            for key in aliases {
                if let card = ratesByModelID[key] { return card }
            }
            return nil
        }

        /// Estimate cost in CNY. Returns nil when no rate card matches.
        func estimateCNY(
            model: String,
            input: Int,
            output: Int,
            cacheRead: Int,
            cacheWrite: Int,
            contextTokens: Int = 0
        ) -> Double? {
            guard let card = rate(forModel: model) else { return nil }
            let usdOrNative = Self.cost(card: card, input: input, output: output,
                                        cacheRead: cacheRead, cacheWrite: cacheWrite,
                                        contextTokens: contextTokens)
            switch card.currency {
            case .cny: return usdOrNative
            case .usd: return usdOrNative * exchangeRate
            }
        }

        // MARK: - Cost math

        /// Additive accounting (pi / Anthropic / Kimi): `input` is non-cached base;
        /// `cacheRead` / `cacheWrite` are separate buckets — not subsets of `input`.
        static func cost(
            card: RateCard,
            input: Int,
            output: Int,
            cacheRead: Int,
            cacheWrite: Int,
            contextTokens: Int
        ) -> Double {
            let promptSize = contextTokens > 0
                ? contextTokens
                : max(0, input) + max(0, cacheRead) + max(0, cacheWrite)
            let long = card.thresholdTokens.map { promptSize > $0 } ?? false

            let inRate = (long ? card.aboveInputPerMTok : nil) ?? card.inputPerMTok
            let outRate = (long ? card.aboveOutputPerMTok : nil) ?? card.outputPerMTok
            let readRate = (long ? card.aboveCacheReadPerMTok : nil)
                ?? card.cacheReadPerMTok
                ?? inRate * 0.1
            let writeRate = (long ? card.aboveCacheWritePerMTok : nil)
                ?? card.cacheWritePerMTok
                ?? inRate

            let unit = 1_000_000.0
            return Double(max(0, input)) * inRate / unit
                + Double(max(0, output)) * outRate / unit
                + Double(max(0, cacheRead)) * readRate / unit
                + Double(max(0, cacheWrite)) * writeRate / unit
        }

        // MARK: - Lookup keys

        static func lookupKeys(for raw: String) -> [String] {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return [] }
            var keys: [String] = []
            func add(_ s: String) {
                let k = s.lowercased()
                if !k.isEmpty, !keys.contains(k) { keys.append(k) }
            }

            add(trimmed)
            if let slash = trimmed.lastIndex(of: "/") {
                let provider = String(trimmed[..<slash])
                let model = String(trimmed[trimmed.index(after: slash)...])
                add(model)
                add(provider)
                // provider aliases
                for p in Self.providerAliases(provider) {
                    add("\(p)/\(model)")
                }
            }

            // Subscription / short-id aliases → public API list prices.
            for alias in Self.modelAliases(trimmed) {
                add(alias)
            }
            return keys
        }

        private static func providerAliases(_ provider: String) -> [String] {
            switch provider.lowercased() {
            case "kimi-coding", "kimi-for-coding", "moonshot", "moonshotai-cn":
                return ["moonshotai", "moonshotai-cn"]
            case "zai-coding-cn", "zai-coding-plan", "zhipu-coding", "zhipuai-coding-plan", "zhipu":
                return ["zai", "zhipuai"]
            case "openai-codex", "openai-responses":
                return ["openai"]
            case "google-gemini", "google-antigravity":
                return ["google"]
            default:
                return [provider.lowercased()]
            }
        }

        private static func modelAliases(_ raw: String) -> [String] {
            let leaf = raw.split(separator: "/").last.map(String.init)?.lowercased() ?? raw.lowercased()
            switch leaf {
            case "k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed":
                // Subscription stubs price at 0 on models.dev — use K3 API list price.
                return ["kimi-k3", "moonshotai/kimi-k3", "moonshotai-cn/kimi-k3"]
            case "kimi-k3", "kimi_k3":
                return ["kimi-k3"]
            case "auto":
                return []
            default:
                return []
            }
        }

        // MARK: - Load

        private func loadBundled(_ data: Data?) {
            let jsonData: Data?
            if let data {
                jsonData = data
            } else if let url = Bundle.module.url(forResource: "model-pricing", withExtension: "json"),
                      let d = try? Data(contentsOf: url)
            {
                jsonData = d
            } else {
                jsonData = nil
            }
            guard let jsonData,
                  let root = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
            else { return }

            var map: [String: RateCard] = [:]
            for (providerID, providerValue) in root {
                guard let provider = providerValue as? [String: Any],
                      let models = provider["models"] as? [String: Any] else { continue }
                for (modelKey, modelValue) in models {
                    guard let model = modelValue as? [String: Any],
                          let cost = model["cost"] as? [String: Any],
                          let input = Self.double(cost["input"]),
                          let output = Self.double(cost["output"]) else { continue }
                    let card = Self.card(from: cost, input: input, output: output)
                    let mid = (model["id"] as? String) ?? modelKey
                    map[mid.lowercased()] = card
                    map["\(providerID.lowercased())/\(mid.lowercased())"] = card
                    map["\(providerID.lowercased())/\(modelKey.lowercased())"] = card
                }
            }
            lock.lock(); ratesByModelID = map; lock.unlock()
        }

        /// Prefer China list CNY for Moonshot when available; keep USD cards for FX conversion.
        private func applyHardcodedOverrides() {
            // Moonshot China API list (platform docs / 2026-07): ¥20 / ¥2 cache / ¥100 out per 1M.
            let kimiK3CNY = RateCard.cny(input: 20, output: 100, cacheRead: 2)
            let kimiK27CodeCNY = RateCard.cny(input: 6.5, output: 28, cacheRead: 1.3)
            // Approximate CNY from USD list ($0.95/$4/$0.19) * 6.8 ≈ ¥6.5/¥28/¥1.3

            lock.lock()
            defer { lock.unlock() }
            for key in ["kimi-k3", "moonshotai/kimi-k3", "moonshotai-cn/kimi-k3",
                        "k3", "k3-256k", "kimi-coding/k3-256k", "kimi-coding/k3"]
            {
                ratesByModelID[key] = kimiK3CNY
            }
            for key in ["kimi-k2.7-code", "moonshotai/kimi-k2.7-code", "moonshotai-cn/kimi-k2.7-code"] {
                ratesByModelID[key] = kimiK27CodeCNY
            }
        }

        private static func card(from cost: [String: Any], input: Double, output: Double) -> RateCard {
            let cacheRead = double(cost["cache_read"])
            let cacheWrite = double(cost["cache_write"])
            var threshold: Int?
            var aboveIn: Double?
            var aboveOut: Double?
            var aboveRead: Double?
            var aboveWrite: Double?

            if let over = cost["context_over_200k"] as? [String: Any] {
                threshold = 200_000
                aboveIn = double(over["input"])
                aboveOut = double(over["output"])
                aboveRead = double(over["cache_read"])
                aboveWrite = double(over["cache_write"])
            }
            // OpenAI-style tiers may use 272k — prefer explicit tier size when present.
            if let tiers = cost["tiers"] as? [[String: Any]] {
                for tier in tiers {
                    guard let tierMeta = tier["tier"] as? [String: Any],
                          let size = tierMeta["size"] as? Int ?? (tierMeta["size"] as? NSNumber)?.intValue
                    else { continue }
                    threshold = size
                    aboveIn = double(tier["input"]) ?? aboveIn
                    aboveOut = double(tier["output"]) ?? aboveOut
                    aboveRead = double(tier["cache_read"]) ?? aboveRead
                    aboveWrite = double(tier["cache_write"]) ?? aboveWrite
                }
            }

            return .usd(
                input: input,
                output: output,
                cacheRead: cacheRead,
                cacheWrite: cacheWrite,
                threshold: threshold,
                aboveInput: aboveIn,
                aboveOutput: aboveOut,
                aboveCacheRead: aboveRead,
                aboveCacheWrite: aboveWrite
            )
        }

        private static func double(_ any: Any?) -> Double? {
            if let d = any as? Double { return d }
            if let n = any as? NSNumber { return n.doubleValue }
            if let i = any as? Int { return Double(i) }
            return nil
        }
    }

    /// Format a CNY amount for the usage UI.
    static func formatCNY(_ amount: Double) -> String {
        if amount <= 0 { return "¥0" }
        if amount < 0.01 { return String(format: "¥%.4f", amount) }
        if amount < 1 { return String(format: "¥%.3f", amount) }
        return String(format: "¥%.2f", amount)
    }
}
