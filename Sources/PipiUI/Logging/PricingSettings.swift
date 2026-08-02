import Foundation

/// Display price unit for all spend surfaces. pi stays USD internally; this
/// only changes how spend is *shown* (input-bar popovers, Settings → 用量).
enum PriceUnit: String, CaseIterable {
    case usd
    case cny

    var label: String {
        switch self {
        case .usd: return "美金"
        case .cny: return "人民币"
        }
    }
}

/// UserDefaults-backed display-price settings (mirrors `WebSearchSettings`).
enum PricingSettings {
    static let unitKey = "pipiui.pricing.unit"
    static let usdToCnyKey = "pipiui.pricing.usdToCny"
    static let rateFetchedAtKey = "pipiui.pricing.rateFetchedAt"
    static let rateSourceKey = "pipiui.pricing.rateSource"

    static func unit(defaults: UserDefaults = .standard) -> PriceUnit {
        guard let raw = defaults.string(forKey: unitKey),
              let unit = PriceUnit(rawValue: raw) else { return .usd }
        return unit
    }

    static func setUnit(_ unit: PriceUnit, defaults: UserDefaults = .standard) {
        defaults.set(unit.rawValue, forKey: unitKey)
    }
}

/// Web USD→CNY FX-rate cache + fetch. Primary: Exchange Rate API
/// (open.er-api.com, keyless, daily updates); fallback: Frankfurter/ECB.
///
/// A failed refresh NEVER clears stored values — the last good rate is kept
/// and the UI shows an error hint instead.
enum FXRateStore {
    static let requestTimeout: TimeInterval = 12

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = requestTimeout
        return URLSession(configuration: config)
    }()

    // MARK: - Persistence

    static func storedRate(defaults: UserDefaults = .standard) -> Double? {
        let rate = defaults.double(forKey: PricingSettings.usdToCnyKey)
        return rate > 0 && rate.isFinite ? rate : nil
    }

    static func fetchedAt(defaults: UserDefaults = .standard) -> Date? {
        defaults.object(forKey: PricingSettings.rateFetchedAtKey) as? Date
    }

    static func source(defaults: UserDefaults = .standard) -> String? {
        defaults.string(forKey: PricingSettings.rateSourceKey)
    }

    static func persist(
        rate: Double,
        source: String,
        at date: Date = Date(),
        defaults: UserDefaults = .standard
    ) {
        defaults.set(rate, forKey: PricingSettings.usdToCnyKey)
        defaults.set(date, forKey: PricingSettings.rateFetchedAtKey)
        defaults.set(source, forKey: PricingSettings.rateSourceKey)
    }

    // MARK: - Parse

    /// Parse USD→CNY from either API shape (both use a `rates` map keyed "CNY"):
    /// - Exchange Rate API: `{"result":"success","base_code":"USD","rates":{"CNY":6.76,...}}`
    /// - Frankfurter: `{"amount":1.0,"base":"USD","date":"...","rates":{"CNY":6.7513}}`
    static func parseRate(data: Data) -> Double? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        // Exchange Rate API reports errors via result != "success"; Frankfurter
        // omits the field entirely, so a missing result is tolerated.
        if let result = root["result"] as? String, result != "success" { return nil }
        guard let rates = root["rates"] as? [String: Any],
              let cny = rates["CNY"] as? NSNumber else { return nil }
        let rate = cny.doubleValue
        guard rate > 0, rate.isFinite else { return nil }
        return rate
    }

    // MARK: - Fetch

    /// Fetch the current USD→CNY rate from the web. Tries the primary endpoint
    /// first, then the fallback; on success persists rate + fetchedAt + source.
    /// Returns nil when both sources fail (stored values are left untouched).
    static func refreshFromWeb() async -> Double? {
        let primary = URL(string: "https://open.er-api.com/v6/latest/USD")!
        let fallback = URL(string: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY")!

        if let rate = await fetch(from: primary, source: "Exchange Rate API") {
            return rate
        }
        if let rate = await fetch(from: fallback, source: "Frankfurter/ECB") {
            return rate
        }
        return nil
    }

    private static func fetch(from url: URL, source: String) async -> Double? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = requestTimeout

        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let rate = parseRate(data: data) else { return nil }
        persist(rate: rate, source: source)
        return rate
    }
}

// MARK: - Spend formatting

/// Format a raw pi-USD cost in the chosen display unit. Adaptive precision
/// mirrors `ModelPricing.formatCNY`: 0 → "$0"/"¥0"; < 0.01 → 4 decimals;
/// < 1 → 3 decimals; else 2 decimals.
func formatUSD(_ amount: Double) -> String {
    if amount <= 0 { return "$0" }
    if amount < 0.01 { return String(format: "$%.4f", amount) }
    if amount < 1 { return String(format: "$%.3f", amount) }
    return String(format: "$%.2f", amount)
}

func formatSpend(usdCost: Double, unit: PriceUnit, rate: Double) -> String {
    switch unit {
    case .usd:
        return formatUSD(usdCost)
    case .cny:
        return ModelPricing.formatCNY(usdCost * rate)
    }
}
