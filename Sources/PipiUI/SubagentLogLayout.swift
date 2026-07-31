import Foundation

/// Pure render plan for subagent logs. Consecutive tool calls (plus their immediately
/// following results) collapse together, while thinking/text always remain inline boundaries.
enum SubagentLogLayout {
    enum Segment: Equatable, Identifiable {
        case item(AgentLogItem)
        case toolGroup([AgentLogItem])

        /// Tool groups keep the first log item's identity as new streaming rows arrive.
        var id: Int {
            switch self {
            case .item(let item):
                return item.id
            case .toolGroup(let items):
                return items[0].id
            }
        }
    }

    static func plan(_ items: [AgentLogItem]) -> [Segment] {
        var result: [Segment] = []
        var pendingTools: [AgentLogItem] = []

        func flushPending() {
            guard !pendingTools.isEmpty else { return }
            let toolCount = pendingTools.lazy.filter { $0.kind == "tool" }.count
            let hasPairedResult = pendingTools.contains { $0.kind == "toolResult" }
            if toolCount >= 2 || hasPairedResult {
                result.append(.toolGroup(pendingTools))
            } else if let only = pendingTools.first {
                result.append(.item(only))
            }
            pendingTools.removeAll(keepingCapacity: true)
        }

        for item in items {
            switch item.kind {
            case "tool" where item.name == "edit":
                // Edits stay visible so their inline diff is never hidden in a tool group.
                flushPending()
                result.append(.item(item))
            case "tool":
                pendingTools.append(item)
            case "toolResult" where pendingTools.last?.kind == "tool":
                pendingTools.append(item)
            default:
                flushPending()
                result.append(.item(item))
            }
        }
        flushPending()
        return result
    }

    /// Summary like `3 steps · read · grep · edit`; results do not count as steps.
    static func summaryTitle(for items: [AgentLogItem]) -> String {
        let tools = items.filter { $0.kind == "tool" }
        let labels = tools.map(\.name).filter { !$0.isEmpty }
        let suffix = labels.joined(separator: " · ")
        if suffix.isEmpty {
            return "\(tools.count) steps"
        }
        return "\(tools.count) steps · \(suffix)"
    }
}

/// Compact elapsed-time strings shared by live and completed subagent rows.
enum DurationFormat {
    static func compact(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval))
        if seconds < 60 {
            return "\(seconds)s"
        }
        if seconds < 3_600 {
            return "\(seconds / 60)m\(seconds % 60)s"
        }
        return String(format: "%dh%02dm", seconds / 3_600, (seconds % 3_600) / 60)
    }
}
