import Foundation

/// One measured assistant generation for the current model.
/// - `ttft`: time from the `prompt` RPC send to the first visible text token.
/// - `decodeDuration`: generation time from the first token to `message_end`
///   (excludes TTFT, so tokens/s measures decode throughput only).
struct ModelSpeedSample {
    let modelId: String
    let ttft: TimeInterval
    let outputTokens: Int
    let decodeDuration: TimeInterval
}

/// Plain per-model averages over recorded samples.
/// `avgTokensPerSecond` is total output / total decode time (aggregate), which is
/// robust against a single tiny turn skewing the per-sample mean.
struct ModelSpeedStats {
    let avgTTFT: TimeInterval
    let avgTokensPerSecond: Double
    let sampleCount: Int
}

/// In-memory, per-model speed statistics. Pure and unit-testable — no UI, no
/// network, no ChatSession dependency. All call sites run on the main event loop
/// (ChatSession submit / handleEvent / setModel), so no locking is needed.
final class ModelSpeedTracker {
    private var samples: [String: [ModelSpeedSample]] = [:]

    /// Append a sample. Invalid samples are silently dropped:
    /// negative TTFT, non-positive decode time, or zero output tokens.
    func record(_ sample: ModelSpeedSample) {
        guard sample.ttft >= 0, sample.decodeDuration > 0, sample.outputTokens > 0 else { return }
        samples[sample.modelId, default: []].append(sample)
    }

    /// Averages for one model; nil when that model has no recorded samples.
    func stats(for modelId: String) -> ModelSpeedStats? {
        guard let list = samples[modelId], !list.isEmpty else { return nil }
        let ttftSum = list.reduce(0.0) { $0 + $1.ttft }
        let outputSum = list.reduce(0) { $0 + $1.outputTokens }
        let decodeSum = list.reduce(0.0) { $0 + $1.decodeDuration }
        return ModelSpeedStats(
            avgTTFT: ttftSum / Double(list.count),
            avgTokensPerSecond: decodeSum > 0 ? Double(outputSum) / decodeSum : 0,
            sampleCount: list.count
        )
    }

    func resetAll() {
        samples.removeAll(keepingCapacity: false)
    }
}

/// "0.83s" — 2 decimals under 10s, 1 decimal from 10s up.
func formatTTFT(_ seconds: TimeInterval) -> String {
    seconds < 10 ? String(format: "%.2fs", seconds) : String(format: "%.1fs", seconds)
}

/// "42.5 tok/s" — always 1 decimal.
func formatTokensPerSecond(_ tps: Double) -> String {
    String(format: "%.1f tok/s", tps)
}
