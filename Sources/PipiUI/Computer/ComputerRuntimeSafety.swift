import Foundation

enum ComputerUnicodeChunkError: LocalizedError, Equatable {
    case graphemeExceedsLimit

    var errorDescription: String? {
        switch self {
        case .graphemeExceedsLimit:
            return "one typed grapheme exceeds the macOS 20 UTF-16 unit event limit"
        }
    }
}

enum ComputerUnicodeChunker {
    static let maximumUTF16Units = 20

    /// Splits only between extended grapheme clusters. This keeps surrogate pairs,
    /// variation selectors, combining marks, and joined emoji in one CGEvent.
    static func chunks(
        _ text: String,
        maximumUTF16Units: Int = maximumUTF16Units
    ) throws -> [String] {
        guard maximumUTF16Units > 0 else { return [] }
        var chunks: [String] = []
        var current = ""
        var currentCount = 0

        for character in text {
            let grapheme = String(character)
            let count = grapheme.utf16.count
            guard count <= maximumUTF16Units else {
                throw ComputerUnicodeChunkError.graphemeExceedsLimit
            }
            if currentCount + count > maximumUTF16Units {
                chunks.append(current)
                current = ""
                currentCount = 0
            }
            current.append(character)
            currentCount += count
        }
        if !current.isEmpty {
            chunks.append(current)
        }
        return chunks
    }
}

enum ComputerRuntimeBudget {
    static let maximumApprovalSeconds: TimeInterval = 10
    static let maximumExecutionSeconds: TimeInterval = 20
    static let maximumEstimatedSeconds: TimeInterval = 17
    static let finalCaptureAllowance: TimeInterval = 4
    static let maximumPauseSeconds: TimeInterval = 3
    static let maximumTypedUTF16Units = 4_000

    static func estimatedSeconds(for actions: [ComputerAction]) throws -> TimeInterval {
        var total = finalCaptureAllowance
        for action in actions {
            total += 0.08
            switch action.kind {
            case .wait, .holdKey:
                total += action.duration ?? 1
            case .type:
                let chunks = try ComputerUnicodeChunker.chunks(action.text ?? "")
                total += Double(chunks.count) * 0.03
            case .drag:
                total += 0.4
            case .doubleClick:
                total += 0.12
            case .tripleClick:
                total += 0.18
            default:
                break
            }
        }
        return total
    }

    static func validate(_ actions: [ComputerAction]) throws {
        let estimate = try estimatedSeconds(for: actions)
        guard estimate <= maximumEstimatedSeconds else {
            throw ComputerRequestError.invalidRequest(
                "estimated execution time \(String(format: "%.1f", estimate))s "
                    + "exceeds the \(Int(maximumEstimatedSeconds))s safety budget"
            )
        }
    }
}

struct ComputerActionCursor {
    private let actions: [ComputerAction]
    private var nextIndex = 0

    init(actions: [ComputerAction]) {
        self.actions = actions
    }

    mutating func next(
        gate: ComputerExecutionGate,
        isCurrent: () -> Bool
    ) -> (Int, ComputerAction)? {
        guard !gate.isCancelled,
              isCurrent(),
              nextIndex < actions.count else {
            return nil
        }
        defer { nextIndex += 1 }
        return (nextIndex, actions[nextIndex])
    }
}
