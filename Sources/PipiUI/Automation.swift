import Foundation

struct AutomationDraftRequest: Identifiable, Equatable {
    let id: UUID
    let prompt: String
}

enum AutomationDraftRequestCoordinator {
    static func issue(prompt: String, id: UUID = UUID()) -> AutomationDraftRequest {
        AutomationDraftRequest(
            id: id,
            prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    static func consume(_ request: inout AutomationDraftRequest?) -> AutomationDraftRequest? {
        let consumed = request
        request = nil
        return consumed
    }
}

enum AutomationSelectionGuard {
    static func remainedNeutral(
        before: RemoteDesktopSelectionState,
        immediatelyAfterCreation: RemoteDesktopSelectionState
    ) -> Bool {
        before == immediatelyAfterCreation
    }
}

enum AutomationSchedule: Codable, Equatable, Sendable {
    case once(Date)
    case daily(hour: Int, minute: Int)
    case weekly(weekday: Int, hour: Int, minute: Int)
    case interval(TimeInterval)

    static let minimumInterval: TimeInterval = 15 * 60

    func nextDate(after date: Date, calendar: Calendar = .current) -> Date? {
        switch self {
        case .once(let scheduled):
            return scheduled > date ? scheduled : nil
        case .daily(let hour, let minute):
            var components = DateComponents()
            components.hour = min(23, max(0, hour))
            components.minute = min(59, max(0, minute))
            return calendar.nextDate(
                after: date,
                matching: components,
                matchingPolicy: .nextTime,
                repeatedTimePolicy: .first,
                direction: .forward
            )
        case .weekly(let weekday, let hour, let minute):
            var components = DateComponents()
            components.weekday = min(7, max(1, weekday))
            components.hour = min(23, max(0, hour))
            components.minute = min(59, max(0, minute))
            return calendar.nextDate(
                after: date,
                matching: components,
                matchingPolicy: .nextTime,
                repeatedTimePolicy: .first,
                direction: .forward
            )
        case .interval(let rawSeconds):
            return date.addingTimeInterval(max(Self.minimumInterval, rawSeconds))
        }
    }

    var displayName: String {
        switch self {
        case .once: return "一次"
        case .daily: return "每天"
        case .weekly: return "每周"
        case .interval: return "固定间隔"
        }
    }
}

struct AutomationClaim: Codable, Equatable, Sendable {
    let runID: UUID
    let occurrenceID: String
    let scheduledAt: Date
    let claimedAt: Date
    let manual: Bool
}

struct AutomationOutcome: Codable, Equatable, Sendable {
    enum Status: String, Codable, Sendable {
        case succeeded
        case failed
        case interrupted
        case timedOut
    }

    let runID: UUID
    let status: Status
    let completedAt: Date
    let summary: String
    let sessionKey: String?
    let sessionPath: String?
}

struct AutomationJob: Identifiable, Codable, Equatable, Sendable {
    var id: UUID
    var title: String
    var enabled: Bool
    var projectPath: String
    var prompt: String
    var schedule: AutomationSchedule
    /// Pi command name, for example `skill:brave-search`. It is advisory until
    /// the isolated session reports that exact command as available.
    var skillName: String?
    var nextRunAt: Date?
    var claim: AutomationClaim?
    var lastOutcome: AutomationOutcome?
    var createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        title: String,
        enabled: Bool = true,
        projectPath: String,
        prompt: String,
        schedule: AutomationSchedule,
        skillName: String? = nil,
        nextRunAt: Date? = nil,
        claim: AutomationClaim? = nil,
        lastOutcome: AutomationOutcome? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        calendar: Calendar = .current
    ) {
        self.id = id
        self.title = title
        self.enabled = enabled
        self.projectPath = projectPath
        self.prompt = prompt
        self.schedule = schedule
        self.skillName = skillName
        self.nextRunAt = nextRunAt ?? schedule.nextDate(after: createdAt.addingTimeInterval(-1), calendar: calendar)
        self.claim = claim
        self.lastOutcome = lastOutcome
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct AutomationExecutionResult: Equatable, Sendable {
    let status: AutomationOutcome.Status
    let summary: String
    let sessionKey: String?
    let sessionPath: String?
    let shouldPause: Bool

    static func success(_ summary: String, sessionKey: String? = nil, sessionPath: String? = nil) -> Self {
        .init(status: .succeeded, summary: summary, sessionKey: sessionKey, sessionPath: sessionPath, shouldPause: false)
    }

    static func failure(
        _ summary: String,
        sessionKey: String? = nil,
        sessionPath: String? = nil,
        shouldPause: Bool = false
    ) -> Self {
        .init(
            status: .failed,
            summary: summary,
            sessionKey: sessionKey,
            sessionPath: sessionPath,
            shouldPause: shouldPause
        )
    }
}

enum AutomationPersistenceError: LocalizedError, Equatable {
    case unsupportedVersion(Int)

    var errorDescription: String? {
        switch self {
        case .unsupportedVersion(let version):
            return "不支持的自动任务数据版本：\(version)"
        }
    }
}

final class AutomationPersistence {
    private struct Envelope: Codable {
        let version: Int
        var jobs: [AutomationJob]
    }

    static let currentVersion = 1
    let fileURL: URL

    init(fileURL: URL? = nil) {
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("PipiUI", isDirectory: true)
                .appendingPathComponent("Automations", isDirectory: true)
            self.fileURL = base.appendingPathComponent("automations-v1.json")
        }
    }

    func load() throws -> [AutomationJob] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: fileURL))
        guard envelope.version == Self.currentVersion else {
            throw AutomationPersistenceError.unsupportedVersion(envelope.version)
        }
        return envelope.jobs
    }

    func save(_ jobs: [AutomationJob]) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory.path
        )
        let data = try JSONEncoder().encode(Envelope(version: Self.currentVersion, jobs: jobs))
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }
}

