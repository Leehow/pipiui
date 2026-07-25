import Foundation
import AppKit
import Combine

/// Toolbar git branch state for one chat detail. Does not reference ChatSession.
@MainActor
final class GitBranchStore: ObservableObject {
    @Published private(set) var status: GitRepoStatus = .empty
    @Published private(set) var isBusy = false

    private var projectURL: URL?
    /// Bumped on each refresh/bind so stale detached probes are dropped.
    private var epoch: UInt64 = 0
    private var activeObserver: NSObjectProtocol?

    func bind(projectURL: URL) {
        self.projectURL = projectURL
        startAppActiveRefresh()
        refresh()
    }

    func refresh() {
        guard let projectURL else {
            status = .empty
            return
        }
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
            return nil
        } catch let error as GitRepoError {
            return error.errorDescription ?? "checkout 失败"
        } catch {
            return error.localizedDescription
        }
    }

    func startAppActiveRefresh() {
        stop()
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
