import XCTest
@testable import PipiUI

final class ModelSpeedTrackerTests: XCTestCase {
    private func makeSample(
        modelId: String = "xai/grok",
        ttft: TimeInterval,
        outputTokens: Int,
        decodeDuration: TimeInterval
    ) -> ModelSpeedSample {
        ModelSpeedSample(
            modelId: modelId,
            ttft: ttft,
            outputTokens: outputTokens,
            decodeDuration: decodeDuration
        )
    }

    // MARK: - record / stats

    func testNilBeforeAnySample() {
        let tracker = ModelSpeedTracker()
        XCTAssertNil(tracker.stats(for: "xai/grok"))
    }

    /// Plain averages: TTFT = sum/count; tokens/s = total output / total decode
    /// (aggregate, not the mean of per-sample rates).
    func testAveragesMultipleSamples() {
        let tracker = ModelSpeedTracker()
        // sample 1: 100 tokens in 2.0s decode (50 tok/s), ttft 0.8s
        tracker.record(makeSample(ttft: 0.8, outputTokens: 100, decodeDuration: 2.0))
        // sample 2: 300 tokens in 3.0s decode (100 tok/s), ttft 1.2s
        tracker.record(makeSample(ttft: 1.2, outputTokens: 300, decodeDuration: 3.0))

        let stats = tracker.stats(for: "xai/grok")
        XCTAssertNotNil(stats)
        XCTAssertEqual(stats?.sampleCount, 2)
        XCTAssertEqual(stats?.avgTTFT ?? -1, 1.0, accuracy: 1e-9)
        // (100 + 300) / (2.0 + 3.0) = 80 tok/s — NOT (50 + 100) / 2 = 75.
        XCTAssertEqual(stats?.avgTokensPerSecond ?? -1, 80.0, accuracy: 1e-9)
    }

    func testPerModelIsolation() {
        let tracker = ModelSpeedTracker()
        tracker.record(makeSample(modelId: "xai/grok", ttft: 0.5, outputTokens: 100, decodeDuration: 2.0))
        tracker.record(makeSample(modelId: "kimi/k3", ttft: 2.0, outputTokens: 50, decodeDuration: 5.0))

        let grok = tracker.stats(for: "xai/grok")
        XCTAssertEqual(grok?.sampleCount, 1)
        XCTAssertEqual(grok?.avgTTFT ?? -1, 0.5, accuracy: 1e-9)
        let kimi = tracker.stats(for: "kimi/k3")
        XCTAssertEqual(kimi?.sampleCount, 1)
        XCTAssertEqual(kimi?.avgTTFT ?? -1, 2.0, accuracy: 1e-9)
        // Unknown model never mixes in.
        XCTAssertNil(tracker.stats(for: "deepseek/r1"))
    }

    func testResetAll() {
        let tracker = ModelSpeedTracker()
        tracker.record(makeSample(ttft: 0.5, outputTokens: 100, decodeDuration: 2.0))
        XCTAssertNotNil(tracker.stats(for: "xai/grok"))
        tracker.resetAll()
        XCTAssertNil(tracker.stats(for: "xai/grok"))
        // Recording after reset still works.
        tracker.record(makeSample(ttft: 1.0, outputTokens: 50, decodeDuration: 1.0))
        XCTAssertEqual(tracker.stats(for: "xai/grok")?.sampleCount, 1)
    }

    func testInvalidSamplesSkipped() {
        let tracker = ModelSpeedTracker()
        tracker.record(makeSample(ttft: -1, outputTokens: 100, decodeDuration: 2.0))   // negative TTFT
        tracker.record(makeSample(ttft: 0.5, outputTokens: 100, decodeDuration: 0))    // zero decode
        tracker.record(makeSample(ttft: 0.5, outputTokens: 100, decodeDuration: -2.0)) // negative decode
        tracker.record(makeSample(ttft: 0.5, outputTokens: 0, decodeDuration: 2.0))    // no output
        XCTAssertNil(tracker.stats(for: "xai/grok"), "all invalid samples must be dropped")
    }

    // MARK: - formatting

    func testFormatTTFT() {
        XCTAssertEqual(formatTTFT(0.83), "0.83s")
        XCTAssertEqual(formatTTFT(1.0), "1.00s")
        XCTAssertEqual(formatTTFT(9.99), "9.99s")
        XCTAssertEqual(formatTTFT(10.0), "10.0s")
        XCTAssertEqual(formatTTFT(12.34), "12.3s")
        XCTAssertEqual(formatTTFT(0), "0.00s")
    }

    func testFormatTokensPerSecond() {
        XCTAssertEqual(formatTokensPerSecond(42.5), "42.5 tok/s")
        XCTAssertEqual(formatTokensPerSecond(0), "0.0 tok/s")
        XCTAssertEqual(formatTokensPerSecond(1234.567), "1234.6 tok/s")
    }
}
