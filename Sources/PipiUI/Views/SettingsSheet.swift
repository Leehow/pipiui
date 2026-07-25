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

struct SettingsSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var tab: SettingsTab = .general
    @State private var models: [ModelInfo] = []
    @State private var credentials: [PiAuthStore.CredentialInfo] = []
    @State private var hiddenIds: Set<String> = ModelVisibility.hiddenModelIds()
    @State private var weakIds: Set<String> = ModelTierSettings.weakModelIds()
    @State private var agents: [AgentDefinition] = []
    @State private var subagentOverrides: [String: String] = SubagentModelSettings.allOverrides()
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
    @State private var envStore = EnvFileStore.shared
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var pendingDeleteProvider: String?
    @State private var showAddSheet = false
    /// T9/T-tab 减负：pickerModels 改为缓存 @State，仅在 models/hiddenIds/subagentOverrides 变化时重算。
    @State private var pickerModels: [ModelInfo] = []

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
                    Label(t.rawValue, systemImage: t.systemImage)
                        .tag(t)
                        .help(t.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
            Divider()
            ScrollView {
                Group {
                    switch tab {
                    case .general:
                        generalSection
                    case .models:
                        modelSettingsSection
                    case .usage:
                        usageSection
                    case .toolsSkills:
                        toolsSkillsSection
                    case .subagentModels:
                        subagentModelsSection
                    }
                }
                .padding(20)
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

    private var header: some View {
        HStack {
            Text("设置")
                .font(.headline)
            Spacer()
            Button("完成") { dismiss() }
                .keyboardShortcut(.defaultAction)
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

    private var modelSettingsSection: some View {
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
                ForEach(groupedProviders, id: \.self) { provider in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(provider)
                                .font(.subheadline.weight(.semibold))
                            if let cred = credentials.first(where: { $0.providerId == provider }) {
                                Text(cred.type == "oauth" ? "账号" : "API key")
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Color.primary.opacity(0.08)))
                            }
                            Spacer()
                            Button(role: .destructive) {
                                pendingDeleteProvider = provider
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("删除该 provider 凭据")
                        }
                        // T19 冲突警告：.env 与 auth.json(api_key) 同时存在时，
                        // auth.json 的旧 key 会覆盖 .env，提供一键清理。
                        if let cred = credentials.first(where: { $0.providerId == provider }),
                           cred.type == "api_key",
                           envConfiguredProviders.contains(provider) {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                Text("auth.json 残留旧 key 将覆盖 .env")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                                Spacer()
                                Button("清理") {
                                    Task { await cleanupStaleAuthKey(provider) }
                                }
                                .font(.caption)
                            }
                        }
                        ForEach(models.filter { $0.provider == provider }) { model in
                            HStack(spacing: 8) {
                                Toggle(isOn: visibilityBinding(for: model.id)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(model.name)
                                            .font(.callout)
                                        Text(model.id)
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
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
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
                }
            }
        }
    }

    // MARK: - Usage

    private var usageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
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

            Text("Tokens = input + output + cacheWrite（不含 cacheRead）；Cost 为 ledger 记录费用之和，数据来自 TokenLedger（近似归因，非精确计费）。")
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
                    Text(groupBy.label).tag(groupBy)
                }
            }
            .pickerStyle(.segmented)

            usageTotalsBar

            Divider()

            if usageLoading && usageReport.rows.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 24)
            } else if usageReport.rows.isEmpty {
                Text("暂无用量记录。发送消息或派出 subagent 后会出现在这里。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
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
        HStack(spacing: 20) {
            usageTotalItem(label: "Calls", value: "\(usageReport.total.calls)")
            usageTotalItem(label: "Tokens", value: TokenFormat.compact(usageReport.total.tokens))
            usageTotalItem(label: "Cost", value: usageCostText(usageReport.total.cost))
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    private func usageTotalItem(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.callout.weight(.semibold))
        }
    }

    private func usageRowView(_ row: TokenUsageStats.Row) -> some View {
        let isExpanded = usageExpanded.contains(row.key)
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                if isExpanded {
                    usageExpanded.remove(row.key)
                } else {
                    usageExpanded.insert(row.key)
                }
            } label: {
                HStack {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 12)
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
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                usageDetailView(row.metrics)
                    .padding(.leading, 20)
                if !row.children.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(row.children) { child in
                            usageChildRowView(child)
                        }
                    }
                    .padding(.leading, 20)
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(isExpanded ? 0.04 : 0)))
    }

    private func usageDetailView(_ metrics: TokenUsageStats.Metrics) -> some View {
        let denom = metrics.input + metrics.cacheRead + metrics.cacheWrite
        let hitRate = denom > 0 ? Double(metrics.cacheRead) / Double(denom) : 0
        return Text(
            "↑In \(TokenFormat.compact(metrics.input))  ↓Out \(TokenFormat.compact(metrics.output))"
            + "  CacheR \(TokenFormat.compact(metrics.cacheRead))  CacheW \(TokenFormat.compact(metrics.cacheWrite))"
            + "  命中 \(Int((hitRate * 100).rounded()))%"
        )
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    private func usageChildRowView(_ row: TokenUsageStats.Row) -> some View {
        HStack {
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

    private func usageCostText(_ cost: Double) -> String {
        if cost <= 0 { return "$0" }
        if cost < 0.01 { return String(format: "$%.4f", cost) }
        return String(format: "$%.2f", cost)
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
        VStack(alignment: .leading, spacing: 16) {
            Text("工具与 Skills")
                .font(.title3.weight(.semibold))
            Text("开关关闭后：工具通过 `--exclude-tools` 在会话重启后对 pi 生效；Skills 立即从斜杠菜单隐藏（下次派出 subagent 也会尊重工具禁用）。")
                .font(.caption)
                .foregroundStyle(.secondary)

            catalogGroup(title: "内置工具", entries: ToolSkillCatalog.builtinTools)
            catalogGroup(title: "扩展工具", entries: ToolSkillCatalog.extensionTools)

            VStack(alignment: .leading, spacing: 8) {
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
        VStack(alignment: .leading, spacing: 8) {
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
            Text("默认「跟随主 Agent」= 输入框下方 / 底栏当前选中的模型；也可为 explore / plan / general-purpose 等类型指定固定模型。下次派出即生效。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let main = store.currentSession?.model {
                Text("当前主 Agent（底栏）：\(main.name)（\(main.id)）")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("当前无打开会话；「跟随」将在派出时使用当时底栏选中的模型。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(agents) { agent in
                VStack(alignment: .leading, spacing: 6) {
                    Text(agent.name)
                        .font(.subheadline.weight(.semibold))
                    Text(agent.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Picker(
                        "模型",
                        selection: subagentModelBinding(for: agent.name)
                    ) {
                        Text("跟随主 Agent").tag(SubagentModelSettings.followMainSentinel)
                        ForEach(pickerModels) { model in
                            Text("\(model.name)（\(model.id)）").tag(model.id)
                        }
                    }
                    .labelsHidden()
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
            }
        }
    }

    /// Subagent picker 候选模型的重算（原 pickerModels 计算属性每次 body 求值都
    /// 全量 hiddenModelIds()+filter，切 tab 会卡）。调用时机：reload 完成、
    /// 可见性勾选变化、subagent override 变化。
    private func recomputePickerModels() {
        let selectedIds = Set(subagentOverrides.values.filter { !$0.isEmpty })
        pickerModels = models.filter { model in
            if selectedIds.contains(model.id) { return true }
            return !hiddenIds.contains(model.id)
        }
    }

    private func subagentModelBinding(for agentName: String) -> Binding<String> {
        Binding(
            get: { subagentOverrides[agentName] ?? SubagentModelSettings.followMainSentinel },
            set: { newValue in
                let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                SubagentModelSettings.setModelOverride(
                    trimmed.isEmpty ? nil : trimmed,
                    for: agentName
                )
                subagentOverrides = SubagentModelSettings.allOverrides()
                recomputePickerModels()
                statusMessage = "已保存 \(agentName) 的模型设置"
            }
        )
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

    private var groupedProviders: [String] {
        var seen: Set<String> = []
        var result: [String] = []
        for m in models where !seen.contains(m.provider) {
            seen.insert(m.provider)
            result.append(m.provider)
        }
        return result
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
    struct ReloadSnapshot {
        var credentials: [PiAuthStore.CredentialInfo]
        var hiddenIds: Set<String>
        var weakIds: Set<String>
        var agents: [AgentDefinition]
        var subagentOverrides: [String: String]
        var disabledTools: Set<String>
        var disabledSkills: Set<String>
        var webSearchBackend: String
        var webSearchKeyConfigured: Bool
        var envConfiguredProviders: Set<String>
    }

    /// 磁盘 I/O 集中在后台：auth.json、agents 目录（已有进程级缓存）、UserDefaults、.env 读取。
    nonisolated static func loadReloadSnapshot() -> ReloadSnapshot {
        let backend = WebSearchSettings.backend()
        let envStore = EnvFileStore.shared
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
            subagentOverrides: SubagentModelSettings.allOverrides(),
            disabledTools: ToolSkillSettings.disabledTools(),
            disabledSkills: ToolSkillSettings.disabledSkills(),
            webSearchBackend: backend,
            webSearchKeyConfigured: WebSearchSettings.isKeyConfigured(for: backend, store: envStore),
            envConfiguredProviders: envConfigured
        )
    }

    @MainActor
    private func reload(restartSessions: Bool = false) async {
        errorMessage = nil
        // 启动预热的缓存先行同步渲染：有缓存时打开设置不闪 spinner、不等子进程。
        let cache = SettingsDataStore.shared
        if let cachedSnapshot = cache.snapshot {
            apply(snapshot: cachedSnapshot)
            if let cachedModels = cache.models { models = cachedModels }
        }
        isLoading = cache.snapshot == nil
        defer { isLoading = false }

        // T9：同步 I/O 前缀挪到后台，主线程只拿快照赋 @State，修复「打开设置卡一下」。
        let snapshot = await Task.detached(priority: .userInitiated) {
            Self.loadReloadSnapshot()
        }.value

        apply(snapshot: snapshot)
        cache.update(snapshot: snapshot)
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
            } else if !restartSessions, let cached = cache.models {
                // 无打开会话：先用预热缓存，避免每次打开都跑 list-models 子进程。
                models = cached
                Task.detached(priority: .utility) {
                    if let fresh = try? await PiAuthHelper.listModels() {
                        SettingsDataStore.shared.update(models: fresh)
                        await MainActor.run { [fresh] in
                            if !restartSessions { models = fresh }
                        }
                    }
                }
            } else {
                let fresh = try await PiAuthHelper.listModels()
                models = fresh
                cache.update(models: fresh)
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
        // models / hiddenIds / subagentOverrides 已就位，重算 picker 候选缓存。
        recomputePickerModels()
    }

    /// 把快照字段落到 @State（缓存预渲染与后台刷新共用）。
    private func apply(snapshot: ReloadSnapshot) {
        credentials = snapshot.credentials
        hiddenIds = snapshot.hiddenIds
        weakIds = snapshot.weakIds
        agents = snapshot.agents
        subagentOverrides = snapshot.subagentOverrides
        disabledTools = snapshot.disabledTools
        disabledSkills = snapshot.disabledSkills
        webSearchBackend = snapshot.webSearchBackend
        webSearchKeyConfigured = snapshot.webSearchKeyConfigured
        envConfiguredProviders = snapshot.envConfiguredProviders
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

    /// 有预热缓存时直接渲染 provider 列表（ProgressView 只在冷启动第一次出现）。
    init(onFinished: @escaping () -> Void) {
        self.onFinished = onFinished
        let cached = SettingsDataStore.shared.providers ?? []
        _providers = State(initialValue: cached)
        _selectedProviderId = State(initialValue: cached.first { $0.authTypes.contains("api_key") }?.id)
    }

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
            let fresh = try await PiAuthHelper.listProviders()
            providers = fresh
            SettingsDataStore.shared.update(providers: fresh)
            if selectedProviderId == nil || !fresh.contains(where: { $0.id == selectedProviderId }) {
                selectedProviderId = filteredProviders.first?.id
            }
        } catch {
            // 缓存已在渲染时可用；仅无缓存时才展示错误。
            if providers.isEmpty { errorMessage = error.localizedDescription }
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
                try EnvFileStore.shared.setSync(trimmed, forKey: envVar)
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
