import SwiftUI

private enum SettingsTab: String, CaseIterable, Identifiable {
    case general = "通用"
    case models = "模型"
    case usage = "用量"
    case toolsSkills = "工具与 Skills"
    case subagentModels = "Subagent 模型"
    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .general: return "slider.horizontal.3"
        case .models: return "cpu"
        case .usage: return "chart.bar.fill"
        case .toolsSkills: return "wrench.and.screwdriver"
        case .subagentModels: return "person.2"
        }
    }
}

enum SettingsReloadPolicy {
    static func shouldReload(from wasVisible: Bool, to isVisible: Bool) -> Bool {
        !wasVisible && isVisible
    }
}

struct SettingsSheet: View {
    @EnvironmentObject var store: AppStore

    @State private var tab: SettingsTab = .general
    @State private var models: [ModelInfo] = []
    @State private var credentials: [PiAuthStore.CredentialInfo] = []
    @State private var hiddenIds: Set<String> = ModelVisibility.hiddenModelIds()
    @State private var weakIds: Set<String> = ModelTierSettings.weakModelIds()
    @State private var agents: [AgentDefinition] = []
    @State private var subagentSettings: [String: SubagentModelSettings.Override] = SubagentModelSettings.allSettings()
    @State private var disabledTools: Set<String> = ToolSkillSettings.disabledTools()
    @State private var disabledSkills: Set<String> = ToolSkillSettings.disabledSkills()
    @State private var webSearchBackend: String = WebSearchSettings.backend()
    /// 输入缓冲：永不回显已存 key；留空 = 不修改。
    @State private var webSearchApiKey: String = ""
    /// 当前后端 key 是否已在 .env 配置（驱动 placeholder /「清除」按钮）。
    @State private var webSearchKeyConfigured = false
    /// .env 中已配置 key 的 provider 集合（用于 auth.json 残留冲突警告）。
    @State private var envConfiguredProviders: Set<String> = []
    /// .env 存取（placeholder 查询、清除、删除凭据时可选的同步移除）。
    @State private var envStore = EnvFileStore()
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var pendingDeleteProvider: String?
    @State private var showAddSheet = false
    /// T9/T-tab 减负：pickerModels 改为缓存 @State，仅在 models/hiddenIds/subagentSettings 变化时重算。
    @State private var pickerModels: [ModelInfo] = []
    /// 模型 tab 的 provider 分组缓存（reload 时重算，见 recomputeGroupedModels）。
    @State private var groupedModels: [ProviderModelGroup] = []

