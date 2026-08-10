import CryptoKit
import Foundation

// MARK: - Models

/// Per-task execution state for the main-session structured plan card.
enum PlanTaskState: String, Codable, CaseIterable, Equatable, Sendable {
    case pending
    case running
    case completed
    case failed
    case blocked
    case skipped
}

/// Aggregate plan state derived from the ordered task list.
enum PlanAggregateState: String, Codable, Equatable, Sendable {
    case none
    case pending
    case running
    case completed
    case failed
    case blocked
}

/// Approval lifecycle for a published plan. Plans written by older app versions
/// decode as `.running` because they had no approval boundary.
enum PlanLifecycle: String, Codable, Equatable, Sendable {
    case awaitingApproval
    case running
    case cancelled
}

/// One ordered task inside a published plan.
struct PlanTaskSnapshot: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    var state: PlanTaskState
    var detail: String?
    var error: String?
}

/// Progress counters derived from task states (completed + skipped count as done).
struct PlanProgress: Equatable, Sendable {
    var doneCount: Int
    var totalCount: Int

    var fraction: Double {
        guard totalCount > 0 else { return 0 }
        return Double(doneCount) / Double(totalCount)
    }

    var isComplete: Bool { totalCount > 0 && doneCount == totalCount }
}

/// Versioned session plan snapshot (one active plan per session).
/// `revision` is store-owned and increments on every successful apply.
/// `id` is mandatory and non-empty — every task_update must carry the same planId.
struct PlanSnapshot: Codable, Equatable, Sendable {
    static let currentSchemaVersion = 1
    static let maxTasks = 100
    static let interruptionExplanation = "App 重启时任务仍在运行；已按中断标记为 blocked"

    var schemaVersion: Int
    var revision: Int
    var id: String
    var title: String
    var summary: String?
    var tasks: [PlanTaskSnapshot]
    var lifecycle: PlanLifecycle
    /// Last successfully applied event timestamp (bridge `at` or wall clock).
    var updatedAt: Date?

    init(
        schemaVersion: Int,
        revision: Int,
        id: String,
        title: String,
        summary: String?,
        tasks: [PlanTaskSnapshot],
        lifecycle: PlanLifecycle = .running,
        updatedAt: Date?
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.id = id
        self.title = title
        self.summary = summary
        self.tasks = tasks
        self.lifecycle = lifecycle
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, revision, id, title, summary, tasks, lifecycle, updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        revision = try container.decode(Int.self, forKey: .revision)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        tasks = try container.decode([PlanTaskSnapshot].self, forKey: .tasks)
        lifecycle = try container.decodeIfPresent(PlanLifecycle.self, forKey: .lifecycle) ?? .running
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
    }

    var progress: PlanProgress {
        let done = tasks.reduce(into: 0) { count, task in
            switch task.state {
            case .completed, .skipped: count += 1
            case .pending, .running, .failed, .blocked: break
            }
        }
        return PlanProgress(doneCount: done, totalCount: tasks.count)
    }

    /// Prefer the first running task; else first blocked; else first pending.
    var currentTask: PlanTaskSnapshot? {
        if let running = tasks.first(where: { $0.state == .running }) { return running }
        if let blocked = tasks.first(where: { $0.state == .blocked }) { return blocked }
        return tasks.first(where: { $0.state == .pending })
    }

    var aggregateState: PlanAggregateState {
        guard !tasks.isEmpty else { return .pending }
        if tasks.contains(where: { $0.state == .running }) { return .running }
        if tasks.contains(where: { $0.state == .blocked }) { return .blocked }
        if tasks.contains(where: { $0.state == .pending }) { return .pending }
        if tasks.contains(where: { $0.state == .failed }) { return .failed }
        return .completed
    }

    /// Completed and cancelled plans may be replaced by a new publish.
    var isTerminal: Bool { lifecycle == .cancelled || aggregateState == .completed }

    /// Convert in-flight `.running` tasks to `.blocked` after process restart.
    static func reconcileInterruptedAfterRestart(_ snapshot: PlanSnapshot) -> PlanSnapshot {
        var next = snapshot
        var changed = false
        for i in next.tasks.indices where next.tasks[i].state == .running {
            next.tasks[i].state = .blocked
            next.tasks[i].detail = interruptionExplanation
            changed = true
        }
        if changed {
            next.updatedAt = Date()
        }
        return next
    }
}

// MARK: - Apply outcome

/// Result of reducing one authenticated `plan_event` body.
/// Revision is assigned by the store — clients never own sequencing.
enum PlanEventApplyOutcome: Equatable, Sendable {
    case applied(revision: Int)
    /// Validation / transition / identity failure (not applied).
    case rejected(reason: String, currentRevision: Int?)

    var isApplied: Bool {
        if case .applied = self { return true }
        return false
    }

    var isSuccess: Bool { isApplied }

    var revision: Int? {
        switch self {
        case .applied(let rev): return rev
        case .rejected: return nil
        }
    }

    /// Bridge JSON response body. Tools must treat `ok != true` / missing `applied` /
    /// non-integer `revision` as failure.
    var responseBody: [String: Any] {
        switch self {
        case .applied(let rev):
            return ["ok": true, "applied": true, "revision": rev]
        case .rejected(let reason, let current):
            var body: [String: Any] = ["ok": false, "applied": false, "error": reason]
            if let current {
                body["currentRevision"] = current
            }
            return body
        }
    }
}

