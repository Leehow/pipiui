import Foundation
import AppKit

/// One usage window surfaced by a provider: e.g. a 5-hour cap, a weekly cap, a
/// monthly cap. A snapshot may carry several; the capsule shows one (user-picked
/// or default), the popover lists all.
struct QuotaWindow: Equatable, Identifiable {
    /// Stable id within a snapshot so SwiftUI ForEach + selection works. Providers
    /// set this from their native window kind (e.g. "fiveHour", "weekly", a typeRaw).
    let id: String
    /// Usage 0…100.
    var usedPercent: Double
    /// When this window resets (nil when unknown).
    var resetsAt: Date?
    /// Compact capsule suffix label: 5h / 周 / 月 / 额 …
    var label: String
    /// Row title in the popover: 5小时额度 / 周额度 / 月额度 …
    var title: String

    var help: String { title }
}

/// Generic per-account quota snapshot consumed by the UI layer.
///
/// Each provider (Grok, GLM, Claude, Codex) fetches its own data and maps it into
/// one or more `QuotaWindow`s. The capsule renders the selected (or default)
/// window; the popover lists them all so the user can pick which to show.
struct QuotaSnapshot: Equatable {
    /// All windows this provider reports (5h / 周 / 月 …). Always ≥1 when present.
    var windows: [QuotaWindow]
    /// Which window id to surface in the capsule. Defaults to the highest-usage one
    /// when nil or not found; persisted per-provider+account by the UI.
    var selectedWindowId: String?

    /// The window currently shown in the capsule: the selected one if present,
    /// else the highest-usage window, else nil.
    var capsule: QuotaWindow? {
        if let s = selectedWindowId, let w = windows.first(where: { $0.id == s }) {
            return w
        }
        return windows.max(by: { $0.usedPercent < $1.usedPercent })
    }

    /// Functional copy with a different selected window id.
    func copy(selectedWindowId: String?) -> QuotaSnapshot {
        QuotaSnapshot(windows: windows, selectedWindowId: selectedWindowId)
    }
}

/// The provider kind backing an account-quota pill.
enum QuotaProvider: String, CaseIterable {
    case grok, glm, claude, codex, kimi, qoder, qwenTokenPlan

    /// Human-readable name for the popover title, e.g. "Grok 账号额度".
    var accountLabel: String {
        switch self {
        case .grok: return "Grok 账号额度"
        case .glm: return "GLM 账号额度"
        case .claude: return "Claude 账号额度"
        case .codex: return "Codex 账号额度"
        case .kimi: return "Kimi 账号额度"
        case .qoder: return "Qoder 账号额度"
        case .qwenTokenPlan: return "Qwen Token Plan 额度"
        }
    }

    /// A single shared monitor per provider. Resolved lazily on first access so
    /// the monitor is created only for providers actually used this run.
    var monitor: QuotaMonitor {
        switch self {
        case .grok: return GrokQuotaMonitor.shared
        case .glm: return GLMQuotaMonitor.shared
        case .claude: return ClaudeQuotaMonitor.shared
        case .codex: return CodexQuotaMonitor.shared
        case .kimi: return KimiQuotaMonitor.shared
        case .qoder: return QoderQuotaMonitor.shared
        case .qwenTokenPlan: return QwenTokenPlanQuotaMonitor.shared
        }
    }
}

/// Common interface every per-provider quota monitor conforms to. The contract
/// mirrors the original `GrokQuotaMonitor`: callers/handlers on the main thread,
/// failures are silent (last good snapshot kept), `observe` delivers the cache
/// immediately.
protocol QuotaMonitor: AnyObject {
    var snapshot: QuotaSnapshot? { get }
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID
    func removeObserver(_ id: UUID)
    func refreshIfNeeded(force: Bool)
}

/// Shared boilerplate for the per-provider singletons: timer cadence, throttle
/// gates, observer fan-out, and the fetch dispatch. Concrete monitors inject a
/// `load + fetch` closure and conform via composition (see `GrokQuotaMonitor`).
final class QuotaMonitorCore {
    static let minAttemptInterval: TimeInterval = 60
    static let staleAfter: TimeInterval = 3 * 60
    static let pollInterval: TimeInterval = 5 * 60

    private(set) var snapshot: QuotaSnapshot?
    private var lastAttemptAt: Date?
    private var lastSuccessAt: Date?
    private var inFlight = false
    private var timer: Timer?
    private var activeObserver: NSObjectProtocol?
    private var listeners: [UUID: (QuotaSnapshot?) -> Void] = [:]

    /// The per-provider fetch: returns a snapshot or throws. `force` is the
    /// caller's force flag; the core has already applied its own throttle.
    var fetcher: ((Bool) async throws -> QuotaSnapshot?)?

    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        let id = UUID()
        listeners[id] = handler
        handler(snapshot)
        ensureStarted()
        refreshIfNeeded(force: false)
        return id
    }

    func removeObserver(_ id: UUID) {
        listeners.removeValue(forKey: id)
    }

    func ensureStarted() {
        if timer == nil {
            let t = Timer(timeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
                self?.refreshIfNeeded(force: false)
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        }
        if activeObserver == nil {
            activeObserver = NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil, queue: .main
            ) { [weak self] _ in self?.refreshIfNeeded(force: false) }
        }
    }

    func refreshIfNeeded(force: Bool) {
        let now = Date()
        if !force, let lastSuccessAt, now.timeIntervalSince(lastSuccessAt) < Self.staleAfter { return }
        if !force, let lastAttemptAt, now.timeIntervalSince(lastAttemptAt) < Self.minAttemptInterval { return }
        guard !inFlight else { return }
        guard let fetcher else { return }
        inFlight = true
        lastAttemptAt = now
        Task { [weak self] in
            let result: QuotaSnapshot?
            do { result = try await fetcher(force) }
            catch { result = nil }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.inFlight = false
                if let result {
                    self.snapshot = result
                    self.lastSuccessAt = Date()
                    self.publish()
                }
            }
        }
    }

    private func publish() {
        let snap = snapshot
        for handler in listeners.values { handler(snap) }
    }
}
