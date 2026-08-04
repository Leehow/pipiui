import SwiftUI

struct EmptyStateView: View {
    @EnvironmentObject var store: AppStore

    @State private var showAddModelSheet = false
    @State private var providers: [EmptyStateConfiguredProvider] = []
    /// providerId → status trailing text
    @State private var statusByProvider: [String: String] = [:]
    @State private var quotaObserverIDs: [QuotaProvider: UUID] = [:]
    @State private var balanceObserverIDs: [BalanceProvider: UUID] = [:]

    private var hasCredentials: Bool { !providers.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                brandBlock
                featureBlock
                if hasCredentials {
                    providerBlock
                }
                ctaBlock
            }
            .frame(maxWidth: 520)
            .padding(32)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear { refreshCredentials() }
        .onDisappear { tearDownMonitors() }
        .sheet(isPresented: $showAddModelSheet) {
            AddModelSheet {
                refreshCredentials()
            }
            .environmentObject(store)
            .dismissOnOutsideClick { showAddModelSheet = false }
        }
    }

    private var brandBlock: some View {
        VStack(spacing: 10) {
            Image(systemName: "terminal")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.tertiary)
            BrandMark(size: .hero)
            Text("基于纯 Pi 的桌面界面，并内置编排与工具能力。")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var featureBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            featureRow(icon: "person.3", title: "多 Agent 编排", detail: "可并行派生子任务协作")
            featureRow(icon: "magnifyingglass", title: "内置搜索", detail: "模型无搜索时自动触发")
            featureRow(icon: "doc.text.viewfinder", title: "图片 OCR", detail: "模型不识图时自动触发")
            featureRow(icon: "desktopcomputer", title: "Computer Use", detail: "可操作本机界面完成任务")
            featureRow(icon: "antenna.radiowaves.left.and.right", title: "远程控制", detail: "可远程接入并操控会话环境")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func featureRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var providerBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("已配置的 AI 提供商")
                .font(.subheadline.weight(.semibold))
            ForEach(providers) { row in
                HStack {
                    Text(row.providerId)
                        .font(.body.monospaced())
                    Spacer()
                    Text(statusByProvider[row.providerId] ?? "已配置")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder
    private var ctaBlock: some View {
        if hasCredentials {
            VStack(spacing: 10) {
                Button {
                    store.addProjectViaPanel()
                } label: {
                    Label("添加项目文件夹", systemImage: "folder.badge.plus")
                }
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)

                Button("添加模型") {
                    showAddModelSheet = true
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        } else {
            VStack(spacing: 10) {
                Button {
                    showAddModelSheet = true
                } label: {
                    Label("添加模型", systemImage: "key.fill")
                }
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)

                Button("添加项目文件夹") {
                    store.addProjectViaPanel()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
    }

    private func refreshCredentials() {
        Task.detached(priority: .userInitiated) {
            let loaded = EmptyStateCredentialSummary.load()
            await MainActor.run {
                providers = loaded
                // Seed defaults; Task 4 overwrites with live monitors.
                var seed: [String: String] = [:]
                for p in loaded { seed[p.providerId] = "已配置" }
                statusByProvider = seed
                bindMonitors(for: loaded)
            }
        }
    }

    // Stubs filled in Task 4 — must compile:
    private func bindMonitors(for providers: [EmptyStateConfiguredProvider]) {
        tearDownMonitors()
        // Task 4 implements observe + refreshIfNeeded
    }

    private func tearDownMonitors() {
        for (qp, id) in quotaObserverIDs {
            qp.monitor.removeObserver(id)
        }
        quotaObserverIDs.removeAll()
        for (bp, id) in balanceObserverIDs {
            bp.monitor.removeObserver(id)
        }
        balanceObserverIDs.removeAll()
    }
}
