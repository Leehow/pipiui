import SwiftUI
import AppKit

/// Chat toolbar control: branch icon + name, local branch checkout, optional GitHub link.
/// Compact, borderless chrome — not a floating capsule.
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
                        .font(.system(size: 12, weight: .medium))
                        .imageScale(.medium)
                    if store.isBusy {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Text(store.status.toolbarTitle)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .frame(height: 28)
                .frame(maxWidth: 200, alignment: .leading)
                .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .buttonStyle(.plain)
            .disabled(store.isBusy)
            .help(branchHelpText)
            .pointingHandCursor()
            .onAppear {
                store.startAppActiveRefresh()
                store.refresh()
            }
        }
    }

    private var branchHelpText: String {
        let s = store.status
        var text = "Git 分支：\(s.displayBranchName)"
        if s.isDirty {
            text += "*（staged=\(s.stagedCount) unstaged=\(s.unstagedCount) untracked=\(s.untrackedCount)）"
        }
        if let up = s.upstream, !up.isEmpty {
            text += " · upstream \(up) +\(s.ahead) -\(s.behind)"
        }
        return text
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
