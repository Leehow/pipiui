import Foundation
import XCTest
@testable import PipiUI

final class ThinkingCapabilityTests: XCTestCase {
    private let standard = ["", "off", "minimal", "low", "medium", "high"]
    private let standardLevels = ["off", "minimal", "low", "medium", "high"]

    func testNonReasoningShowsOnlyDefault() {
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(
                reasoning: false,
                thinkingLevelMap: ["off": "none", "xhigh": "high"]
            ),
            [""]
        )
    }

    func testUnknownReasoningFallsBackWithoutDestructiveReset() {
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(reasoning: nil, thinkingLevelMap: ["off": nil]),
            standard
        )
        XCTAssertEqual(
            ThinkingCapability.resolvedThinking(
                persisted: "max",
                reasoning: nil,
                thinkingLevelMap: nil
            ),
            "max"
        )
    }

    func testEveryStandardLevelHonorsAbsentMappedAndExplicitNull() {
        for level in standardLevels {
            XCTAssertTrue(
                ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: nil).contains(level),
                "\(level) should use the standard provider baseline when absent"
            )
            XCTAssertTrue(
                ThinkingCapability.allowedLevels(
                    reasoning: true,
                    thinkingLevelMap: [level: "provider_value"]
                ).contains(level),
                "\(level) should be enabled when explicitly mapped"
            )
            XCTAssertFalse(
                ThinkingCapability.allowedLevels(
                    reasoning: true,
                    thinkingLevelMap: [level: nil]
                ).contains(level),
                "\(level) should be removed when explicitly null"
            )
        }
    }

    func testExtendedLevelsAreOptInAndHonorAllThreeMapStates() {
        for level in ["xhigh", "max"] {
            XCTAssertFalse(
                ThinkingCapability.allowedLevels(reasoning: true, thinkingLevelMap: nil).contains(level)
            )
            XCTAssertTrue(
                ThinkingCapability.allowedLevels(
                    reasoning: true,
                    thinkingLevelMap: [level: "provider_value"]
                ).contains(level)
            )
            XCTAssertFalse(
                ThinkingCapability.allowedLevels(
                    reasoning: true,
                    thinkingLevelMap: [level: nil]
                ).contains(level)
            )
        }
    }

    func testAllowedLevelsRemainOrderedAfterOverrides() {
        XCTAssertEqual(
            ThinkingCapability.allowedLevels(
                reasoning: true,
                thinkingLevelMap: [
                    "off": nil,
                    "medium": nil,
                    "xhigh": "high",
                    "max": "maximum",
                ]
            ),
            ["", "minimal", "low", "high", "xhigh", "max"]
        )
    }

    func testAllowsDefaultAndResolvedThinkingBehavior() {
        XCTAssertTrue(ThinkingCapability.allows("", reasoning: false, thinkingLevelMap: nil))
        XCTAssertNil(
            ThinkingCapability.resolvedThinking(
                persisted: "high",
                reasoning: false,
                thinkingLevelMap: nil
            )
        )
        XCTAssertEqual(
            ThinkingCapability.resolvedThinking(
                persisted: "high",
                reasoning: true,
                thinkingLevelMap: nil
            ),
            "high"
        )
        XCTAssertNil(
            ThinkingCapability.resolvedThinking(
                persisted: "off",
                reasoning: true,
                thinkingLevelMap: ["off": nil]
            )
        )
        XCTAssertNil(
            ThinkingCapability.resolvedThinking(
                persisted: "",
                reasoning: true,
                thinkingLevelMap: nil
            )
        )
    }

    func testParseThinkingLevelMapPreservesNullValueAndAbsentStates() {
        let parsed = ThinkingCapability.parseThinkingLevelMap([
            "xhigh": "provider_high",
            "off": NSNull(),
            "low": 42,
            "medium": true,
        ])

        XCTAssertEqual(parsed?["xhigh"] ?? nil, "provider_high")
        XCTAssertEqual(parsed?.keys.contains("off"), true)
        XCTAssertNil(parsed?["off"] ?? nil)
        XCTAssertEqual(parsed?.keys.contains("low"), false)
        XCTAssertEqual(parsed?.keys.contains("medium"), false)
        XCTAssertEqual(parsed?.keys.contains("max"), false)
        XCTAssertNil(ThinkingCapability.parseThinkingLevelMap(nil))
        XCTAssertNil(ThinkingCapability.parseThinkingLevelMap([:]))
        XCTAssertNil(ThinkingCapability.parseThinkingLevelMap(["low": 42]))
    }

    func testSelectionResolutionCoversResetPreserveFollowMainAndUnknown() {
        XCTAssertEqual(
            ThinkingCapability.resolveSelection(
                newModelId: "",
                persistedThinking: "xhigh",
                reasoning: true,
                thinkingLevelMap: ["xhigh": "high"]
            ),
            .init(modelId: nil, thinking: nil, didReset: false)
        )
        XCTAssertEqual(
            ThinkingCapability.resolveSelection(
                newModelId: "provider/standard",
                persistedThinking: "xhigh",
                reasoning: true,
                thinkingLevelMap: nil
            ),
            .init(modelId: "provider/standard", thinking: nil, didReset: true)
        )
        XCTAssertEqual(
            ThinkingCapability.resolveSelection(
                newModelId: "provider/extended",
                persistedThinking: "xhigh",
                reasoning: true,
                thinkingLevelMap: ["xhigh": "high"]
            ),
            .init(modelId: "provider/extended", thinking: "xhigh", didReset: false)
        )
        XCTAssertEqual(
            ThinkingCapability.resolveSelection(
                newModelId: "provider/unknown",
                persistedThinking: "max",
                reasoning: nil,
                thinkingLevelMap: nil
            ),
            .init(modelId: "provider/unknown", thinking: "max", didReset: false)
        )
    }

    func testNormalizationDecisionIsKnownOnlyAndIdempotent() {
        XCTAssertEqual(
            ThinkingCapability.normalizationDecision(
                modelId: "provider/standard",
                persistedThinking: "xhigh",
                reasoning: true,
                thinkingLevelMap: nil
            ),
            .reset
        )
        XCTAssertEqual(
            ThinkingCapability.normalizationDecision(
                modelId: "provider/standard",
                persistedThinking: nil,
                reasoning: true,
                thinkingLevelMap: nil
            ),
            .unchanged
        )
        XCTAssertEqual(
            ThinkingCapability.normalizationDecision(
                modelId: "",
                persistedThinking: "xhigh",
                reasoning: true,
                thinkingLevelMap: nil
            ),
            .unchanged
        )
        XCTAssertEqual(
            ThinkingCapability.normalizationDecision(
                modelId: "provider/unknown",
                persistedThinking: "xhigh",
                reasoning: nil,
                thinkingLevelMap: nil
            ),
            .unchanged
        )
        XCTAssertEqual(
            ThinkingCapability.normalizationDecision(
                modelId: "provider/standard",
                persistedThinking: "high",
                reasoning: true,
                thinkingLevelMap: nil
            ),
            .unchanged
        )
    }
}