@MainActor
final class AutomationScheduler: ObservableObject {
    typealias Clock = @Sendable () -> Date
    typealias Executor = @MainActor @Sendable (AutomationJob) async -> AutomationExecutionResult
    typealias OutcomeHandler = @MainActor (AutomationJob, AutomationOutcome) -> Void

    @Published private(set) var jobs: [AutomationJob] = []
    @Published private(set) var persistenceError: String?

    private let persistence: AutomationPersistence
    private let calendar: Calendar
    private let clock: Clock
    private let executor: Executor
    private let tickInterval: TimeInterval
    private var timerTask: Task<Void, Never>?
    private var executionTasks: [UUID: Task<Void, Never>] = [:]
    var onOutcome: OutcomeHandler?

    init(
        persistence: AutomationPersistence = AutomationPersistence(),
        calendar: Calendar = .current,
        clock: @escaping Clock = { Date() },
        tickInterval: TimeInterval = 30,
        executor: @escaping Executor
    ) {
        self.persistence = persistence
        self.calendar = calendar
        self.clock = clock
        self.tickInterval = tickInterval
        self.executor = executor
        reload()
    }

    deinit { timerTask?.cancel() }

    func start() {
        guard timerTask == nil else { return }
        tick()
        let nanoseconds = UInt64(max(1, tickInterval) * 1_000_000_000)
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: nanoseconds)
                guard !Task.isCancelled, let self else { return }
                self.tick()
            }
        }
    }

    func stop() {
        timerTask?.cancel()
        timerTask = nil
        for task in executionTasks.values { task.cancel() }
        executionTasks.removeAll()
    }

    func reload() {
        do {
            jobs = try persistence.load()
            persistenceError = nil
            recoverInterruptedClaims(at: clock())
        } catch {
            jobs = []
            persistenceError = error.localizedDescription
        }
    }

    func upsert(_ job: AutomationJob) {
        var normalized = job
        let now = clock()
        normalized.title = normalized.title.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.prompt = normalized.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        normalized.updatedAt = now
        if normalized.nextRunAt == nil, normalized.enabled {
            normalized.nextRunAt = normalized.schedule.nextDate(after: now.addingTimeInterval(-1), calendar: calendar)
        }
        if let index = jobs.firstIndex(where: { $0.id == normalized.id }) {
            jobs[index] = normalized
        } else {
            jobs.append(normalized)
        }
        persist()
    }

    func setEnabled(_ enabled: Bool, id: UUID) {
        guard let index = jobs.firstIndex(where: { $0.id == id }) else { return }
        var canEnable = enabled
        jobs[index].updatedAt = clock()
        if enabled, jobs[index].nextRunAt == nil {
            jobs[index].nextRunAt = jobs[index].schedule.nextDate(after: clock().addingTimeInterval(-1), calendar: calendar)
            canEnable = jobs[index].nextRunAt != nil
        }
        jobs[index].enabled = canEnable
        persist()
    }

    func delete(id: UUID) {
        executionTasks[id]?.cancel()
        executionTasks[id] = nil
        jobs.removeAll { $0.id == id }
        persist()
    }

    func runNow(id: UUID) {
        guard let index = jobs.firstIndex(where: { $0.id == id }), jobs[index].claim == nil else { return }
        claimAndExecute(index: index, scheduledAt: clock(), manual: true)
    }

    /// Runs at most one missed occurrence per job. A completion advances from
    /// `now`, not from every missed boundary, so wake/launch cannot replay a storm.
    func tick() {
        let now = clock()
        let dueIDs = jobs.compactMap { job -> UUID? in
            guard job.enabled, job.claim == nil, let next = job.nextRunAt, next <= now else { return nil }
            return job.id
        }
        for id in dueIDs {
            guard let index = jobs.firstIndex(where: { $0.id == id }),
                  let scheduledAt = jobs[index].nextRunAt else { continue }
            claimAndExecute(index: index, scheduledAt: scheduledAt, manual: false)
        }
    }

    private func claimAndExecute(index: Int, scheduledAt: Date, manual: Bool) {
        let now = clock()
        let jobID = jobs[index].id
        let occurrenceID = manual
            ? "manual:\(UUID().uuidString)"
            : "scheduled:\(Int(scheduledAt.timeIntervalSince1970))"
        let claim = AutomationClaim(
            runID: UUID(),
            occurrenceID: occurrenceID,
            scheduledAt: scheduledAt,
            claimedAt: now,
            manual: manual
        )
        jobs[index].claim = claim
        jobs[index].updatedAt = now
        guard persist() else {
            jobs[index].claim = nil
            return
        }

        let snapshot = jobs[index]
        let task = Task { [weak self] in
            guard let self else { return }
            let result = await self.executor(snapshot)
            guard !Task.isCancelled else { return }
            self.finish(jobID: jobID, claim: claim, result: result)
        }
        executionTasks[jobID] = task
    }

    private func finish(jobID: UUID, claim: AutomationClaim, result: AutomationExecutionResult) {
        executionTasks[jobID] = nil
        guard let index = jobs.firstIndex(where: { $0.id == jobID }),
              jobs[index].claim?.runID == claim.runID else { return }
        let now = clock()
        let outcome = AutomationOutcome(
            runID: claim.runID,
            status: result.status,
            completedAt: now,
            summary: result.summary,
            sessionKey: result.sessionKey,
            sessionPath: result.sessionPath
        )
        jobs[index].claim = nil
        jobs[index].lastOutcome = outcome
        jobs[index].updatedAt = now
        if !claim.manual {
            jobs[index].nextRunAt = jobs[index].schedule.nextDate(after: now, calendar: calendar)
            if case .once = jobs[index].schedule { jobs[index].enabled = false }
        }
        if result.shouldPause { jobs[index].enabled = false }
        let completedJob = jobs[index]
        persist()
        onOutcome?(completedJob, outcome)
    }

    private func recoverInterruptedClaims(at now: Date) {
        var changed = false
        for index in jobs.indices {
            guard let claim = jobs[index].claim else { continue }
            jobs[index].claim = nil
            jobs[index].lastOutcome = AutomationOutcome(
                runID: claim.runID,
                status: .interrupted,
                completedAt: now,
                summary: "Pipi 上次退出时任务仍在运行；为避免重复执行，已标记为中断。",
                sessionKey: nil,
                sessionPath: nil
            )
            if !claim.manual {
                jobs[index].nextRunAt = jobs[index].schedule.nextDate(after: now, calendar: calendar)
                if case .once = jobs[index].schedule { jobs[index].enabled = false }
            }
            jobs[index].updatedAt = now
            changed = true
        }
        if changed { persist() }
    }

    @discardableResult
    private func persist() -> Bool {
        do {
            try persistence.save(jobs)
            persistenceError = nil
            return true
        } catch {
            persistenceError = error.localizedDescription
            return false
        }
    }
}
