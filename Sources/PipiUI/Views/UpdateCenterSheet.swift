import SwiftUI
import AppKit

/// Multi-product update notification sheet (pi, cua-driver).
/// Detects available versions only — never executes updates.
struct UpdateCenterSheet: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            headerRow

            ScrollView {
                VStack(spacing: 12) {
                    ForEach(UpdateProductID.allCases, id: \.self) { id in
                        productCard(for: id)
                    }
                }
            }

            footerRow
        }
        .padding(20)
        .frame(width: 460)
        .frame(idealHeight: 380, maxHeight: 460)
        .dismissOnOutsideClick { store.isUpdateCenterPresented = false }
    }

    private var headerRow: some View {
        HStack {
            Text("更新中心")
                .font(.title3.bold())
            Spacer()
            Button {
                store.isUpdateCenterPresented = false
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("关闭")
            .accessibilityLabel("关闭")
        }
    }

    private var footerRow: some View {
        HStack {
            Spacer()
            Button {
                store.refreshAllUpdates()
            } label: {
                if store.isAnyUpdateChecking {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("刷新中…")
                    }
                } else {
                    Text("刷新")
                }
            }
            .buttonStyle(.bordered)
            .disabled(store.isAnyUpdateChecking)

            Button("知道了") {
                store.isUpdateCenterPresented = false
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
        }
    }

    @ViewBuilder
    private func productCard(for id: UpdateProductID) -> some View {
        let info = store.productUpdates[id] ?? .placeholder(for: id)
        let checking = store.updateCheckingProducts.contains(id)

        VStack(alignment: .leading, spacing: 10) {
            Text(info.displayName)
                .font(.headline)

            versionRow(label: "当前版本", value: info.installedVersion ?? "未知")
            versionRow(label: "最新版本", value: info.latestVersion ?? "未知")

            statusLine(info: info, checking: checking)

            HStack(spacing: 10) {
                Button {
                    if let url = info.releaseNotesURL {
                        NSWorkspace.shared.open(url)
                    }
                } label: {
                    Text("查看发布说明")
                }
                .buttonStyle(.bordered)
                .disabled(info.releaseNotesURL == nil)

                if info.updateAvailable {
                    Button {
                        if let latest = info.latestVersion {
                            store.ignoreVersion(id, latest)
                        }
                    } label: {
                        Text("忽略此版本")
                    }
                    .buttonStyle(.bordered)
                } else if info.isIgnored {
                    Button {
                        store.unignoreVersion(id)
                    } label: {
                        Text("取消忽略")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func statusLine(info: ProductUpdateInfo, checking: Bool) -> some View {
        if let error = info.error {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        } else if info.updateAvailable {
            Label("有新版可用", systemImage: "arrow.down.circle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
        } else if info.isIgnored {
            Label("已忽略此版本", systemImage: "eye.slash")
                .font(.callout)
                .foregroundStyle(.secondary)
        } else if info.checkedAt != nil {
            Label("已是最新", systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.secondary)
        } else if checking {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("正在检查…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func versionRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .monospaced()
        }
        .font(.callout)
    }
}
