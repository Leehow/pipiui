import SwiftUI
import AppKit

/// Chat toolbar control: branch icon + name, local branch checkout, optional GitHub link.
struct GitBranchMenu: View {
    @ObservedObject var store: GitBranchStore
    var onError: (String) -> Void

    var body: some View {
        if store.status.isRepo {
            Menu {
                ForEach(orderedBranches(), id: \.self) { branch in
                    Button {
                        guard branch != store.status.currentBranch else { return }
                        Task {
                            if let error = await store.checkout(branch: branch) {
                                onError(error)
                            }
                        }
                    } label: {
                        if branch == store.status.currentBranch {
                            Label(branch, systemImage: "checkmark")
                        } else {
                            Text(branch)
                        }
                    }
                    .disabled(store.isBusy)
                }

                if let url = store.status.githubBrowserURL {
                    Divider()
                    Button("在 GitHub 打开") {
                        NSWorkspace.shared.open(url)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch")
                    if store.isBusy {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Text(store.status.toolbarTitle)
                            .lineLimit(1)
                    }
                }
            }
            .menuStyle(.borderlessButton)
            .disabled(store.isBusy)
            .help("Git 分支：\(store.status.displayBranchName)")
            .onAppear {
                store.startAppActiveRefresh()
                store.refresh()
            }
        }
    }

    /// Current branch first (with checkmark), remaining local branches case-insensitive sorted.
    private func orderedBranches() -> [String] {
        let current = store.status.currentBranch
        let all = store.status.localBranches
        var rest = all.filter { $0 != current }
        rest.sort { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        if let current, all.contains(current) {
            return [current] + rest
        }
        return rest
    }
}
