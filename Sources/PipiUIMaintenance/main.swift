import Darwin
import Foundation
import PipiUI

@main
struct PipiUIMaintenanceCLI {
    private static let perItemTimeoutSeconds: UInt64 = 30

    static func main() async {
        do {
            let command = try parse(arguments: Array(CommandLine.arguments.dropFirst()))
            let exitCode = await run(command: command)
            exit(exitCode)
        } catch {
            writeStandardError("pipiui-maintenance: \(error.localizedDescription)\n\n\(usage)\n")
            exit(2)
        }
    }

    private enum Command {
        case cleanupMerged(CleanupMergedCommand)
        case discardReviewed(DiscardReviewedCommand)
    }

    private struct CleanupMergedCommand {
        let repositoryURL: URL
        let agentIDs: [String]
    }

    private struct DiscardReviewedCommand {
        let repositoryURL: URL
    }

    private enum CommandError: LocalizedError {
        case usage(String)

        var errorDescription: String? {
            switch self {
            case .usage(let detail): return detail
            }
        }
    }

    private static let usage = """
    Usage:
      pipiui-maintenance cleanup-merged-worktrees --repo <path> --agent <id> [--agent <id> ...]
      pipiui-maintenance discard-reviewed-worktrees --repo <path>

    `discard-reviewed-worktrees` has no --agent, --manifest, or --force option. Its exact
    historical scope, expected tip SHAs, and review reasons are compiled into PipiUI.
    """

    private static func parse(arguments: [String]) throws -> Command {
        guard let command = arguments.first else {
            throw CommandError.usage("missing command")
        }
        switch command {
        case "cleanup-merged-worktrees":
            return .cleanupMerged(try parseCleanupMerged(arguments: Array(arguments.dropFirst())))
        case "discard-reviewed-worktrees":
            return .discardReviewed(try parseDiscardReviewed(arguments: Array(arguments.dropFirst())))
        default:
            throw CommandError.usage("unknown command: \(command)")
        }
    }

    private static func parseCleanupMerged(arguments: [String]) throws -> CleanupMergedCommand {
        var repositoryPath: String?
        var agentIDs: [String] = []
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            index += 1
            switch argument {
            case "--repo":
                guard index < arguments.count else {
                    throw CommandError.usage("--repo requires a path")
                }
                guard repositoryPath == nil else {
                    throw CommandError.usage("--repo may be supplied once")
                }
                repositoryPath = arguments[index]
                index += 1
            case "--agent":
                guard index < arguments.count else {
                    throw CommandError.usage("--agent requires an id")
                }
                let id = arguments[index].trimmingCharacters(in: .whitespacesAndNewlines)
                guard !id.isEmpty else {
                    throw CommandError.usage("--agent id cannot be empty")
                }
                agentIDs.append(id)
                index += 1
            default:
                throw CommandError.usage("unexpected argument: \(argument)")
            }
        }