// MARK: - Store

/// Durable one-shot marker for a plan that was interrupted by an app restart.
///
/// The task ids are captured only while converting `.running` work to the
/// restart-marked `.blocked` state. Keeping them outside the agent-owned plan
/// payload prevents ordinary business `.blocked` tasks from becoming resumable.
struct PlanInterruptionRecovery: Codable, Equatable, Sendable {
    var planID: String
    var taskIDs: [String]
}

/// On-disk envelope: active plan + bounded history of accepted plan ids.
struct PlanDiskState: Codable, Equatable, Sendable {
    var plan: PlanSnapshot?
    /// Ordered unique ids accepted by this session (oldest → newest). Bounded.
    var usedPlanIds: [String]
    /// Present exactly while one restart recovery still needs one app-authored resync.
    var pendingInterruptionRecovery: PlanInterruptionRecovery?

    init(
        plan: PlanSnapshot?,
        usedPlanIds: [String],
        pendingInterruptionRecovery: PlanInterruptionRecovery? = nil
    ) {
        self.plan = plan
        self.usedPlanIds = usedPlanIds
        self.pendingInterruptionRecovery = pendingInterruptionRecovery
    }
}

/// Native plan state for one ChatSession: reduce bridge events, derive progress,
/// and persist atomically under Application Support/PipiUI/plans.
final class PlanStore: ObservableObject {
    @Published private(set) var plan: PlanSnapshot?
    /// Persisted one-shot recovery state for restart-marked tasks only.
    @Published private(set) var pendingInterruptionRecovery: PlanInterruptionRecovery?
    /// Plan ids successfully published in this session. Prevents stale/delayed reuse.
    private(set) var usedPlanIds: [String] = []

    /// Disk target (nil until `attachPersistence`). Tests may set directly.
    var persistURL: URL?
    private var pendingSaveWorkItem: DispatchWorkItem?
    private let persistQueue = DispatchQueue(label: "pipiui.planstore.persist")
    private(set) var persistenceWriteCount = 0

    /// Debounce window for event-driven writes (lifecycle uses `saveNow`).
    static var saveDebounce: TimeInterval = 0.15
    /// Cap identity history so sidecars stay small (MVP bound).
    static let maxUsedPlanIds = 64

    deinit {
        pendingSaveWorkItem?.cancel()
    }

    /// True only when the current running plan still has at least one task that
    /// this store itself marked blocked during restart reconciliation.
    var hasPendingInterruptionRecovery: Bool {
        guard let plan else { return false }
        return hasPendingInterruptionRecovery(planId: plan.id)
    }

    /// Identity-scoped recovery check for UI/session actions. Genuine business
    /// blocks never satisfy this because they have no durable recovery task id.
    func hasPendingInterruptionRecovery(planId: String) -> Bool {
        let id = planId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let plan,
              plan.id == id,
              plan.lifecycle == .running,
              let recovery = pendingInterruptionRecovery,
              recovery.planID == id
        else { return false }
        let taskIDs = Set(recovery.taskIDs)
        return plan.tasks.contains {
            taskIDs.contains($0.id)
                && $0.state == .blocked
                && $0.detail == PlanSnapshot.interruptionExplanation
        }
    }

    /// Ordered restart-marked task ids for the currently pending recovery.
    /// Empty means there is no actionable restart recovery for `planId`.
    func interruptedTaskIDsForPendingRecovery(planId: String) -> [String] {
        let id = planId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard hasPendingInterruptionRecovery(planId: id),
              let plan,
              let recovery = pendingInterruptionRecovery
        else { return [] }
        let taskIDs = Set(recovery.taskIDs)
        return plan.tasks.compactMap { task in
            taskIDs.contains(task.id)
                && task.state == .blocked
                && task.detail == PlanSnapshot.interruptionExplanation
                ? task.id
                : nil
        }
    }

    // MARK: Persistence paths