    @State private var usagePeriod: TokenUsageStats.Period = .today
    @State private var usageGroupBy: TokenUsageStats.GroupBy = .model
    @State private var usageReport = TokenUsageStats.Report(total: .init(), rows: [])
    @State private var usageExpanded: Set<String> = []
    @State private var usageLoading = false
    @State private var usageRequestID = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Picker("设置分页", selection: $tab) {
                ForEach(SettingsTab.allCases) { t in
                    // macOS segmented Picker can silently drop the title when the
                    // option content is a `Label` (icon+text), leaving only the
                    // icon visible. Use `Text` so the tab title is always shown;
                    // the icon is preserved for assistive tech via .help/a11y label.
                    Text(t.rawValue)
                        .tag(t)
                        .help(t.rawValue)
                        .accessibilityLabel(t.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
            Divider()
            if tab == .models {
                modelSettingsList
            } else {
                ScrollView {
                    activeNonModelSection
                        .padding(20)
                }
            }
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }
        }
        .frame(width: 640, height: 620)
        .task { await reload() }
        .onChange(of: store.showSettings) { wasVisible, isVisible in
            if SettingsReloadPolicy.shouldReload(from: wasVisible, to: isVisible) {
                Task { await reload() }
            }
        }
        .onChange(of: tab) { _, newValue in
            if newValue == .usage { reloadUsage() }
        }
        .onChange(of: usagePeriod) { _, _ in reloadUsage() }
        .onChange(of: usageGroupBy) { _, _ in
            usageExpanded = []
            reloadUsage()
        }
        .sheet(isPresented: $showAddSheet) {
            AddModelSheet {
                Task { await reload(restartSessions: true) }
            }
            .environmentObject(store)
        }
        .confirmationDialog(
            "删除凭据？",
            isPresented: Binding(
                get: { pendingDeleteProvider != nil },
                set: { if !$0 { pendingDeleteProvider = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let provider = pendingDeleteProvider {
                Button("删除 \(provider)（仅 auth.json）", role: .destructive) {
                    Task { await deleteProvider(provider, removeEnvKey: false) }
                }
                if envConfiguredProviders.contains(provider) {
                    Button("删除并同时从 .env 移除", role: .destructive) {
                        Task { await deleteProvider(provider, removeEnvKey: true) }
                    }
                }
            }
            Button("取消", role: .cancel) { pendingDeleteProvider = nil }
        } message: {
            Text("将从 ~/.pi/agent/auth.json 移除该 provider 的凭据（与 pi /logout 相同）。默认不影响 ~/.pi/agent/.env 中的同名 key——若 .env 也配置了该 provider 的 key，模型仍可用，可选「同时从 .env 移除」一并删除。models.json 不受影响。删除后该 provider 下所有模型会从列表消失。")
        }
    }

    @ViewBuilder
    private var activeNonModelSection: some View {
        switch tab {
        case .general:
            generalSection
        case .usage:
            usageSection
        case .toolsSkills:
            toolsSkillsSection
        case .subagentModels:
            subagentModelsSection
        case .models:
            EmptyView()
        }
    }

    private var header: some View {
        HStack {
            Text("设置")
                .font(.headline)
            Spacer()
            // 快捷键按可见性门控，避免隐藏的设置面板抢走聊天输入框的回车/Esc。
            Button("完成") { store.showSettings = false }
                .keyboardShortcut(store.showSettings ? .defaultAction : nil)
            Button("") { store.showSettings = false }
                .keyboardShortcut(store.showSettings ? .cancelAction : nil)
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: - General

    private var generalSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                Text("通用")
                    .font(.title3.weight(.semibold))
                Toggle(isOn: $store.bossModeEnabled) {
                    Label("Boss 模式", systemImage: "crown")
                }
                .help("Boss 模式：新会话以大组长协议启动——不亲自干活，按难度分派 subagent（简单派单兵、复杂派组长、调研扇出），配合反早停失败恢复协议")
                Text("开启后，新会话以大组长协议启动：不亲自干活，按难度分派 subagent。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Divider()
            webSearchSection
        }
    }

    // MARK: - Models

    /// Native List virtualizes at the individual model-row level. A LazyVStack
    /// nested inside provider cards only deferred whole cards, which still forced
    /// every model toggle in a provider to be created while scrolling.
    private var modelSettingsList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("模型设置")
                    .font(.title3.weight(.semibold))
                Spacer()
                Button {
                    showAddSheet = true
                } label: {
                    Label("添加模型", systemImage: "plus")
                }
                .disabled(isLoading)
            }

            Text("左侧勾选控制底栏模型菜单是否显示；删除会移除该 provider 的 Pi 凭据。"
                 + "「弱模型」标记的模型会强制走 Superpowers 流程（未标记 = 强模型，技能库只作提示）。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if isLoading && models.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 24)
            } else if models.isEmpty {
                Text("暂无已配置凭据的模型。点击「添加模型」登录或写入 API key。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 12)
            } else {
                List {
                    ForEach(groupedModels) { group in
                        Section {
                            // T19 冲突警告：.env 与 auth.json(api_key) 同时存在时，
                            // auth.json 的旧 key 会覆盖 .env，提供一键清理。
                            if let cred = credentials.first(where: { $0.providerId == group.provider }),
                               cred.type == "api_key",
                               envConfiguredProviders.contains(group.provider) {
                                HStack(spacing: 6) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundStyle(.orange)
                                    Text("auth.json 残留旧 key 将覆盖 .env")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                    Spacer()
                                    Button("清理") {
                                        Task { await cleanupStaleAuthKey(group.provider) }
                                    }
                                    .font(.caption)
                                }
                            }
                            ForEach(group.models) { model in
                                modelSettingsRow(model)
                            }
                        } header: {
                            modelProviderHeader(group)
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }

    private func modelProviderHeader(_ group: ProviderModelGroup) -> some View {
        HStack {
            ProviderLogo(provider: group.provider, size: 14)
            Text(group.provider)
                .font(.subheadline.weight(.semibold))
            if let cred = credentials.first(where: { $0.providerId == group.provider }) {
                Text(cred.type == "oauth" ? "账号" : "API key")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.primary.opacity(0.08)))
            }
            Spacer()
            Button(role: .destructive) {
                pendingDeleteProvider = group.provider
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("删除该 provider 凭据")
        }
    }

    private func modelSettingsRow(_ model: ModelInfo) -> some View {
        HStack(spacing: 8) {
            Toggle(isOn: visibilityBinding(for: model.id)) {
                HStack(spacing: 8) {
                    ProviderLogo(model: model, size: 16)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.name)
                            .font(.callout)
                        Text(model.id)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .toggleStyle(.checkbox)

            Spacer(minLength: 8)

            Toggle(isOn: weakTierBinding(for: model.id)) {
                Text("弱模型")
                    .font(.caption)
            }
            .toggleStyle(.checkbox)
            .help("勾选后该模型强制走 Superpowers 流程：难任务必须先调技能，首次派工前会被要求先读 SOP。")
        }
    }

    // MARK: - Usage

    /// CodexBar menu-bar teal (≈ #49A3B0) for usage bars / histogram.
    private var usageAccent: Color {
        Color(red: 73 / 255, green: 163 / 255, blue: 176 / 255)
    }

    private var usageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "chart.bar.fill")
                    .font(.title3)
                    .foregroundStyle(usageAccent)
                Text("用量统计")
                    .font(.title3.weight(.semibold))
                Spacer()
                Button {
                    reloadUsage()
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                .disabled(usageLoading)
            }

            Text("Tokens = input + output + cacheWrite（不含 cacheRead）。Cost 按官网/API 牌价从 token 重算为人民币（含缓存与 >200k/272k 长上下文档）；美元牌价按约 \(String(format: "%.2f", ModelPricing.Catalog.shared.exchangeRate)) 汇率换算。订阅套餐模型按对应 API 牌价估算等价花费，非账单实扣。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if usageGroupBy == .tool {
                Text("按工具视图为整轮归因：同一轮的 tokens / cost 会计入其涉及的每个工具，各工具之和可能大于合计；历史无 tools 字段的记录归入「\(TokenUsageStats.noToolKey)」。")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Picker("时间", selection: $usagePeriod) {
                ForEach(TokenUsageStats.Period.allCases) { period in
                    Text(period.label).tag(period)
                }
            }
            .pickerStyle(.segmented)

            Picker("视图", selection: $usageGroupBy) {
                ForEach(TokenUsageStats.GroupBy.allCases) { groupBy in
                    Label(groupBy.label, systemImage: usageGroupByIcon(groupBy)).tag(groupBy)
                }
            }
            .pickerStyle(.segmented)

            usageTotalsBar

            if !usageReport.rows.isEmpty {
                usageDistributionChart
            }

            Divider()

            if usageLoading && usageReport.rows.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 24)
            } else if usageReport.rows.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "chart.bar.doc.horizontal")
                        .foregroundStyle(.tertiary)
                    Text("暂无用量记录。发送消息或派出 subagent 后会出现在这里。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 12)
            } else {
                usageColumnHeader
                ForEach(usageReport.rows) { row in
                    usageRowView(row)
                }
            }
        }
    }

    private var usageColumnLabel: String {
        switch usageGroupBy {
        case .model: return "模型"
        case .role: return "角色"
        case .tool: return "工具"
        }
    }

    private var usageColumnHeader: some View {
        HStack {
            Text(usageColumnLabel)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer()
            Text("Calls")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 50, alignment: .trailing)
            Text("Tokens")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 70, alignment: .trailing)
            Text("Cost")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 70, alignment: .trailing)
        }
        .padding(.horizontal, 4)
    }

    private var usageTotalsBar: some View {
        HStack(spacing: 16) {
            usageTotalItem(icon: "number", label: "Calls", value: "\(usageReport.total.calls)")
            usageTotalItem(icon: "text.word.spacing", label: "Tokens", value: TokenFormat.compact(usageReport.total.tokens))
            usageTotalItem(icon: "yensign.circle", label: "Cost", value: usageCostText(usageReport.total.cost))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(usageAccent.opacity(0.25), lineWidth: 1)
                )
        )
    }

    /// Mini vertical bars for top rows — CodexBar usage-history glance.
    private var usageDistributionChart: some View {
        let bars = Array(usageReport.rows.prefix(16))
        let maxWeight = bars.map(usageWeight).max() ?? 0
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "chart.bar.fill")
                    .font(.caption2)
                    .foregroundStyle(usageAccent)
                Text("分布（当前视图前 \(bars.count) 项）")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(bars) { row in
                    let h = maxWeight > 0 ? max(3, 36 * usageWeight(row) / maxWeight) : 3
                    RoundedRectangle(cornerRadius: 2)
                        .fill(usageAccent.opacity(0.85))
                        .frame(maxWidth: .infinity)
                        .frame(height: h)
                        .help("\(row.key): \(usageCostText(row.metrics.cost)) · \(TokenFormat.compact(row.metrics.tokens)) tok")
                }
            }
            .frame(height: 40)
            .padding(.horizontal, 2)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.03)))
    }

    private func usageTotalItem(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.callout)
                .foregroundStyle(usageAccent)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.callout.weight(.semibold).monospacedDigit())
            }
        }
    }

    private func usageRowView(_ row: TokenUsageStats.Row) -> some View {
        let isExpanded = usageExpanded.contains(row.key)
        let share = usageShare(of: row.metrics)
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                if isExpanded {
                    usageExpanded.remove(row.key)
                } else {
                    usageExpanded.insert(row.key)
                }
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(width: 12)
                        usageKeyLogo(row.key, size: 14)
                            .frame(width: 16)
                        Text(row.key)
                            .font(.callout)
                            .lineLimit(1)
                        Spacer()
                        Text("\(row.metrics.calls)")
                            .font(.callout.monospacedDigit())
                            .frame(width: 50, alignment: .trailing)
                        Text(TokenFormat.compact(row.metrics.tokens))
                            .font(.callout.monospacedDigit())
                            .frame(width: 70, alignment: .trailing)
                        Text(usageCostText(row.metrics.cost))
                            .font(.callout.monospacedDigit())
                            .frame(width: 70, alignment: .trailing)
                    }
                    // CodexBar-style track + teal fill (share of current-view total).
                    usageProgressBar(share: share)
                        .padding(.leading, 34)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                usageDetailView(row.metrics)
                    .padding(.leading, 34)
                if !row.children.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(row.children) { child in
                            usageChildRowView(child)
                        }
                    }
                    .padding(.leading, 34)
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(isExpanded ? 0.04 : 0)))
    }

    private func usageDetailView(_ metrics: TokenUsageStats.Metrics) -> some View {
        let denom = metrics.input + metrics.cacheRead + metrics.cacheWrite
        let hitRate = denom > 0 ? Double(metrics.cacheRead) / Double(denom) : 0
        return HStack(spacing: 10) {
            usageChip(icon: "arrow.up", text: "In \(TokenFormat.compact(metrics.input))")
            usageChip(icon: "arrow.down", text: "Out \(TokenFormat.compact(metrics.output))")
            usageChip(icon: "internaldrive", text: "R \(TokenFormat.compact(metrics.cacheRead))")
            usageChip(icon: "externaldrive.badge.plus", text: "W \(TokenFormat.compact(metrics.cacheWrite))")
            usageChip(icon: "bolt.fill", text: "命中 \(Int((hitRate * 100).rounded()))%")
        }
    }

    private func usageChip(icon: String, text: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.caption2)
            Text(text)
                .font(.caption.monospacedDigit())
        }
        .foregroundStyle(.secondary)
    }

    private func usageChildRowView(_ row: TokenUsageStats.Row) -> some View {
        HStack(spacing: 6) {
            usageChildLogo(row.key, size: 12)
                .frame(width: 14)
            Text(row.key)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer()
            Text("\(row.metrics.calls)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 50, alignment: .trailing)
            Text(TokenFormat.compact(row.metrics.tokens))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 70, alignment: .trailing)
            Text(usageCostText(row.metrics.cost))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 70, alignment: .trailing)
        }
    }

    private func usageProgressBar(share: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                Capsule()
                    .fill(usageAccent)
                    .frame(width: max(2, geo.size.width * min(1, max(0, share))))
            }
        }
        .frame(height: 4)
        .accessibilityLabel("占比 \(Int((share * 100).rounded()))%")
    }

    private func usageWeight(_ row: TokenUsageStats.Row) -> Double {
        if usageReport.total.cost > 0 { return row.metrics.cost }
        return Double(row.metrics.tokens)
    }

    private func usageShare(of metrics: TokenUsageStats.Metrics) -> Double {
        if usageReport.total.cost > 0 {
            return min(1, metrics.cost / usageReport.total.cost)
        }
        let denom = Double(usageReport.total.tokens)
        guard denom > 0 else { return 0 }
        return min(1, Double(metrics.tokens) / denom)
    }

    private func usageGroupByIcon(_ groupBy: TokenUsageStats.GroupBy) -> String {
        switch groupBy {
        case .model: return "cpu"
        case .role: return "person.2"
        case .tool: return "wrench.and.screwdriver"
        }
    }

    private func usageRowIcon(for key: String) -> String {
        switch usageGroupBy {
        case .model: return usageModelIcon(key)
        case .role: return usageRoleIcon(key)
        case .tool: return usageToolIcon(key)
        }
    }

    private func usageChildIcon(for key: String) -> String {
        switch usageGroupBy {
        case .model: return usageRoleIcon(key)   // children are roles
        case .role: return usageModelIcon(key)   // children are models
        case .tool: return usageRoleIcon(key)    // children are roles
        }
    }

    private func usageModelIcon(_ key: String) -> String {
        let parsed = ProviderLogoCatalog.parse(modelRef: key)
        if !parsed.provider.isEmpty {
            return ProviderLogoCatalog.systemImage(provider: parsed.provider, modelId: parsed.modelId)
        }
        return ProviderLogoCatalog.systemImage(provider: key, modelId: nil)
    }

    @ViewBuilder
    private func usageKeyLogo(_ key: String, size: CGFloat) -> some View {
        switch usageGroupBy {
        case .model:
            ProviderLogo(modelRef: key, size: size)
        default:
            Image(systemName: usageRowIcon(for: key))
                .font(.system(size: size - 2))
                .foregroundStyle(usageAccent)
        }
    }

    @ViewBuilder
    private func usageChildLogo(_ key: String, size: CGFloat) -> some View {
        switch usageGroupBy {
        case .role:
            // children are models
            ProviderLogo(modelRef: key, size: size)
        default:
            Image(systemName: usageChildIcon(for: key))
                .font(.system(size: size - 2))
                .foregroundStyle(.tertiary)
        }
    }

    private func usageRoleIcon(_ key: String) -> String {
        switch key {
        case "main": return "person.fill"
        case "explore": return "magnifyingglass"
        case "plan": return "map"
        case "general-purpose": return "wrench.and.screwdriver"
        case "reviewer": return "eye"
        case "lead": return "flag.fill"
        case "subagent": return "person.2"
        default: return "person.crop.circle"
        }
    }

    private func usageToolIcon(_ key: String) -> String {
        switch key {
        case TokenUsageStats.noToolKey: return "text.alignleft"
        case "bash": return "terminal"
        case "read": return "doc.text"
        case "write": return "square.and.pencil"
        case "edit": return "pencil"
        case "grep", "find": return "magnifyingglass"
        case "ls": return "folder"
        case "web_search", "web_fetch": return "globe"
        case "subagent", "subagent_status": return "person.2"
        case "generate_image": return "photo"
        case "browser", "browser_navigate", "browser_click": return "safari"
        case "git_status", "git_diff": return "arrow.triangle.branch"
        default: return "hammer"
        }
    }

    private func usageCostText(_ cost: Double) -> String {
        ModelPricing.formatCNY(cost)
    }

    private func reloadUsage() {
        usageRequestID += 1
        let requestID = usageRequestID
        usageLoading = true
        let period = usagePeriod
        let groupBy = usageGroupBy
        Task.detached(priority: .utility) {
            let records = TokenUsageStats.loadSharedRecords()
            let report = TokenUsageStats.aggregate(records: records, period: period, groupBy: groupBy)
            await MainActor.run {
                guard requestID == usageRequestID else { return }
                usageReport = report
                usageLoading = false
            }
        }
    }

    // MARK: - Tools & Skills

    private var toolsSkillsSection: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            Text("工具与 Skills")
                .font(.title3.weight(.semibold))
            Text("开关关闭后：工具通过 `--exclude-tools` 在会话重启后对 pi 生效；Skills 立即从斜杠菜单隐藏（下次派出 subagent 也会尊重工具禁用）。")
                .font(.caption)
                .foregroundStyle(.secondary)

            catalogGroup(title: "内置工具", entries: ToolSkillCatalog.builtinTools)
            catalogGroup(title: "扩展工具", entries: ToolSkillCatalog.extensionTools)

            LazyVStack(alignment: .leading, spacing: 8) {
                Text("Skills")
                    .font(.subheadline.weight(.semibold))
                let skills = ToolSkillCatalog.skills(from: store.currentSession?.availableCommands ?? [])
                if store.currentSession == nil {
                    Text("打开一个会话后可在此查看已加载的 skills。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if skills.isEmpty {
                    Text("当前会话未发现 skill（可用 /reload 重载）。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(skills) { skill in
                        Toggle(isOn: skillEnabledBinding(for: skill.name)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("/\(skill.name)")
                                    .font(.callout.monospaced())
                                if let desc = skill.description, !desc.isEmpty {
                                    Text(desc)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .toggleStyle(.checkbox)
                        .padding(.vertical, 2)
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

            if !agents.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("各 Subagent 可用工具")
                        .font(.subheadline.weight(.semibold))
                    ForEach(agents) { agent in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(agent.name)
                                .font(.callout.weight(.medium))
                            Text(agent.tools.isEmpty ? "（未限制）" : agent.tools.joined(separator: ", "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
            }
        }
    }

    private func catalogGroup(title: String, entries: [ToolSkillCatalog.ToolEntry]) -> some View {
        LazyVStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            ForEach(entries) { tool in
                Toggle(isOn: toolEnabledBinding(for: tool.name)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tool.name)
                            .font(.callout.monospaced())
                        Text(tool.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .padding(.vertical, 2)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    private func toolEnabledBinding(for name: String) -> Binding<Bool> {
        Binding(
            get: { !disabledTools.contains(name) },
            set: { enabled in
                ToolSkillSettings.setToolEnabled(enabled, name: name)
                disabledTools = ToolSkillSettings.disabledTools()
                statusMessage = enabled ? "已启用工具 \(name)（将重启会话）" : "已禁用工具 \(name)（将重启会话）"
                store.restartAllOpenSessions()
            }
        )
    }

    private func skillEnabledBinding(for name: String) -> Binding<Bool> {
        Binding(
            get: { !disabledSkills.contains(name) },
            set: { enabled in
                ToolSkillSettings.setSkillEnabled(enabled, name: name)
                disabledSkills = ToolSkillSettings.disabledSkills()
                store.skillVisibilityRevision &+= 1
                statusMessage = enabled ? "已启用 skill /\(name)" : "已禁用 skill /\(name)（斜杠菜单已隐藏）"
            }
        )
    }

    // MARK: - Subagent models

    private var subagentModelsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Subagent 模型")
                .font(.title3.weight(.semibold))
            Text("默认「跟随主 Agent」= 输入框下方 / 底栏当前选中的模型；也可为 explore / plan / general-purpose 等类型指定固定模型和思考强度。未指定思考强度时使用 Pi / 模型默认值；下次派出即生效。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let main = store.currentSession?.model {
                HStack(spacing: 6) {
                    ProviderLogo(model: main, size: 14)
                    Text("当前主 Agent（底栏）：\(main.name)（\(main.id)）")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("当前无打开会话；「跟随」将在派出时使用当时底栏选中的模型。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(agents) { agent in
                SubagentModelRow(
                    agent: agent,
                    pickerModels: pickerModels,
                    selection: subagentSettings[agent.name]?.model ?? SubagentModelSettings.followMainSentinel,
                    thinking: subagentSettings[agent.name]?.thinking ?? SubagentModelSettings.defaultThinkingSentinel
                ) { newValue in
                    setSubagentModelOverride(newValue, for: agent.name)
                } onSelectThinking: { newValue in
                    setSubagentThinkingOverride(newValue, for: agent.name)
                }
            }
        }
    }

    /// Subagent picker 候选模型的重算（原 pickerModels 计算属性每次 body 求值都
    /// 全量 hiddenModelIds()+filter，切 tab 会卡）。调用时机：reload 完成、
    /// 可见性勾选变化、subagent override 变化。
    private func recomputePickerModels() {
        let selectedIds = Set(subagentSettings.values.map(\.model))
        pickerModels = models.filter { model in
            if selectedIds.contains(model.id) { return true }
            return !hiddenIds.contains(model.id)
        }
    }

    private func setSubagentModelOverride(_ newValue: String, for agentName: String) {
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentThinking = subagentSettings[agentName]?.thinking
        SubagentModelSettings.setOverride(
            trimmed.isEmpty ? nil : trimmed,
            thinking: currentThinking,
            for: agentName
        )
        subagentSettings = SubagentModelSettings.allSettings()
        recomputePickerModels()
        statusMessage = "已保存 \(agentName) 的模型设置"
    }

    private func setSubagentThinkingOverride(_ newValue: String, for agentName: String) {
        guard let model = subagentSettings[agentName]?.model else { return }
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        SubagentModelSettings.setOverride(
            model,
            thinking: trimmed.isEmpty ? nil : trimmed,
            for: agentName
        )
        subagentSettings = SubagentModelSettings.allSettings()
        statusMessage = "已保存 \(agentName) 的思考强度"
    }

    // MARK: - Web Search

    private var webSearchSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("网络搜索")
                .font(.title3.weight(.semibold))
            Text("为不带联网搜索的模型（Kimi 等）提供 web_search / web_fetch 工具。当前模型若自带搜索（Grok、GLM、官方 Codex、Claude），web_search 会自动跳过。")
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Picker("搜索后端", selection: $webSearchBackend) {
                    Text("DuckDuckGo（免费，无需 key）").tag("duckduckgo")
                    Text("Tavily").tag("tavily")
                    Text("Brave Search").tag("brave")
                    Text("SerpAPI (Google)").tag("serpapi")
                    Text("Exa AI").tag("exa")
                    Text("Kimi Code").tag("kimi")
                }
                .onChange(of: webSearchBackend) { _, newValue in
                    WebSearchSettings.setBackend(newValue)
                    // 输入缓冲不回显：切后端后清空，仅刷新「已配置」状态。
                    webSearchApiKey = ""
                    webSearchKeyConfigured = WebSearchSettings.isKeyConfigured(for: newValue, store: envStore)
                    statusMessage = "搜索后端已切换为 \(newValue)（立即生效，无需重启会话）"
                }

                if webSearchBackend != "duckduckgo" {
                    HStack(spacing: 8) {
                        SecureField(
                            webSearchKeyConfigured ? "已配置，输入以替换" : "未配置",
                            text: $webSearchApiKey
                        )
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { saveWebSearchKey() }
                        Button("保存") { saveWebSearchKey() }
                            .disabled(webSearchApiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if webSearchKeyConfigured {
                            Button("清除") { clearWebSearchKey() }
                        }
                    }
                    Text("留空 = 不修改；key 保存在 ~/.pi/agent/.env（\(WebSearchSettings.envVar(for: webSearchBackend) ?? "")）。")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(backendHelpText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

            if let model = store.currentSession?.model,
               WebSearchSettings.isNativeSearchModel(provider: model.provider, modelId: model.modelId) {
                Label("当前模型（\(model.name)）自带联网搜索，web_search 工具会自动跳过。", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Text("设置修改后立即对新的工具调用生效（热读取），无需重启会话。后端选择存于 websearch-config.json；API key 以 0600 权限存于 ~/.pi/agent/.env。")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    /// 显式「保存」/ 回车提交：留空 = 不修改。
    private func saveWebSearchKey() {
        let trimmed = webSearchApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            try WebSearchSettings.setApiKey(trimmed, for: webSearchBackend, store: envStore)
            webSearchApiKey = ""
            webSearchKeyConfigured = true
            statusMessage = "已保存 \(webSearchBackend) 的 API key 到 ~/.pi/agent/.env"
        } catch {
            errorMessage = "保存搜索 key 失败：\(error.localizedDescription)"
        }
    }

    private func clearWebSearchKey() {
        do {
            try WebSearchSettings.setApiKey(nil, for: webSearchBackend, store: envStore)
            webSearchApiKey = ""
            webSearchKeyConfigured = false
            statusMessage = "已从 .env 清除 \(webSearchBackend) 的 API key"
        } catch {
            errorMessage = "清除搜索 key 失败：\(error.localizedDescription)"
        }
    }

    /// 冲突警告的「清理」：删除 auth.json 中该 provider 的 api_key 残留（oauth 不动）。
    @MainActor
    private func cleanupStaleAuthKey(_ providerId: String) async {
        do {
            let removed = try PiAuthStore.deleteAPIKeyEntry(providerId: providerId)
            if removed {
                credentials = PiAuthStore.list()
                store.restartAllOpenSessions()
                statusMessage = "已清理 \(providerId) 在 auth.json 的残留 key，.env 配置生效"
            } else {
                statusMessage = "\(providerId) 在 auth.json 无 api_key 条目，无需清理"
            }
        } catch {
            errorMessage = "清理失败：\(error.localizedDescription)"
        }
    }

    private var backendHelpText: String {
        switch webSearchBackend {
        case "tavily": return "在 tavily.com 注册获取 API key（免费 1000 次/月）。"
        case "brave": return "在 brave.com/search/api 注册获取 Subscription Token（免费 2000 次/月）。"
        case "serpapi": return "在 serpapi.com 注册获取 API key（免费 100 次/月）。"
        case "exa": return "在 exa.ai 注册获取 API key（免费 1000 次/月，语义搜索）。"
        case "kimi":
            return "使用 Kimi Code 会员搜索（api.kimi.com/coding/v1/search）。可写 .env 的 KIMI_API_KEY，或复用已登录的 kimi-coding（auth.json）。"
        default: return ""
        }
    }

    /// 模型 tab 的 provider 分组缓存：原实现每次 body 求值都
    /// `models.filter { $0.provider == provider }`（每 provider 全量过滤）。
    /// models 只在 reload() 中变化，故在 reload 末尾一次性算好。
    private func recomputeGroupedModels() {
        var seen: Set<String> = []
        var groups: [ProviderModelGroup] = []
        for m in models where !seen.contains(m.provider) {
            seen.insert(m.provider)
            groups.append(ProviderModelGroup(
                provider: m.provider,
                models: models.filter { $0.provider == m.provider }
            ))
        }
        groupedModels = groups
    }

    private func visibilityBinding(for modelId: String) -> Binding<Bool> {
        Binding(
            get: { !hiddenIds.contains(modelId) },
            set: { visible in
                ModelVisibility.setHidden(!visible, modelId: modelId)
                hiddenIds = ModelVisibility.hiddenModelIds()
                recomputePickerModels()
                store.modelVisibilityRevision &+= 1
            }
        )
    }

    /// Tier only drives prompt wording and the dispatch gate — it changes neither the picker
    /// nor any spawn argument, so the extension's hot-read JSON is the whole propagation path
    /// (no session restart needed).
    private func weakTierBinding(for modelId: String) -> Binding<Bool> {
        Binding(
            get: { weakIds.contains(modelId) },
            set: { weak in
                ModelTierSettings.setWeak(weak, modelId: modelId)
                weakIds = ModelTierSettings.weakModelIds()
            }
        )
    }

    /// reload 的同步 I/O 前缀快照（后台线程执行，主线程只赋值）。
    /// 注意：不再调 SubagentModelSettings.syncJSONFile() / ToolSkillSettings.syncJSONFile()——
    /// 它们的 setter 在真正编辑时已各自同步；reload 无编辑场景不应重写文件。
    private struct ReloadSnapshot {
        var credentials: [PiAuthStore.CredentialInfo]
        var hiddenIds: Set<String>
        var weakIds: Set<String>
        var agents: [AgentDefinition]
        var subagentSettings: [String: SubagentModelSettings.Override]
        var disabledTools: Set<String>
        var disabledSkills: Set<String>
        var webSearchBackend: String
        var webSearchKeyConfigured: Bool
        var envConfiguredProviders: Set<String>
    }

    /// 磁盘 I/O 集中在后台：auth.json、agents 目录（已有进程级缓存）、UserDefaults、.env 读取。
    nonisolated private static func loadReloadSnapshot() -> ReloadSnapshot {
        let backend = WebSearchSettings.backend()
        let envStore = EnvFileStore()
        let credentials = PiAuthStore.list()
        // .env 已配置 key 的 provider：仅 auth.json 在列的 provider 才需要冲突检测。
        let envConfigured = Set(
            credentials.map(\.providerId).filter { pid in
                ProviderEnvMap.envVars(forProvider: pid).contains { envStore.isConfigured(forKey: $0) }
            }
        )
        return ReloadSnapshot(
            credentials: credentials,
            hiddenIds: ModelVisibility.hiddenModelIds(),
            weakIds: ModelTierSettings.weakModelIds(),
            agents: AgentCatalog.load(),
            subagentSettings: SubagentModelSettings.allSettings(),
            disabledTools: ToolSkillSettings.disabledTools(),
            disabledSkills: ToolSkillSettings.disabledSkills(),
            webSearchBackend: backend,
            webSearchKeyConfigured: WebSearchSettings.isKeyConfigured(for: backend, store: envStore),
            envConfiguredProviders: envConfigured
        )
    }

    @MainActor
    private func reload(restartSessions: Bool = false) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        // T9：同步 I/O 前缀挪到后台，主线程只拿快照赋 @State，修复「打开设置卡一下」。
        let snapshot = await Task.detached(priority: .userInitiated) {
            Self.loadReloadSnapshot()
        }.value

        credentials = snapshot.credentials
        hiddenIds = snapshot.hiddenIds
        weakIds = snapshot.weakIds
        agents = snapshot.agents
        subagentSettings = snapshot.subagentSettings
        disabledTools = snapshot.disabledTools
        disabledSkills = snapshot.disabledSkills
        webSearchBackend = snapshot.webSearchBackend
        webSearchKeyConfigured = snapshot.webSearchKeyConfigured
        envConfiguredProviders = snapshot.envConfiguredProviders
        // 输入缓冲不回显已存 key；reload 不动用户可能正在输入的值。

        if restartSessions {
            store.restartAllOpenSessions()
        }

        do {
            if !restartSessions,
               let live = store.currentSession?.availableModels, !live.isEmpty {
                models = live
            } else if !restartSessions,
                      let any = store.openSessions.values.first(where: { !$0.availableModels.isEmpty }) {
                models = any.availableModels
            } else {
                models = try await PiAuthHelper.listModels()
            }
        } catch {
            if let live = store.currentSession?.availableModels, !live.isEmpty {
                models = live
            } else {
                models = []
                if credentials.isEmpty {
                    errorMessage = error.localizedDescription
                } else {
                    statusMessage = "已读取凭据，但未能枚举模型：\(error.localizedDescription)"
                }
            }
        }
        if restartSessions {
            statusMessage = "已更新，相关会话已刷新"
        }
        // models / hiddenIds / subagentSettings 已就位，重算 picker 候选与 provider 分组缓存。
        recomputeGroupedModels()
        recomputePickerModels()
    }

    @MainActor
    private func deleteProvider(_ providerId: String, removeEnvKey: Bool = false) async {
        pendingDeleteProvider = nil
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            do {
                try await PiAuthHelper.logout(providerId: providerId)
            } catch {
                try PiAuthStore.delete(providerId: providerId)
            }
            if removeEnvKey {
                for envVar in ProviderEnvMap.envVars(forProvider: providerId) {
                    try envStore.removeSync(forKey: envVar)
                }
            }
            for m in models where m.provider == providerId {
                ModelVisibility.setHidden(false, modelId: m.id)
            }
            hiddenIds = ModelVisibility.hiddenModelIds()
            store.modelVisibilityRevision &+= 1
            await reload(restartSessions: true)
            statusMessage = removeEnvKey
                ? "已删除 \(providerId) 的凭据（含 .env 中的 key）"
                : "已删除 \(providerId) 的凭据"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Settings internals

/// 模型 tab 的 provider 分组（groupedModels @State 元素）。
private struct ProviderModelGroup: Identifiable {
    let provider: String
    let models: [ModelInfo]
    var id: String { provider }
}

/// Subagent 模型 tab 的单行。抽成独立 Equatable View 后，父视图其它状态变化
/// （statusMessage、usage 等）只按身份 diff，不再整行重建 ~30 项的 Picker 内容。
private struct SubagentModelRow: View, Equatable {
    let agent: AgentDefinition
    let pickerModels: [ModelInfo]
    let selection: String
    let thinking: String
    let onSelect: (String) -> Void
    let onSelectThinking: (String) -> Void

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.agent == rhs.agent
            && lhs.pickerModels == rhs.pickerModels
            && lhs.selection == rhs.selection
            && lhs.thinking == rhs.thinking
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                selectionLogo
                Text(agent.name)
                    .font(.subheadline.weight(.semibold))
            }
            Text(agent.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Picker(
                "模型",
                selection: Binding(get: { selection }, set: { onSelect($0) })
            ) {
                Text("跟随主 Agent").tag(SubagentModelSettings.followMainSentinel)
                ForEach(pickerModels) { model in
                    HStack(spacing: 6) {
                        ProviderLogo(model: model, size: 12)
                        Text("\(model.name)（\(model.id)）")
                    }
                    .tag(model.id)
                }
            }
            .labelsHidden()

            Picker(
                "思考强度",
                selection: Binding(get: { thinking }, set: { onSelectThinking($0) })
            ) {
                Text("默认（由模型决定）").tag(SubagentModelSettings.defaultThinkingSentinel)
                Text("关闭思考").tag("off")
                Text("极低").tag("minimal")
                Text("低").tag("low")
                Text("中").tag("medium")
                Text("高").tag("high")
                Text("极高").tag("xhigh")
                Text("最大").tag("max")
            }
            .disabled(selection.isEmpty)
            .help(selection.isEmpty ? "跟随主 Agent 时仅跟随当前底栏模型" : "仅对这个 Subagent 的新进程生效")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder
    private var selectionLogo: some View {
        if selection == SubagentModelSettings.followMainSentinel || selection.isEmpty {
            Image(systemName: "arrow.triangle.branch")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 14, height: 14)
        } else {
            ProviderLogo(modelRef: selection, size: 14)
        }
    }
}

// MARK: - Add model

struct AddModelSheet: View {
    var onFinished: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var authType: String = "api_key" // oauth | api_key
    @State private var providers: [PiAuthHelper.LoginProvider] = []
    @State private var selectedProviderId: String?
    @State private var apiKey: String = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?

    private var filteredProviders: [PiAuthHelper.LoginProvider] {
        providers.filter { $0.authTypes.contains(authType) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("添加模型")
                .font(.headline)

            Picker("认证方式", selection: $authType) {
                Text("API key").tag("api_key")
                Text("账号登录").tag("oauth")
            }
            .pickerStyle(.segmented)
            .onChange(of: authType) { _, _ in
                if let id = selectedProviderId,
                   !filteredProviders.contains(where: { $0.id == id }) {
                    selectedProviderId = filteredProviders.first?.id
                }
            }

            if providers.isEmpty && errorMessage == nil {
                ProgressView("加载 provider 列表…")
            } else {
                Picker("Provider", selection: Binding(
                    get: { selectedProviderId ?? "" },
                    set: { selectedProviderId = $0.isEmpty ? nil : $0 }
                )) {
                    ForEach(filteredProviders) { p in
                        Text(p.name).tag(p.id)
                    }
                }

                if authType == "api_key" {
                    SecureField("API key", text: $apiKey)
                        .textFieldStyle(.roundedBorder)
                    if let pid = selectedProviderId {
                        if let envVar = ProviderEnvMap.envVar(forProvider: pid) {
                            Text("将写入 ~/.pi/agent/.env（\(envVar)），并清除 auth.json 中该 provider 的旧 api_key 条目；不回显已存 key。")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("该 provider 未收录于内置键名表，请手动编辑 ~/.pi/agent/.env。")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                } else {
                    Text("将打开浏览器完成授权（与 pi /login 相同）。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(isWorking)
                Button(authType == "oauth" ? "登录" : "保存") {
                    Task { await submit() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isWorking || selectedProviderId == nil
                          || (authType == "api_key" && apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                          || (authType == "api_key" && ProviderEnvMap.envVar(forProvider: selectedProviderId ?? "") == nil))
            }
        }
        .padding(20)
        .frame(width: 420)
        .task { await loadProviders() }
    }

    @MainActor
    private func loadProviders() async {
        errorMessage = nil
        do {
            providers = try await PiAuthHelper.listProviders()
            selectedProviderId = filteredProviders.first?.id
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func submit() async {
        guard let providerId = selectedProviderId else { return }
        isWorking = true
        errorMessage = nil
        statusMessage = authType == "oauth" ? "等待浏览器授权…" : "保存中…"
        defer { isWorking = false }
        do {
            if authType == "api_key" {
                // T19：key 统一直写 ~/.pi/agent/.env（键名经 ProviderEnvMap 查询），
                // 并同步删除 auth.json 中该 provider 的 api_key 残留（oauth 条目不动），
                // 避免旧 key 覆盖 .env。
                guard let envVar = ProviderEnvMap.envVar(forProvider: providerId) else {
                    errorMessage = "该 provider 未收录于内置键名表，请手动编辑 ~/.pi/agent/.env。"
                    statusMessage = nil
                    return
                }
                let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
                try EnvFileStore().setSync(trimmed, forKey: envVar)
                try PiAuthStore.deleteAPIKeyEntry(providerId: providerId)
            } else {
                try await PiAuthHelper.login(providerId: providerId, authType: "oauth")
            }
            statusMessage = "已保存"
            onFinished()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }
}
