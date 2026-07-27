import Foundation

/// Pure policy for translating Pi model-list capability metadata into Subagent settings behavior.
enum ThinkingCapability {
    static let standardTags = ["", "off", "minimal", "low", "medium", "high"]
    static let nonReasoningTags = [""]

    struct SelectionResolution: Equatable {
        let modelId: String?
        let thinking: String?
        let didReset: Bool
    }

    enum NormalizationDecision: Equatable {
        case unchanged
        case reset
    }

    private enum LevelOverride {
        case absent
        case unsupported
        case mapped(String)
    }

    static func allowedLevels(
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> [String] {
        guard let reasoning else { return standardTags }
        guard reasoning else { return nonReasoningTags }

        var levels = [""]
        for level in standardTags.dropFirst() {
            if case .unsupported = levelOverride(for: level, in: thinkingLevelMap) {
                continue
            }
            levels.append(level)
        }
        for level in ["xhigh", "max"] {
            if case .mapped = levelOverride(for: level, in: thinkingLevelMap) {
                levels.append(level)
            }
        }
        return levels
    }

    static func allows(
        _ level: String,
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> Bool {
        allowedLevels(reasoning: reasoning, thinkingLevelMap: thinkingLevelMap).contains(level)
    }

    static func resolvedThinking(
        persisted oldThinking: String?,
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> String? {
        let trimmed = oldThinking?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return nil }
        guard let reasoning else { return oldThinking }
        return allows(trimmed, reasoning: reasoning, thinkingLevelMap: thinkingLevelMap)
            ? oldThinking
            : nil
    }

    static func resolveSelection(
        newModelId: String,
        persistedThinking: String?,
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> SelectionResolution {
        let modelId = newModelId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !modelId.isEmpty else {
            return SelectionResolution(modelId: nil, thinking: nil, didReset: false)
        }

        let wasExplicit = persistedThinking?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty == false
        let thinking = resolvedThinking(
            persisted: persistedThinking,
            reasoning: reasoning,
            thinkingLevelMap: thinkingLevelMap
        )
        return SelectionResolution(
            modelId: modelId,
            thinking: thinking,
            didReset: reasoning != nil && wasExplicit && thinking == nil
        )
    }

    static func normalizationDecision(
        modelId: String,
        persistedThinking: String?,
        reasoning: Bool?,
        thinkingLevelMap: [String: String?]?
    ) -> NormalizationDecision {
        guard !modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              persistedThinking?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
              reasoning != nil
        else {
            return .unchanged
        }

        return resolvedThinking(
            persisted: persistedThinking,
            reasoning: reasoning,
            thinkingLevelMap: thinkingLevelMap
        ) == nil ? .reset : .unchanged
    }

    static func parseThinkingLevelMap(_ raw: [String: Any]?) -> [String: String?]? {
        guard let raw, !raw.isEmpty else { return nil }
        var converted: [String: String?] = [:]
        for (key, value) in raw {
            if value is NSNull {
                converted.updateValue(nil, forKey: key)
            } else if let string = value as? String {
                converted[key] = string
            }
        }
        return converted.isEmpty ? nil : converted
    }

    private static func levelOverride(
        for level: String,
        in map: [String: String?]?
    ) -> LevelOverride {
        guard let map, map.keys.contains(level) else { return .absent }
        guard let providerValue = map[level] ?? nil else { return .unsupported }
        guard !providerValue.isEmpty else { return .absent }
        return .mapped(providerValue)
    }
}
