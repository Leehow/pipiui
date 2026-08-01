import Combine
import Foundation

// MARK: - Per-tool aggregation

/// Aggregate of one tool name over the current session transcript.
package struct ToolStatsRow: Equatable {
    package let name: String
    package let count: Int
    package let totalSeconds: TimeInterval
    /// Total / count, rounded to 1 decimal place.
    package let averageSeconds: TimeInterval
    package let maxSeconds: TimeInterval
}

/// Per-tool-type aggregates, rows sorted by total time descending.
package struct ToolStatsReport: Equatable {
    package var rows: [ToolStatsRow] = []
    package var callCount: Int = 0
    package var totalSeconds: TimeInterval = 0
}

/// Pure aggregation over transcript `toolCall` blocks.
///
/// Only blocks whose `durationSeconds` is non-nil count; still-running or unknown
/// tool calls are excluded entirely. Empty input → empty report with zero totals.
/// `ChatItem` is internal, so this entry point is internal too (tests use @testable).
enum ToolCallStats {
    static func compute(items: [ChatItem]) -> ToolStatsReport {
        var totals: [String: (count: Int, total: TimeInterval, max: TimeInterval)] = [:]
        for item in items {
            for block in item.blocks {
                guard case .toolCall(let call) = block,
                      let duration = call.durationSeconds else { continue }
                var entry = totals[call.name] ?? (0, 0, 0)
                entry.count += 1
                entry.total += duration
                entry.max = max(entry.max, duration)
                totals[call.name] = entry
            }
        }

        let rows = totals
            .map { name, entry in
                ToolStatsRow(
                    name: name,
                    count: entry.count,
                    totalSeconds: entry.total,
                    averageSeconds: (entry.total / Double(entry.count) * 10).rounded() / 10,
                    maxSeconds: entry.max
                )
            }
            .sorted { lhs, rhs in
                if lhs.totalSeconds != rhs.totalSeconds {
                    return lhs.totalSeconds > rhs.totalSeconds
                }
                return lhs.name < rhs.name
            }

        return ToolStatsReport(
            rows: rows,
            callCount: rows.reduce(0) { $0 + $1.count },
            totalSeconds: rows.reduce(0) { $0 + $1.totalSeconds }
        )
    }
}

// MARK: - Sheet trigger

/// App-wide trigger for the tool-stats sheet. Deliberately holds no transcript or
/// session reference — the sheet computes from the live session whenever presented.
package final class ToolStatsPresenter: ObservableObject {
    package static let shared = ToolStatsPresenter()

    /// Monotonic bump per `/stats` request; the input bar observes this to present.
    @Published package private(set) var requestID = 0

    private init() {}

    package func request() {
        requestID += 1
    }
}

// MARK: - Default slash-command behavior

extension BuiltinCommandHost {
    /// Default `/stats` behavior: request the tool-stats sheet. Conformers such as
    /// ChatSession inherit this without any per-session wiring.
    package func runShowToolStats() {
        ToolStatsPresenter.shared.request()
    }
}
