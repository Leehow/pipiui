import SwiftUI

struct EmptyStateView: View {
    @EnvironmentObject var store: AppStore

    @StateObject private var accountStatus = EmptyStateAccountStatusModel()
    @State private var showAddModelSheet = false

    private var hasCredentials: Bool { !accountStatus.providers.isEmpty }

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
        .onAppear { accountStatus.reload() }
        .onDisappear { accountStatus.tearDown() }
        .sheet(isPresented: $showAddModelSheet) {
            AddModelSheet {
                accountStatus.reload()
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
            ForEach(accountStatus.providers) { row in
                HStack {
                    Text(row.providerId)
                        .font(.body.monospaced())
                    Spacer()
                    Text(accountStatus.statusByProvider[row.providerId] ?? "已配置")
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
}

/// Owns the empty-state provider list plus live quota/balance status text.
/// A `StateObject`-held class (rather than plain `@State` in `EmptyStateView`)
/// so the escaping `QuotaMonitor`/`BalanceMonitor` observer closures can hop
/// back with a plain `weak self` instead of fighting SwiftUI View-struct
/// capture semantics.
@MainActor
final class EmptyStateAccountStatusModel: ObservableObject {
    @Published private(set) var providers: [EmptyStateConfiguredProvider] = []
    /// providerId → status trailing text.
    @Published private(set) var statusByProvider: [String: String] = [:]

    private var quotaObserverIDs: [QuotaProvider: UUID] = [:]
    private var balanceObserverIDs: [BalanceProvider: UUID] = [:]

    /// Disk-scans configured providers, then (re)binds live monitors. Safe to
    /// call repeatedly (e.g. on appear, after adding a model).
    func reload() {
        Task.detached(priority: .userInitiated) { [weak self] in
            let loaded = EmptyStateCredentialSummary.load()
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.providers = loaded
                var seed: [String: String] = [:]
                for p in loaded { seed[p.providerId] = "已配置" }
                self.statusByProvider = seed
                self.bindMonitors(for: loaded)
            }
        }
    }

    /// Removes all observers. Call on disappear and before every rebind so
    /// stale providers don't keep pushing updates into a torn-down screen.
    func tearDown() {
        for (qp, id) in quotaObserverIDs {
            qp.monitor.removeObserver(id)
        }
        quotaObserverIDs.removeAll()
        for (bp, id) in balanceObserverIDs {
            bp.monitor.removeObserver(id)
        }
        balanceObserverIDs.removeAll()
    }

    /// Binds one monitor per distinct `QuotaProvider`/`BalanceProvider` backing
    /// the given rows. Quota takes priority over balance for a given provider
    /// row (mirrors `EmptyStateCredentialSummary.statusText`). Monitor
    /// failures are silent: the monitor keeps its last good snapshot (or nil),
    /// and `statusText` falls back to "已配置".
    private func bindMonitors(for providers: [EmptyStateConfiguredProvider]) {
        tearDown()
        var seenQuota = Set<QuotaProvider>()
        var seenBalance = Set<BalanceProvider>()

        for row in providers {
            if let qp = quotaProvider(for: row.providerId) {
                if seenQuota.insert(qp).inserted {
                    let id = qp.monitor.observe { [weak self] snapshot in
                        Task { @MainActor [weak self] in
                            self?.applyQuota(qp, usedPercent: snapshot?.capsule?.usedPercent)
                        }
                    }
                    quotaObserverIDs[qp] = id
                }
                continue
            }

            if let bp = balanceProvider(for: row.providerId) {
                if seenBalance.insert(bp).inserted {
                    let id = bp.monitor.observe { [weak self] snapshot in
                        let balanceText = snapshot.map { formatBalance(amount: $0.amount, currency: $0.currency) }
                        Task { @MainActor [weak self] in
                            self?.applyBalance(bp, balanceText: balanceText)
                        }
                    }
                    balanceObserverIDs[bp] = id
                }
            }
        }
    }

    private func applyQuota(_ provider: QuotaProvider, usedPercent: Double?) {
        let text = EmptyStateCredentialSummary.statusText(quotaUsedPercent: usedPercent, balanceText: nil)
        for row in providers where quotaProvider(for: row.providerId) == provider {
            statusByProvider[row.providerId] = text
        }
    }

    private func applyBalance(_ provider: BalanceProvider, balanceText: String?) {
        let text = EmptyStateCredentialSummary.statusText(quotaUsedPercent: nil, balanceText: balanceText)
        for row in providers
        where balanceProvider(for: row.providerId) == provider && quotaProvider(for: row.providerId) == nil {
            statusByProvider[row.providerId] = text
        }
    }
}
