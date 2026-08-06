import SwiftUI
import AppKit

/// Sheet showing pi update status and offering a one-click update.
struct PiUpdateSheet: View {
    @EnvironmentObject var store: AppStore

    private let releaseNotesURL = URL(string: "https://github.com/earendil-works/pi/releases")!

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("pi 更新")
                    .font(.title3.bold())
                Spacer()
                Button {
                    store.isPiUpdatePresented = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("关闭")
                .accessibilityLabel("关闭")
            }

            versionRow(label: "当前版本", value: store.piUpdateInfo.installed ?? "未知")
            versionRow(label: "最新版本", value: store.piUpdateInfo.latest ?? "未知")

            statusText

            HStack(spacing: 12) {
                Button {
                    store.runPiUpdate()
                } label: {
                    if store.piIsUpdating {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text("更新中…")
                        }
                    } else {
                        Text("更新 pi")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.piIsUpdating || !store.piUpdateInfo.updateAvailable)

                Button {
                    store.refreshPiUpdate()
                } label: {
                    Text("刷新")
                }
                .buttonStyle(.bordered)
                .disabled(store.piIsChecking)

                Button {
                    NSWorkspace.shared.open(releaseNotesURL)
                } label: {
                    Text("查看发布说明")
                }
                .buttonStyle(.bordered)
            }

            if store.piIsUpdating || !store.piUpdateLog.isEmpty {
                ScrollView {
                    Text(store.piUpdateLog.isEmpty ? "正在运行 pi update…" : store.piUpdateLog)
                        .font(.caption)
                        .monospaced()
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 120, maxHeight: 200)
                .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(width: 420, height: 320)
    }

    @ViewBuilder
    private var statusText: some View {
        if let error = store.piUpdateInfo.error {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        } else if store.piUpdateInfo.updateAvailable {
            Label("有新版可用", systemImage: "arrow.down.circle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
        } else if store.piUpdateInfo.checkedAt != nil {
            Label("已是最新版本", systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.secondary)
        } else if store.piIsChecking {
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