        guard let repositoryPath,
              !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CommandError.usage("--repo is required")
        }
        guard !agentIDs.isEmpty else {
            throw CommandError.usage("at least one --agent is required")
        }
        return CleanupMergedCommand(
            repositoryURL: URL(fileURLWithPath: repositoryPath, isDirectory: true),
            agentIDs: agentIDs
        )
    }

    private static func parseDiscardReviewed(arguments: [String]) throws -> DiscardReviewedCommand {
        var repositoryPath: String?
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            index += 1
            switch argument {
            case "--repo":
                guard index < arguments.count else {
                    throw CommandError.usage("--repo requires a path")
                }
                guard repositoryPath == nil else {
                    throw CommandError.usage("--repo may be supplied once")
                }
                repositoryPath = arguments[index]
                index += 1
            default:
                throw CommandError.usage(
                    "discard-reviewed-worktrees accepts only --repo; refusing \(argument)"
                )
            }
        }
        guard let repositoryPath,
              !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CommandError.usage("--repo is required")
        }
        return DiscardReviewedCommand(
            repositoryURL: URL(fileURLWithPath: repositoryPath, isDirectory: true)
        )
    }

    private static func run(command: Command) async -> Int32 {
        switch command {
        case .cleanupMerged(let cleanup):
            return await runCleanupMerged(command: cleanup)
        case .discardReviewed(let discard):
            return await runDiscardReviewed(command: discard)
        }
    }

    private static func runCleanupMerged(command: CleanupMergedCommand) async -> Int32 {
        var allSucceeded = true
        for agentID in command.agentIDs {
            print("START \(agentID)")
            switch await cleanupWithTimeout(agentID: agentID, repositoryURL: command.repositoryURL) {
            case .completed(let result):
                switch result.status {
                case .cleaned:
                    print("RESULT \(agentID) CLEANED: \(result.detail)")
                case .alreadyAbsent:
                    print("RESULT \(agentID) ALREADY_ABSENT: \(result.detail)")
                case .skipped:
                    allSucceeded = false
                    print("RESULT \(agentID) SKIP: \(result.detail)")
                case .failed:
                    allSucceeded = false
                    print("RESULT \(agentID) FAIL: \(result.detail)")
                }
            case .timedOut:
                allSucceeded = false
                print("RESULT \(agentID) FAIL: timed out after \(perItemTimeoutSeconds)s")
            }
        }
        return allSucceeded ? 0 : 1
    }

    private static func runDiscardReviewed(command: DiscardReviewedCommand) async -> Int32 {
        var allSucceeded = true
        for entry in ReviewedWorktreeMaintenanceManifest.entries {
            print(
                "START \(entry.agentID) branch=\(entry.branch) expected_tip=\(entry.expectedTip) " +
                "basis=\(entry.basis.rawValue) review=\(entry.reviewReason)"
            )
            let result = await SubagentStore.discardReviewedWorktreeForMaintenance(
                entry: entry,
                repositoryURL: command.repositoryURL,
                onEvent: { event in
                    switch event {
                    case .dirtyWorktree(let agentID, let paths, let reviewReason):
                        let summary = paths.joined(separator: " | ")
                        print("DIRTY \(agentID): \(summary)")
                        print("REVIEW \(agentID): \(reviewReason)")
                    }
                }
            )
            switch result.status {
            case .cleaned:
                print("RESULT \(entry.agentID) CLEANED: \(result.detail)")
            case .alreadyAbsent:
                print("RESULT \(entry.agentID) ALREADY_ABSENT: \(result.detail)")
            case .skipped:
                allSucceeded = false
                print("RESULT \(entry.agentID) SKIP: \(result.detail)")
            case .failed:
                allSucceeded = false
                print("RESULT \(entry.agentID) FAIL: \(result.detail)")
            }
        }
        return allSucceeded ? 0 : 1
    }

    private enum TimedCleanupResult: Sendable {
        case completed(MergedWorktreeMaintenanceResult)
        case timedOut
    }

    /// Deliberately races one legacy item against a fixed deadline so a broken Git invocation
    /// cannot block subsequent CLI reporting. The reviewed-discard path does not use this
    /// race: reporting a timeout while its destructive operation is still running would be
    /// misleading, so it stays synchronously serialized by the formal maintenance API.
    private static func cleanupWithTimeout(
        agentID: String,
        repositoryURL: URL
    ) async -> TimedCleanupResult {
        let race = MaintenanceRace()
        Task.detached {
            let result = await SubagentStore.cleanupMergedWorktreeForMaintenance(
                agentID: agentID,
                repositoryURL: repositoryURL
            )
            await race.resolve(.completed(result))
        }
        Task.detached {
            try? await Task.sleep(nanoseconds: perItemTimeoutSeconds * 1_000_000_000)
            await race.resolve(.timedOut)
        }
        return await race.wait()
    }

    private actor MaintenanceRace {
        private var result: TimedCleanupResult?
        private var continuation: CheckedContinuation<TimedCleanupResult, Never>?

        func resolve(_ next: TimedCleanupResult) {
            guard result == nil else { return }
            result = next
            continuation?.resume(returning: next)
            continuation = nil
        }

        func wait() async -> TimedCleanupResult {
            if let result { return result }
            return await withCheckedContinuation { continuation in
                if let result {
                    continuation.resume(returning: result)
                } else {
                    self.continuation = continuation
                }
            }
        }
    }

    private static func writeStandardError(_ text: String) {
        FileHandle.standardError.write(Data(text.utf8))
    }
}