    static func persistenceDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/plans", isDirectory: true)
    }

    /// Expand tildes, standardize, and resolve symlinks for a stable path key.
    static func standardizeSessionPath(_ sessionFile: String) -> String {
        let expanded = (sessionFile as NSString).expandingTildeInPath
        return URL(fileURLWithPath: expanded)
            .standardizedFileURL
            .resolvingSymlinksInPath()
            .path
    }

    /// SHA-256 hex prefix of the standardized full path (collision-safe across directories).
    static func pathDigest(_ standardizedPath: String, length: Int = 16) -> String {
        let digest = SHA256.hash(data: Data(standardizedPath.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return String(hex.prefix(length))
    }

    /// Canonical sidecar name: `<stem>-<pathHash>.plan.json`.
    static func persistenceURL(forSessionFile sessionFile: String) -> URL {
        let std = standardizeSessionPath(sessionFile)
        let stem = URL(fileURLWithPath: std).deletingPathExtension().lastPathComponent
        let safeStem = stem.isEmpty ? "session" : stem
        let name = "\(safeStem)-\(pathDigest(std)).plan.json"
        return persistenceDirectory().appendingPathComponent(name)
    }

    /// Historical basename-only layout. MVP never auto-adopts these: ownership cannot
    /// be proven when two sessions share a stem. Kept for tests / diagnostics only.
    static func legacyPersistenceURL(forSessionFile sessionFile: String) -> URL {
        let stem = URL(fileURLWithPath: sessionFile)
            .deletingPathExtension()
            .lastPathComponent
        let name = (stem.isEmpty ? "session" : stem) + ".plan.json"
        return persistenceDirectory().appendingPathComponent(name)
    }

    /// Mount persistence keyed by the full standardized session path. Loads + reconciles once.
    ///
    /// First attach (no prior `persistURL`): if disk is empty, keep any in-memory plan
    /// already reduced from bridge events before `sessionFile` was known.
    /// Rebind to a different session key: flush the old file, then load the new key
    /// (or clear memory when the new file is absent) so plans never leak across files.
    ///
    /// Never loads basename-only legacy sidecars — ambiguous ownership.
    func attachPersistence(sessionFile: String) {
        let url = Self.persistenceURL(forSessionFile: sessionFile)
        guard persistURL != url else { return }
        let isRebind = persistURL != nil
        if isRebind {
            saveNow()
        }
        persistURL = url
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        loadFromDiskAndReconcile(url: url, clearIfMissing: isRebind)
    }

    /// Synchronous atomic flush (shutdown / rebind / tests).
    /// Returns false only when an attached sidecar could not be written.
    @discardableResult
    func saveNow() -> Bool {
        pendingSaveWorkItem?.cancel()
        pendingSaveWorkItem = nil
        // In-memory-only stores are valid test/runtime seams; there is no disk
        // failure to report until persistence has been attached.
        guard let persistURL else { return true }
        let state = PlanDiskState(
            plan: plan,
            usedPlanIds: usedPlanIds,
            pendingInterruptionRecovery: pendingInterruptionRecovery
        )
        let didWrite = persistQueue.sync {
            Self.writeDiskState(state, to: persistURL)
        }
        if didWrite {
            persistenceWriteCount &+= 1
        }
        return didWrite
    }

    private func scheduleSave() {
        guard persistURL != nil else { return }
        pendingSaveWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.saveNow()
        }
        pendingSaveWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.saveDebounce, execute: work)
    }

    private func loadFromDiskAndReconcile(url: URL, clearIfMissing: Bool) {
        guard let data = try? Data(contentsOf: url) else {
            if clearIfMissing {
                plan = nil
                usedPlanIds = []
                pendingInterruptionRecovery = nil
            }
            return
        }
        let decoder = JSONDecoder()
        let loaded: PlanDiskState
        if let envelope = try? decoder.decode(PlanDiskState.self, from: data) {
            loaded = envelope
        } else if let legacyPlan = try? decoder.decode(PlanSnapshot.self, from: data),
                  !legacyPlan.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // Pre-envelope sidecars: seed history with the single known id.
            loaded = PlanDiskState(plan: legacyPlan, usedPlanIds: [legacyPlan.id])
        } else {
            if clearIfMissing {
                plan = nil
                usedPlanIds = []
                pendingInterruptionRecovery = nil
            }
            return
        }

        var nextPlan = loaded.plan
        var nextRecovery = loaded.pendingInterruptionRecovery
        if let p = nextPlan {
            // A fresh process can only restart-resume running work. Capture these
            // ids before changing their state so ordinary blocked work remains
            // outside the recovery path.
            let newlyInterruptedTaskIDs = p.lifecycle == .running
                ? p.tasks.filter { $0.state == .running }.map(\.id)
                : []
            let reconciled = newlyInterruptedTaskIDs.isEmpty
                ? p
                : PlanSnapshot.reconcileInterruptedAfterRestart(p)
            nextPlan = reconciled

            if !newlyInterruptedTaskIDs.isEmpty {
                // A new crash always arms a fresh one-shot recovery, even when a
                // prior recovery had already been consumed.
                nextRecovery = PlanInterruptionRecovery(
                    planID: reconciled.id,
                    taskIDs: newlyInterruptedTaskIDs
                )
            } else if let normalized = Self.normalizedInterruptionRecovery(
                nextRecovery,
                for: reconciled
            ) {
                nextRecovery = normalized
            } else if loaded.pendingInterruptionRecovery == nil {
                // Upgrade sidecars written by the earlier restart reconciler,
                // which only persisted the exact explanatory marker in task detail.
                let markedTaskIDs = Self.interruptionMarkedTaskIDs(in: reconciled)
                nextRecovery = markedTaskIDs.isEmpty
                    ? nil
                    : PlanInterruptionRecovery(planID: reconciled.id, taskIDs: markedTaskIDs)
            } else {
                nextRecovery = nil
            }
        } else {
            nextRecovery = nil
        }
        var ids = Self.normalizeUsedPlanIds(loaded.usedPlanIds, currentPlanId: nextPlan?.id)
        if let id = nextPlan?.id, !ids.contains(id) {
            ids.append(id)
            ids = Self.normalizeUsedPlanIds(ids, currentPlanId: id)
        }
        let before = (plan, usedPlanIds, pendingInterruptionRecovery)
        plan = nextPlan
        usedPlanIds = ids
        pendingInterruptionRecovery = nextRecovery
        if before.0 != plan
            || before.1 != usedPlanIds
            || before.2 != pendingInterruptionRecovery
            || loaded.plan != nextPlan
            || loaded.pendingInterruptionRecovery != nextRecovery {
            saveNow()
        }
    }

    private static func writeDiskState(_ state: PlanDiskState, to url: URL) -> Bool {
        do {
            if state.plan == nil && state.usedPlanIds.isEmpty {
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.removeItem(at: url)
                }
                return true
            }
            let data = try JSONEncoder().encode(state)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// Keep ids unique, ordered, and bounded; never drop the current plan id.
    static func normalizeUsedPlanIds(_ ids: [String], currentPlanId: String?) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for raw in ids {
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, !seen.contains(id) else { continue }
            seen.insert(id)
            ordered.append(id)
        }
        while ordered.count > maxUsedPlanIds {
            if let drop = ordered.firstIndex(where: { $0 != currentPlanId }) {
                ordered.remove(at: drop)
            } else {
                break
            }
        }
        return ordered
    }

    private func recordUsedPlanId(_ id: String) {
        usedPlanIds = Self.normalizeUsedPlanIds(usedPlanIds + [id], currentPlanId: id)
    }

    // MARK: Bridge entry

    /// Reduce an authenticated bridge `plan_event` request body.
    @discardableResult
    func applyBridgeEvent(_ request: J) -> PlanEventApplyOutcome {
        let eventName = request["event"].string ?? ""
        switch eventName {
        case "publish":
            return applyPublish(request)
        case "task_update":
            return applyTaskUpdate(request)
        case "approve":
            return applyApprove(request)
        case "cancel":
            return applyCancel(request)
        case "":
            return .rejected(reason: "missing plan event name", currentRevision: plan?.revision)
        default:
            return .rejected(reason: "unknown plan event \(eventName)", currentRevision: plan?.revision)
        }
    }

    // MARK: Reducer — publish

    @discardableResult
    func applyPublish(
        schemaVersion: Int,
        planId: String,
        title: String,
        summary: String?,
        tasks: [PlanTaskSnapshot],
        at: Date? = nil
    ) -> PlanEventApplyOutcome {
        if let outcome = validateSchema(schemaVersion) {
            return outcome
        }
        let idTrimmed = planId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !idTrimmed.isEmpty else {
            return .rejected(reason: "plan.id must be a non-empty string", currentRevision: plan?.revision)
        }
        // Never reuse a previously accepted plan id (blocks delayed stale publishes).
        // Checked before the active-plan gate so a late old-id retry is specific.
        if usedPlanIds.contains(idTrimmed) {
            return .rejected(
                reason: "plan.id was already used in this session",
                currentRevision: plan?.revision
            )
        }
        // One active plan per session: no publish of a *new* id while non-terminal.
        if let current = plan, !current.isTerminal {
            return .rejected(
                reason: "active plan in progress; finish it before publishing a new plan",
                currentRevision: current.revision
            )
        }
        let titleTrimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !titleTrimmed.isEmpty else {
            return .rejected(reason: "plan.title must be a non-empty string", currentRevision: plan?.revision)
        }
        if tasks.count > PlanSnapshot.maxTasks {
            return .rejected(
                reason: "plan.tasks exceeds max of \(PlanSnapshot.maxTasks)",
                currentRevision: plan?.revision
            )
        }
        var seen = Set<String>()
        for (index, task) in tasks.enumerated() {
            let id = task.id.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty else {
                return .rejected(
                    reason: "tasks[\(index)].id must be a non-empty string",
                    currentRevision: plan?.revision
                )
            }
            guard !task.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .rejected(
                    reason: "tasks[\(index)].title must be a non-empty string",
                    currentRevision: plan?.revision
                )
            }
            if seen.contains(id) {
                return .rejected(reason: "duplicate task id \(id)", currentRevision: plan?.revision)
            }
            guard task.state != .running else {
                return .rejected(
                    reason: "published tasks must not be running before approval",
                    currentRevision: plan?.revision
                )
            }
            seen.insert(id)
        }
        let normalized = tasks.map { task -> PlanTaskSnapshot in
            var t = task
            t.id = task.id.trimmingCharacters(in: .whitespacesAndNewlines)
            t.title = task.title.trimmingCharacters(in: .whitespacesAndNewlines)
            t.detail = Self.normalizedOptional(task.detail)
            t.error = Self.normalizedOptional(task.error)
            return t
        }
        let rev = nextRevision()
        plan = PlanSnapshot(
            schemaVersion: schemaVersion,
            revision: rev,
            id: idTrimmed,
            title: titleTrimmed,
            summary: Self.normalizedOptional(summary),
            tasks: normalized,
            lifecycle: .awaitingApproval,
            updatedAt: at ?? Date()
        )
        // Publishing a replacement plan can never inherit a prior plan's
        // one-shot restart recovery marker.
        pendingInterruptionRecovery = nil
        recordUsedPlanId(idTrimmed)
        scheduleSave()
        return .applied(revision: rev)
    }

    private func applyPublish(_ request: J) -> PlanEventApplyOutcome {
        guard let schemaVersion = request["schemaVersion"].int else {
            return .rejected(reason: "schemaVersion must be an integer", currentRevision: plan?.revision)
        }
        let planBody = request["plan"]
        guard planBody.exists, planBody.dict != nil else {
            return .rejected(reason: "plan must be an object", currentRevision: plan?.revision)
        }
        // Required strings: reject wrong types; never coerce.
        let idParsed = Self.requireNonEmptyString(planBody["id"], field: "plan.id")
        if case .err(let reason) = idParsed {
            return .rejected(reason: reason, currentRevision: plan?.revision)
        }
        let titleParsed = Self.requireNonEmptyString(planBody["title"], field: "plan.title")
        if case .err(let reason) = titleParsed {
            return .rejected(reason: reason, currentRevision: plan?.revision)
        }
        let summaryParsed = Self.optionalStringField(planBody["summary"], field: "plan.summary")
        if case .err(let reason) = summaryParsed {
            return .rejected(reason: reason, currentRevision: plan?.revision)
        }
        if planBody["tasks"].raw == nil {
            return .rejected(reason: "plan.tasks must be an array", currentRevision: plan?.revision)
        }
        if let raw = planBody["tasks"].raw, !(raw is [Any]) {
            return .rejected(reason: "plan.tasks must be an array", currentRevision: plan?.revision)
        }
        var tasks: [PlanTaskSnapshot] = []
        for (index, node) in planBody["tasks"].array.enumerated() {
            switch Self.parseTaskNode(node, index: index, stateRequired: false) {
            case .err(let reason):
                return .rejected(reason: reason, currentRevision: plan?.revision)
            case .ok(let task):
                tasks.append(task)
            }
        }
        guard case .ok(let planId) = idParsed, case .ok(let title) = titleParsed else {
            return .rejected(reason: "plan must be an object", currentRevision: plan?.revision)
        }
        let summary: String?
        if case .ok(let value) = summaryParsed {
            summary = value
        } else {
            summary = nil
        }
        return applyPublish(
            schemaVersion: schemaVersion,
            planId: planId,
            title: title,
            summary: summary,
            tasks: tasks,
            at: Self.parseDate(request["at"].string)
        )
    }

    // MARK: Reducer — task_update

    @discardableResult
    func applyTaskUpdate(
        schemaVersion: Int,
        planId: String,
        taskId: String,
        state: PlanTaskState,
        title: String? = nil,
        detail: String? = nil,
        error: String? = nil,
        detailProvided: Bool = false,
        errorProvided: Bool = false,
        at: Date? = nil
    ) -> PlanEventApplyOutcome {
        if let outcome = validateSchema(schemaVersion) {
            return outcome
        }
        guard var current = plan else {
            return .rejected(reason: "no published plan", currentRevision: nil)
        }
        if let identityError = Self.validatePlanId(planId, against: current.id) {
            return .rejected(reason: identityError, currentRevision: current.revision)
        }
        guard current.lifecycle == .running else {
            return .rejected(
                reason: current.lifecycle == .awaitingApproval
                    ? "plan is awaiting approval"
                    : "plan is cancelled",
                currentRevision: current.revision
            )
        }

        let id = taskId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            return .rejected(reason: "task.id must be a non-empty string", currentRevision: current.revision)
        }
        guard let index = current.tasks.firstIndex(where: { $0.id == id }) else {
            return .rejected(reason: "unknown task id \(id)", currentRevision: current.revision)
        }
        let previous = current.tasks[index]
        guard Self.canTransition(from: previous.state, to: state) else {
            return .rejected(
                reason: "illegal task transition \(previous.state.rawValue) → \(state.rawValue)",
                currentRevision: current.revision
            )
        }
        var updated = previous
        updated.state = state
        if let title {
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                return .rejected(reason: "task.title must be a non-empty string when present", currentRevision: current.revision)
            }
            updated.title = trimmed
        }
        if detailProvided {
            // Empty string explicitly clears; non-empty sets.
            updated.detail = Self.normalizedOptional(detail)
        }
        if errorProvided {
            updated.error = Self.normalizedOptional(error)
        }
        // Progress / reset states drop stale error/detail unless the caller supplied
        // replacement text in this same update.
        if Self.clearsStaleText(on: state) {
            if !errorProvided {
                updated.error = nil
            }
            if !detailProvided {
                updated.detail = nil
            }
        }
        let rev = nextRevision()
        current.tasks[index] = updated
        current.revision = rev
        current.schemaVersion = schemaVersion
        current.updatedAt = at ?? Date()
        plan = current
        clearInvalidInterruptionRecoveryIfNeeded()
        scheduleSave()
        return .applied(revision: rev)
    }

    private func applyTaskUpdate(_ request: J) -> PlanEventApplyOutcome {
        guard let schemaVersion = request["schemaVersion"].int else {
            return .rejected(reason: "schemaVersion must be an integer", currentRevision: plan?.revision)
        }
        let planIdParsed = Self.requireNonEmptyString(request["planId"], field: "planId")
        if case .err(let reason) = planIdParsed {
            return .rejected(reason: reason, currentRevision: plan?.revision)
        }
        let taskNode = request["task"]
        guard taskNode.exists, taskNode.dict != nil else {
            return .rejected(reason: "task must be an object", currentRevision: plan?.revision)
        }
        switch Self.parseTaskNode(taskNode, index: 0, stateRequired: true, fieldPrefix: "task") {
        case .err(let reason):
            return .rejected(reason: reason, currentRevision: plan?.revision)
        case .ok(let parsed):
            // Optional fields: key absent = leave prior; key present + wrong type = reject;
            // key present + string = apply (empty clears for detail/error).
            let titleField = Self.optionalStringField(taskNode["title"], field: "task.title")
            if case .err(let reason) = titleField {
                return .rejected(reason: reason, currentRevision: plan?.revision)
            }
            let detailField = Self.optionalStringField(taskNode["detail"], field: "task.detail", allowEmpty: true)
            if case .err(let reason) = detailField {
                return .rejected(reason: reason, currentRevision: plan?.revision)
            }
            let errorField = Self.optionalStringField(taskNode["error"], field: "task.error", allowEmpty: true)
            if case .err(let reason) = errorField {
                return .rejected(reason: reason, currentRevision: plan?.revision)
            }
            guard case .ok(let planId) = planIdParsed else {
                return .rejected(reason: "planId is required", currentRevision: plan?.revision)
            }
            let title: String?
            if case .ok(let value) = titleField { title = value } else { title = nil }
            let detailProvided: Bool
            let detailValue: String?
            if case .ok(let value) = detailField {
                detailProvided = true
                detailValue = value ?? ""
            } else {
                detailProvided = false
                detailValue = nil
            }
            let errorProvided: Bool
            let errorValue: String?
            if case .ok(let value) = errorField {
                errorProvided = true
                errorValue = value ?? ""
            } else {
                errorProvided = false
                errorValue = nil
            }
            return applyTaskUpdate(
                schemaVersion: schemaVersion,
                planId: planId,
                taskId: parsed.id,
                state: parsed.state,
                title: title,
                detail: detailValue,
                error: errorValue,
                detailProvided: detailProvided,
                errorProvided: errorProvided,
                at: Self.parseDate(request["at"].string)
            )
        }
    }

    // MARK: Reducer — lifecycle

    @discardableResult
    func approve(planId: String) -> PlanEventApplyOutcome {
        guard var current = plan else {
            return .rejected(reason: "no published plan", currentRevision: nil)
        }
        if let identityError = Self.validatePlanId(planId, against: current.id) {
            return .rejected(reason: identityError, currentRevision: current.revision)
        }
        guard current.lifecycle == .awaitingApproval else {
            return .rejected(
                reason: current.lifecycle == .cancelled ? "plan is cancelled" : "plan is already running",
                currentRevision: current.revision
            )
        }
        let rev = nextRevision()
        current.lifecycle = .running
        current.revision = rev
        current.updatedAt = Date()
        plan = current
        saveNow()
        return .applied(revision: rev)
    }

    @discardableResult
    func cancel(planId: String) -> PlanEventApplyOutcome {
        guard var current = plan else {
            return .rejected(reason: "no published plan", currentRevision: nil)
        }
        if let identityError = Self.validatePlanId(planId, against: current.id) {
            return .rejected(reason: identityError, currentRevision: current.revision)
        }
        guard current.lifecycle != .cancelled else {
            return .rejected(reason: "plan is cancelled", currentRevision: current.revision)
        }
        let rev = nextRevision()
        current.lifecycle = .cancelled
        current.revision = rev
        current.updatedAt = Date()
        plan = current
        pendingInterruptionRecovery = nil
        saveNow()
        return .applied(revision: rev)
    }

    /// Consume a durable restart recovery only after ChatSession has accepted the
    /// matching app-authored resync prompt for delivery. The whole transition is
    /// one revision: only the restart-marked blocked tasks resume; business blocks
    /// stay blocked.
    @discardableResult
    func recoverInterruptedPlan(planId: String) -> PlanEventApplyOutcome {
        guard var current = plan else {
            return .rejected(reason: "no published plan", currentRevision: nil)
        }
        if let identityError = Self.validatePlanId(planId, against: current.id) {
            return .rejected(reason: identityError, currentRevision: current.revision)
        }
        guard current.lifecycle == .running else {
            return .rejected(
                reason: current.lifecycle == .cancelled ? "plan is cancelled" : "plan is awaiting approval",
                currentRevision: current.revision
            )
        }
        let id = planId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard hasPendingInterruptionRecovery(planId: id),
              let recovery = pendingInterruptionRecovery
        else {
            return .rejected(reason: "no pending interruption recovery", currentRevision: current.revision)
        }

        let recoveryTaskIDs = Set(recovery.taskIDs)
        var resumedAny = false
        for index in current.tasks.indices {
            guard recoveryTaskIDs.contains(current.tasks[index].id),
                  current.tasks[index].state == .blocked,
                  current.tasks[index].detail == PlanSnapshot.interruptionExplanation
            else { continue }
            current.tasks[index].state = .running
            current.tasks[index].detail = nil
            resumedAny = true
        }
        guard resumedAny else {
            return .rejected(reason: "no pending interruption recovery", currentRevision: current.revision)
        }

        let previousPlan = plan
        let previousRecovery = pendingInterruptionRecovery
        let rev = nextRevision()
        current.revision = rev
        current.updatedAt = Date()
        plan = current
        // Presence is the persisted one-shot latch. Clear it in the same atomic
        // sidecar write as the task transition so duplicate Continue calls reject.
        pendingInterruptionRecovery = nil
        guard saveNow() else {
            // The app-authored prompt was accepted first, but a failed durable
            // write must not silently consume its one-shot UI recovery state.
            plan = previousPlan
            pendingInterruptionRecovery = previousRecovery
            return .rejected(
                reason: "failed to persist interruption recovery",
                currentRevision: previousPlan?.revision
            )
        }
        return .applied(revision: rev)
    }

    /// Semantic alias used by callers that phrase the action as "Continue Plan".
    @discardableResult
    func resumeInterruptedPlan(planId: String) -> PlanEventApplyOutcome {
        recoverInterruptedPlan(planId: planId)
    }

    private func applyApprove(_ request: J) -> PlanEventApplyOutcome {
        switch Self.requireNonEmptyString(request["planId"], field: "planId") {
        case .ok(let planId): return approve(planId: planId)
        case .err(let reason): return .rejected(reason: reason, currentRevision: plan?.revision)
        }
    }

    private func applyCancel(_ request: J) -> PlanEventApplyOutcome {
        switch Self.requireNonEmptyString(request["planId"], field: "planId") {
        case .ok(let planId): return cancel(planId: planId)
        case .err(let reason): return .rejected(reason: reason, currentRevision: plan?.revision)
        }
    }

    // MARK: Recovery helpers

    /// Keep a persisted recovery marker valid as bridge events mutate the plan.
    /// A stale marker is never allowed to make a later genuine block resumable.
    private func clearInvalidInterruptionRecoveryIfNeeded() {
        let normalized = Self.normalizedInterruptionRecovery(
            pendingInterruptionRecovery,
            for: plan
        )
        if normalized != pendingInterruptionRecovery {
            pendingInterruptionRecovery = normalized
        }
    }

    /// Preserve task order while filtering untrusted/stale ids to exact restart
    /// markers. `PlanInterruptionRecovery` is app-owned, but this validation also
    /// safely upgrades older sidecars and rejects mismatched plan ids.
    private static func normalizedInterruptionRecovery(
        _ recovery: PlanInterruptionRecovery?,
        for plan: PlanSnapshot?
    ) -> PlanInterruptionRecovery? {
        guard let recovery,
              let plan,
              plan.lifecycle == .running,
              recovery.planID.trimmingCharacters(in: .whitespacesAndNewlines) == plan.id
        else { return nil }
        let requested = Set(
            recovery.taskIDs.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )
        guard !requested.isEmpty else { return nil }
        let taskIDs = plan.tasks.compactMap { task in
            requested.contains(task.id)
                && task.state == .blocked
                && task.detail == PlanSnapshot.interruptionExplanation
                ? task.id
                : nil
        }
        guard !taskIDs.isEmpty else { return nil }
        return PlanInterruptionRecovery(planID: plan.id, taskIDs: taskIDs)
    }

    /// Exact text is only a compatibility/migration signal. New sidecars carry
    /// explicit task ids in `PlanInterruptionRecovery`, so normal blocked work is
    /// never inferred as recoverable during the current app lifetime.
    private static func interruptionMarkedTaskIDs(in plan: PlanSnapshot) -> [String] {
        guard plan.lifecycle == .running else { return [] }
        return plan.tasks.compactMap { task in
            task.state == .blocked && task.detail == PlanSnapshot.interruptionExplanation
                ? task.id
                : nil
        }
    }

    // MARK: Validation helpers

    private func nextRevision() -> Int {
        (plan?.revision ?? 0) + 1
    }

    private func validateSchema(_ schemaVersion: Int) -> PlanEventApplyOutcome? {
        guard schemaVersion == PlanSnapshot.currentSchemaVersion else {
            return .rejected(
                reason: "unsupported schemaVersion \(schemaVersion); expected \(PlanSnapshot.currentSchemaVersion)",
                currentRevision: plan?.revision
            )
        }
        return nil
    }

    /// planId is always required and must match the published plan id.
    static func validatePlanId(_ planId: String, against publishedId: String) -> String? {
        let client = planId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !client.isEmpty else {
            return "planId is required"
        }
        guard client == publishedId else {
            return "planId does not match published plan"
        }
        return nil
    }

    /// States that drop leftover error/detail unless the caller supplies new text.
    static func clearsStaleText(on state: PlanTaskState) -> Bool {
        switch state {
        case .pending, .running, .completed, .skipped: return true
        case .failed, .blocked: return false
        }
    }

    /// Safe task state transitions (publish replaces wholesale and bypasses this).
    static func canTransition(from: PlanTaskState, to: PlanTaskState) -> Bool {
        if from == to { return true }
        switch from {
        case .pending:
            return true
        case .running:
            return to == .completed || to == .failed || to == .blocked
                || to == .skipped || to == .pending
        case .blocked:
            return to == .running || to == .pending || to == .failed
                || to == .skipped || to == .completed
        case .completed:
            return to == .pending || to == .running || to == .blocked
        case .failed:
            return to == .pending || to == .running || to == .blocked || to == .skipped
        case .skipped:
            return to == .pending || to == .running || to == .blocked
        }
    }

    private enum ParsedString {
        case ok(String)
        case err(String)
    }

    private enum ParsedOptionalString {
        /// Field absent.
        case absent
        /// Field present as a string (empty allowed when allowEmpty).
        case ok(String?)
        case err(String)
    }

    /// Required non-empty string field. Wrong type, JSON null, or empty → error (never coerce).
    private static func requireNonEmptyString(_ node: J, field: String) -> ParsedString {
        // Distinguish missing vs explicit null: J.exists treats NSNull as absent.
        if node.raw == nil {
            return .err("\(field) is required")
        }
        if node.raw is NSNull {
            return .err("\(field) must be a string")
        }
        guard let raw = node.string else {
            return .err("\(field) must be a string")
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .err("\(field) must be a non-empty string")
        }
        return .ok(trimmed)
    }

    /// Optional string: key omitted OK; JSON null / wrong type → error; empty string kept when
    /// `allowEmpty` (explicit clear for detail/error).
    private static func optionalStringField(
        _ node: J,
        field: String,
        allowEmpty: Bool = false
    ) -> ParsedOptionalString {
        if node.raw == nil { return .absent }
        if node.raw is NSNull {
            return .err("\(field) must be a string when present")
        }
        guard let raw = node.string else {
            return .err("\(field) must be a string when present")
        }
        if allowEmpty {
            return .ok(raw)
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .err("\(field) must be a non-empty string when present")
        }
        return .ok(trimmed)
    }

    private enum ParsedTask {
        case ok(PlanTaskSnapshot)
        case err(String)
    }

    private static func parseTaskNode(
        _ node: J,
        index: Int,
        stateRequired: Bool,
        fieldPrefix: String? = nil
    ) -> ParsedTask {
        let prefix = fieldPrefix ?? "tasks[\(index)]"
        guard node.dict != nil else {
            return .err("\(prefix) must be an object")
        }
        switch requireNonEmptyString(node["id"], field: "\(prefix).id") {
        case .err(let reason):
            return .err(reason)
        case .ok(let idRaw):
            let state: PlanTaskState
            let stateNode = node["state"]
            if stateRequired {
                if stateNode.raw == nil {
                    return .err("\(prefix).state is required")
                }
                if stateNode.raw is NSNull {
                    return .err("\(prefix).state must be a string")
                }
                guard let stateRaw = stateNode.string else {
                    return .err("\(prefix).state must be a string")
                }
                guard let parsed = PlanTaskState(rawValue: stateRaw) else {
                    return .err(
                        "\(prefix).state must be one of \(PlanTaskState.allCases.map(\.rawValue).joined(separator: ", "))"
                    )
                }
                state = parsed
            } else if stateNode.raw == nil {
                state = .pending
            } else if stateNode.raw is NSNull {
                return .err("\(prefix).state must be a string when present")
            } else {
                guard let stateRaw = stateNode.string else {
                    return .err("\(prefix).state must be a string when present")
                }
                guard let parsed = PlanTaskState(rawValue: stateRaw) else {
                    return .err(
                        "\(prefix).state must be one of \(PlanTaskState.allCases.map(\.rawValue).joined(separator: ", "))"
                    )
                }
                state = parsed
            }

            let title: String
            if stateRequired {
                // task_update: title optional; if present must be non-empty string.
                switch optionalStringField(node["title"], field: "\(prefix).title") {
                case .absent:
                    title = idRaw // keep existing title at reducer; placeholder only if new
                case .ok(let value):
                    title = value ?? idRaw
                case .err(let reason):
                    return .err(reason)
                }
            } else {
                switch requireNonEmptyString(node["title"], field: "\(prefix).title") {
                case .err(let reason):
                    return .err(reason)
                case .ok(let value):
                    title = value
                }
            }

            let detail: String?
            switch optionalStringField(node["detail"], field: "\(prefix).detail", allowEmpty: true) {
            case .absent:
                detail = nil
            case .ok(let value):
                detail = normalizedOptional(value)
            case .err(let reason):
                return .err(reason)
            }

            let errorText: String?
            switch optionalStringField(node["error"], field: "\(prefix).error", allowEmpty: true) {
            case .absent:
                errorText = nil
            case .ok(let value):
                errorText = normalizedOptional(value)
            case .err(let reason):
                return .err(reason)
            }

            return .ok(
                PlanTaskSnapshot(
                    id: idRaw,
                    title: title,
                    state: state,
                    detail: detail,
                    error: errorText
                )
            )
        }
    }

    private static func normalizedOptional(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = fractional.date(from: raw) { return d }
        let basic = ISO8601DateFormatter()
        basic.formatOptions = [.withInternetDateTime]
        return basic.date(from: raw)
    }

    // MARK: Test seams

    /// Replace in-memory plan without going through the reducer (tests only).
    func _test_setPlan(_ snapshot: PlanSnapshot?) {
        plan = snapshot
        if let id = snapshot?.id {
            recordUsedPlanId(id)
        }
    }

    /// Test seam: inspect used-id history.
    func _test_usedPlanIds() -> [String] { usedPlanIds }

    /// Test seam: seed used-id history (persistence tests).
    func _test_setUsedPlanIds(_ ids: [String]) {
        usedPlanIds = Self.normalizeUsedPlanIds(ids, currentPlanId: plan?.id)
    }
}
