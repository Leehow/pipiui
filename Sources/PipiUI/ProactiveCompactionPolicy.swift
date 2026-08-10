import Foundation

/// Pure policy for opportunistic main-session compaction.
///
/// It deliberately knows nothing about RPCs, session events, or subagents. `ChatSession`
/// owns scheduling and supplies only fresh context-usage observations.
struct ProactiveCompactionPolicy {
    struct Configuration: Equatable {
        /// Start compacting before Pi's hard overflow path. These are fractions, not percents.
        var highWatermark: Double
        /// A successful compaction remains disarmed until a newer usage report is below this.
        var lowWatermark: Double
        /// Require a short truly-idle interval before making the RPC.
        var quietDelay: TimeInterval
        /// Avoid repeatedly retrying an unsuccessful compaction while context remains high.
        var failureBackoff: TimeInterval

        static let standard = Configuration(
            highWatermark: 0.80,
            lowWatermark: 0.60,
            quietDelay: 2,
            failureBackoff: 60
        )
    }

    /// A single fresh context report. `percent` uses Pi/UI's existing 0...100 convention.
    struct ContextUsage: Equatable {
        var tokens: Int?
        var contextWindow: Int?
        var percent: Double?

        var fraction: Double? {
            if let tokens, let contextWindow, tokens >= 0, contextWindow > 0 {
                return Double(tokens) / Double(contextWindow)
            }
            if let percent, percent.isFinite, (0...100).contains(percent) {
                return percent / 100
            }
            return nil
        }
    }

    let configuration: Configuration
    private(set) var latestUsage: ContextUsage?
    /// A success cannot re-arm from a pre-compaction/stale stats response.
    private(set) var requiresFreshLowUsageAfterRequest: UInt64?
    private(set) var failureBackoffUntil: Date?

    init(configuration: Configuration = .standard) {
        self.configuration = configuration
    }

    var isArmed: Bool {
        requiresFreshLowUsageAfterRequest == nil
    }

    /// Records a stats response that was issued with `requestGeneration`.
    /// Invalid/nil usage intentionally clears the scheduling sample but never re-arms.
    mutating func observeFreshUsage(_ usage: ContextUsage?, requestGeneration: UInt64) {
        latestUsage = usage
        guard let requiredGeneration = requiresFreshLowUsageAfterRequest,
              requestGeneration > requiredGeneration,
              let fraction = usage?.fraction,
              fraction < configuration.lowWatermark
        else { return }
        requiresFreshLowUsageAfterRequest = nil
    }

    /// Returns the earliest delay at which a quiet-period timer may be armed.
    /// `nil` means the policy is disarmed or context is below the high watermark.
    func nextSchedulingDelay(now: Date) -> TimeInterval? {
        guard isArmed,
              let fraction = latestUsage?.fraction,
              fraction >= configuration.highWatermark
        else { return nil }
        let backoffDelay = failureBackoffUntil.map { max(0, $0.timeIntervalSince(now)) } ?? 0
        return max(configuration.quietDelay, backoffDelay)
    }

    /// Suppress all further proactive compactions until a post-success low-watermark report.
    mutating func recordCompactionSuccess(requiringUsageRequestAfter requestGeneration: UInt64) {
        requiresFreshLowUsageAfterRequest = requestGeneration
        failureBackoffUntil = nil
    }

    mutating func recordCompactionFailure(at now: Date) {
        failureBackoffUntil = now.addingTimeInterval(configuration.failureBackoff)
    }
}
