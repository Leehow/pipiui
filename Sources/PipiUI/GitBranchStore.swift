import Foundation
import AppKit
import Combine

/// Toolbar git branch state shared across chat details. Does not reference ChatSession.
///
/// ChatDetailView is torn down on every session switch (`.id(session.id)` in App.swift),
/// so a per-view store re-probed git (and re-registered a didBecomeActive observer) on
/// every open. Instead a process-wide singleton is keyed by projectURL: rebinds to the
/// same project reuse the cached probe, and probes are debounced so onAppear /
/// menu-appear / app-activate don't each spawn git.
@MainActor
final class GitBranchStore: ObservableObject {
    static let shared = GitBranchStore()

    @Published private(set) var status: GitRepoStatus = .empty
    @Published private(set) var isBusy = false

    /// Minimum interval between git probes; repeat triggers inside the window reuse the cache.
    private static let minProbeInterval: TimeInterval = 3

    private var projectURL: URL?
    /// Bumped on each refresh/bind so stale detached probes are dropped.
    private var epoch: UInt64 = 0
    private var activeObserver: NSObjectProtocol?
    private var lastProbeAt: Date = .distantPast

    func bind(projectURL: URL) {
        if self.projectURL != projectURL {
            self.projectURL = projectURL
            status = .empty
            lastProbeAt = .distantPast
        }
        startAppActiveRefresh()
        refresh()
    }

    func refresh() {
        guard let projectURL else {
            status = .empty
            return
        }
        let now = Date()
        guard now.timeIntervalSince(lastProbeAt) >= Self.minProbeInterval else { return }
        lastProbeAt = now
        epoch &+= 1
        let capturedEpoch = epoch
        let url = projectURL
        Task.detached(priority: .utility) {
            let result = GitRepo.probe(workTree: url)
            await MainActor.run {
                guard capturedEpoch == self.epoch else { return }
                self.status = result
            }
        }
    }

    /// Returns an error message on failure; `nil` on success (and re-probes).
    func checkout(branch: String) async -> String? {
        guard let projectURL else {
            return "未绑定项目路径"
        }
        isBusy = true
        defer { isBusy = false }

        let url = projectURL
        do {
            try await Task.detached(priority: .userInitiated) {
                try GitRepo.checkout(branch: branch, in: url)
            }.value

            let result = await Task.detached(priority: .utility) {
                GitRepo.probe(workTree: url)
            }.value
            status = result
            // Bypass the debounce: the probe we just ran is fresh.
            lastProbeAt = Date()
            return nil
        } catch let error as GitRepoError {
            return error.errorDescription ?? "checkout 失败"
        } catch {
            return error.localizedDescription
        }
    }

    func startAppActiveRefresh() {
        // Singleton: register once; re-triggers (bind / menu appear) must not stack observers.
        guard activeObserver == nil else { return }
        activeObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
    }

    func stop() {
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
            self.activeObserver = nil
        }
    }

    deinit {
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
        }
    }
}
