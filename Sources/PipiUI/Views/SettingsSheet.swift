import SwiftUI
import AppKit

enum SettingsTab: String, CaseIterable, Identifiable {
    case general = "通用"
    case builtIn = "内置"
    case models = "模型"
    case usage = "用量"
    case toolsSkills = "工具/mcp"
    case subagentModels = "Subagent"
    case experimental = "实验"
    var id: String { rawValue }

    /// Full name for VoiceOver / tooltip; the segmented picker shows the short
    /// `rawValue` so the compact tabs fit the 640pt sheet without truncation.
    var accessibilityName: String {
        switch self {
        case .toolsSkills: return "工具与 Skills"
        case .subagentModels: return "Subagent 模型"
        default: return rawValue
        }
    }

    var systemImage: String {
        switch self {
        case .general: return "slider.horizontal.3"
        case .builtIn: return "shippingbox"
        case .models: return "cpu"
        case .usage: return "chart.bar.fill"
        case .toolsSkills: return "wrench.and.screwdriver"
        case .subagentModels: return "person.2"
        case .experimental: return "flask"
        }
    }
}

struct SettingsSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var tab: SettingsTab
    @State private var models: [ModelInfo] = []
    @State private var credentials: [PiAuthStore.CredentialInfo] = []
    @State private var hiddenIds: Set<String> = ModelVisibility.hiddenModelIds()
    @State private var agents: [AgentDefinition] = []
    @State private var subagentSettings: [String: SubagentModelSettings.Override] = SubagentModelSettings.allSettings()
    @State private var disabledTools: Set<String> = ToolSkillSettings.disabledTools()
    @State private var disabledSkills: Set<String> = ToolSkillSettings.disabledSkills()
    /// Master on/off snapshot for the「内置」tab. Missing = enabled; mirrors
    /// `BuiltInFeatureSettings` defaults so first launch shows everything on.
    @State private var builtInDisabled: Set<String> = BuiltInFeatureSettings.disabledIDs()
    @State private var webSearchBackend: String = WebSearchSettings.backend()
    /// User-added MCP servers (canonical store read at open).
    @State private var mcpServers: [McpServer] = McpServerSettings.servers()
    @State private var editingMcpServer: McpServer?
    @State private var showMcpEditor = false
    @State private var mcpTestResult: String?
    @State private var mcpTestInProgress = false
    /// 图片转文字（非多模态模型看图）
    @State private var visionFallbackSelection: String = VisionFallback.unifiedSelection(for: VisionFallbackSettings.load())
    @State private var visionFallbackBaseURL: String = VisionFallbackSettings.load().baseURL
    @State private var visionFallbackApiKey: String = ""
    /// 实验 tab: jcode 已配置 provider 探测结果 + 探测中状态 + 启用确认弹窗。
    @State private var jcodeConfiguredProviders: [String] = []
    @State private var jcodeProbing = false
    @State private var showJcodeEnableConfirm = false
    @State private var visionFallbackModelId: String = VisionFallbackSettings.load().modelId
    @State private var visionFallbackMaxTokens: String = String(VisionFallbackSettings.load().maxTokens)
    @State private var visionFallbackKeyConfigured = !(VisionFallbackSettings.load().apiKey.isEmpty)
    /// 云端视觉模型来源（手填 / 已配置模型）+ 选中的模型 id + 解析提示。
    @State private var visionFallbackCloudSource: VisionFallbackSettings.CloudSource = VisionFallbackSettings.load().cloudSource
    @State private var visionFallbackCloudModelRef: String = VisionFallbackSettings.load().cloudModelRef
    @State private var visionFallbackCloudModelError: String?
    /// 显示价格单位（USD 内部记账，仅影响展示）+ 汇率刷新状态。
    @State private var priceUnit: PriceUnit = PricingSettings.unit()
    @State private var fxRefreshing = false
    @State private var fxMessage: String?
    @State private var fxError: String?
    /// 任务提醒开关（通用 → 提醒；缺省开启）。
    @State private var notifyCompletionEnabled = TaskNotifierSettings.completionEnabled()
    @State private var notifyErrorEnabled = TaskNotifierSettings.errorEnabled()
    /// .env 中已配置 key 的 provider 集合（用于 auth.json 残留冲突警告）。
    @State private var envConfiguredProviders: Set<String> = []
    /// .env 存取（placeholder 查询、清除、删除凭据时可选的同步移除）。
    @State private var envStore = EnvFileStore()
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var verifyAlertMessage: String?
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
    /// reloadUsage 时的显示单位快照（决定聚合 costMode 与金额格式化）。
    @State private var usageUnit: PriceUnit = PricingSettings.unit()

    init(initialTab: SettingsTab = .general) {
        _tab = State(initialValue: initialTab)
    }

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
                        .help(t.accessibilityName)
                        .accessibilityLabel(t.accessibilityName)
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
        // Click on the dimmed parent / overlay area dismisses the sheet, in
        // addition to「完成」 and Esc. Attached here so both presentation sites
        // (SidebarView, ComputerConsentBar) get it for free.
        .dismissOnOutsideClick { dismiss() }
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
                Task { await verifyAfterSave() }
            }
            .environmentObject(store)
            // Key-window check in OverlayDismiss keeps this nested sheet safe:
            // while Add Model is key, a click outside closes only it, never the
            // parent SettingsSheet.
            .dismissOnOutsideClick { showAddSheet = false }
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
        .alert(
            "验证未通过",
            isPresented: Binding(
                get: { verifyAlertMessage != nil },
                set: { if !$0 { verifyAlertMessage = nil } }
            )
        ) {
            Button("知道了", role: .cancel) { verifyAlertMessage = nil }
        } message: {
            Text(verifyAlertMessage ?? "")
        }
    }

    @ViewBuilder
    private var activeNonModelSection: some View {
        switch tab {
        case .general:
            generalSection
        case .builtIn:
            builtInSection
        case .usage:
            usageSection
        case .toolsSkills:
            toolsSkillsSection
        case .subagentModels:
            subagentModelsSection
        case .experimental:
            experimentalSection
        case .models:
            EmptyView()
        }
    }

    // MARK: - Experimental (jcode)

    private var experimentalSection: some View {
        GroupBox("jcode 引擎（实验性）") {
            VStack(alignment: .leading, spacing: 12) {
                let jcodeInstalled = JcodeBridge.findJcodeExecutable() != nil

                Toggle("启用 jcode 模式", isOn: Binding(
                    get: { JcodeSettings.isEnabled },
                    set: { newValue in
                        if newValue { showJcodeEnableConfirm = true }
                        else { JcodeSettings.isEnabled = false }
                    }
                ))
                .disabled(!jcodeInstalled)

                Text("勾选后，新建会话将使用 jcode 引擎（独立凭证体系，需先在下方配置）。jcode 自带 swarm 编排。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !jcodeInstalled {
                    Label("未检测到 jcode，请先安装：curl -fsSL https://jcode.sh/install | bash", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                Divider()

                Text("凭证配置").font(.headline)
                Text("jcode 使用独立的凭证体系，不与 pi 共享。点击下方按钮在终端完成 provider 登录。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Button("在终端配置 jcode 凭证…") {
                    JcodeLoginLauncher.openLoginInTerminal()
                }

                HStack {
                    if jcodeProbing {
                        ProgressView().controlSize(.mini)
                        Text("正在检测…").font(.caption).foregroundStyle(.secondary)
                    } else if jcodeConfiguredProviders.isEmpty {
                        Label("未检测到已配置的 provider", systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                    } else {
                        Label("检测到 \(jcodeConfiguredProviders.count) 个 provider：\(jcodeConfiguredProviders.joined(separator: ", "))", systemImage: "checkmark.circle")
                            .font(.caption).foregroundStyle(.green)
                    }
                    Spacer()
                    Button("刷新") { refreshJcodeProviders() }
                        .buttonStyle(.borderless)
                        .font(.caption)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { refreshJcodeProviders() }
        .confirmationDialog(
            "切换到 jcode 模式？",
            isPresented: $showJcodeEnableConfirm
        ) {
            Button("切换到 jcode") { JcodeSettings.isEnabled = true }
            Button("取消", role: .cancel) {}
        } message: {
            Text("之后新建的会话将使用 jcode 引擎。jcode 使用独立凭证体系，需先配置 provider。已存在的 pi 会话不受影响。")
        }
    }

    private func refreshJcodeProviders() {
        jcodeProbing = true
        JcodeSettings.detectConfiguredProviders { ids in
            jcodeConfiguredProviders = ids
            jcodeProbing = false
        }
    }

    private var header: some View {
        HStack {
            Text("设置")
                .font(.headline)
            Spacer()
            // 回车完成 / Esc 取消：sheet 呈现时才进窗口，快捷键不再需要可见性门控。
            Button("完成") { dismiss() }
                .keyboardShortcut(.defaultAction)
            // 隐藏的 Esc cancel action：与「完成」共享同一 dismiss，保证 Esc 始终关闭面板。
            Button("") { dismiss() }
                .keyboardShortcut(.cancelAction)
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
                PhilosophySection(store: store)
            }
            Divider()
            visionFallbackSection
            Divider()
            notificationSection
            Divider()
            priceSection
        }
    }

    // MARK: - 任务提醒

    private var notificationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("提醒")
                .font(.title3.weight(.semibold))
            Text("任务完成或出错时提醒你（打包运行时走系统通知；开发运行时用应用内横幅 + 提示音）。任务完成提醒只在你看不到结果（会话未选中或应用不在前台）时弹出。")
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Toggle(
                    "任务完成时提醒",
                    isOn: Binding(
                        get: { notifyCompletionEnabled },
                        set: { newValue in
                            notifyCompletionEnabled = newValue
                            TaskNotifierSettings.setCompletionEnabled(newValue)
                        }
                    )
                )
                Toggle(
                    "任务出错时提醒",
                    isOn: Binding(
                        get: { notifyErrorEnabled },
                        set: { newValue in
                            notifyErrorEnabled = newValue
                            TaskNotifierSettings.setErrorEnabled(newValue)
                        }
                    )
                )
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
        }
    }

    // MARK: - Price display unit + FX rate

    private var priceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("显示价格单位")
                .font(.title3.weight(.semibold))
            Text("pi 内部始终以 USD 记账；这里只决定花费的显示单位。切换后输入栏余额弹窗、上下文弹窗的「累计花费」以及「用量」页汇总统一按所选单位显示。")
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Picker("单位", selection: $priceUnit) {
                    Text("美金").tag(PriceUnit.usd)
                    Text("人民币").tag(PriceUnit.cny)
                }
                .pickerStyle(.segmented)
                .onChange(of: priceUnit) { _, newValue in
                    PricingSettings.setUnit(newValue)
                    statusMessage = "显示价格单位已切换为\(newValue.label)"
                }

                HStack(spacing: 8) {
                    Text("1 USD ≈ ¥\(String(format: "%.2f", ModelPricing.Catalog.shared.exchangeRate))")
                        .font(.callout.monospacedDigit())
                    Spacer()
                    Button {
                        refreshExchangeRate()
                    } label: {
                        if fxRefreshing {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Label("刷新汇率", systemImage: "arrow.clockwise")
                        }
                    }
                    .disabled(fxRefreshing)
                }

                if let fetchedAt = FXRateStore.fetchedAt() {
                    let stale = Date().timeIntervalSince(fetchedAt) > 48 * 3600
                    Text("更新于 \(Self.rateDateFmt.string(from: fetchedAt))\(stale ? " · 可能已过期" : "")")
                        .font(.caption2)
                        .foregroundStyle(stale ? Color.orange : Color.secondary)
                } else {
                    Text("尚未获取过汇率，当前使用默认值 \(String(format: "%.2f", ModelPricing.defaultUsdToCny))。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let fxMessage {
                    Text(fxMessage)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let fxError {
                    Text(fxError)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

            Text("汇率数据来自 \(FXRateStore.source() ?? "Exchange Rate API")（每日更新；失败时保留上次汇率）。")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func refreshExchangeRate() {
        guard !fxRefreshing else { return }
        fxRefreshing = true
        fxMessage = nil
        fxError = nil
        Task {
            // Single-writer refresh: fetch → persist (FXRateStore) → memory (Catalog).
            let rate = await ModelPricing.Catalog.shared.refreshExchangeRateFromWeb()
            await MainActor.run {
                fxRefreshing = false
                if let rate {
                    fxMessage = "已更新汇率 \(String(format: "%.4f", rate))"
                } else {
                    fxError = "获取汇率失败，请稍后重试（保留上次汇率）"
                }
            }
        }
    }

    private static let rateDateFmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        return f
    }()

    // MARK: - Built-in features (master controls)

    private var builtInSection: some View {
        LazyVStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("内置")
                    .font(.title3.weight(.semibold))
                Text("PipiUI 自带的扩展 / agents / 提示层 / Computer Use。每项默认开启；关闭后重启会话生效。「通用」「工具」里仍可做细粒度配置，但这里是总开关。全部关闭后新建/重启的会话等价于裸 pi（仅保留模型凭据、RPC、历史与 UI）。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(BuiltInFeatureSettings.Section.allCases, id: \.rawValue) { section in
                builtInGroup(section)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("桌面控制与远程连接")
                    .font(.subheadline.weight(.semibold))
                Toggle(isOn: Binding(
                    get: { store.computerUseEnabled },
                    set: { store.setComputerUseEnabled($0) }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Computer Use（桌面控制）")
                            .font(.callout)
                        Text("桌面控制开关；详细设置见左下角 Computer Use 图标")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .padding(.vertical, 2)
                Toggle(isOn: Binding(
                    get: { store.remoteRelayConfiguration.enabled },
                    set: { store.setRemoteRelayEnabled($0) }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("远程链接（服务器隧道）")
                            .font(.callout)
                        Text("通过服务器隧道从手机/浏览器远程连接 Mac；详细设置见左下角二维码图标")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .padding(.vertical, 2)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

            if BuiltInFeatureSettings.EnabledSet(disabled: builtInDisabled).allDisabled {
                Label("全部已关闭：新建/重启会话将不挂载任何 PipiUI 自有能力。", systemImage: "moon.zzz")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private func builtInGroup(_ section: BuiltInFeatureSettings.Section) -> some View {
        let entries = BuiltInFeatureSettings.catalog.filter { $0.section == section }
        return VStack(alignment: .leading, spacing: 8) {
            Text(section.rawValue)
                .font(.subheadline.weight(.semibold))
            ForEach(entries) { entry in
                Toggle(isOn: builtInBinding(entry)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title)
                            .font(.callout)
                        Text(entry.summary)
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

    private func builtInBinding(_ entry: BuiltInFeatureSettings.Entry) -> Binding<Bool> {
        Binding(
            get: { !builtInDisabled.contains(entry.id.rawValue) },
            set: { enabled in setBuiltInFeature(enabled, id: entry.id) }
        )
    }

    /// Master toggle for one built-in capability. Philosophy is special-cased so
    /// the pi package registration / auto-register / config stay in sync.
    private func setBuiltInFeature(_ enabled: Bool, id: BuiltInFeatureSettings.FeatureID) {
        guard id != .philosophy else {
            setBuiltInPhilosophy(enabled)
            return
        }
        store.setBuiltInFeatureEnabled(enabled, id: id)
        errorMessage = nil
        if id == .computerUse {
            // Hot-swappable: no session restart. Existing sessions are rejected
            // by the host guard immediately; new spawns follow the switch.
            statusMessage = enabled
                ? "已启用 Computer Use 能力：新会话将挂载桌面控制，已挂载的会话立即恢复可用。"
                : "已关闭 Computer Use 能力：进行中的桌面操作已取消，新的桌面调用会被拒绝（不重启会话）。"
        } else {
            statusMessage = enabled
                ? "已启用内置能力「\(title(for: id))」（将重启会话）"
                : "已关闭内置能力「\(title(for: id))」（将重启会话）"
        }
        builtInDisabled = BuiltInFeatureSettings.disabledIDs()
    }

    /// Philosophy is transactional because settings.json mutation can fail.
    /// Register/unregister completes first; only success commits the master,
    /// config, auto-register state and restarts sessions. Failure leaves the
    /// checkbox and actual package state unchanged.
    private func setBuiltInPhilosophy(_ enabled: Bool) {
        statusMessage = nil
        errorMessage = nil
        do {
            try BuiltInPhilosophyTransition.apply(enabled: enabled)
            builtInDisabled = BuiltInFeatureSettings.disabledIDs()
            statusMessage = enabled
                ? "已启用工作哲学并装回 pi（将重启会话）"
                : "已关闭工作哲学：已从 pi 移除并跳过 fallback 注入（将重启会话）"
            store.philosophyRevision &+= 1
            store.restartAllOpenSessions()
        } catch {
            // Refresh from persisted truth: the transaction committed nothing.
            builtInDisabled = BuiltInFeatureSettings.disabledIDs()
            statusMessage = "工作哲学未更改。"
            errorMessage = error.localizedDescription
        }
    }

    private func title(for id: BuiltInFeatureSettings.FeatureID) -> String {
        BuiltInFeatureSettings.catalog.first(where: { $0.id == id })?.title ?? id.rawValue
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
                    Task { await refreshWithDiscovery() }
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                .disabled(isLoading)
                .help("检测 provider 在线模型目录、合并新模型,并重读 models.json 刷新会话")
                Button {
                    showAddSheet = true
                } label: {
                    Label("添加模型", systemImage: "plus")
                }
                .disabled(isLoading)
            }

            Text("左侧勾选控制底栏模型菜单是否显示；删除会移除该 provider 的 Pi 凭据。")
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

            Text(usageHelpText)
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
            usageTotalItem(
                icon: usageUnit == .usd ? "dollarsign.circle" : "yensign.circle",
                label: "Cost",
                value: usageCostText(usageReport.total.cost)
            )
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
        case "computer": return "desktopcomputer"
        case "git_status", "git_diff": return "arrow.triangle.branch"
        default: return "hammer"
        }
    }

    /// 用量页说明：USD 单位 = pi 账本实耗；CNY 单位 = 牌价重算估计（原说明）。
    private var usageHelpText: String {
        if PricingSettings.unit() == .usd {
            return "Tokens = input + output + cacheWrite（不含 cacheRead）。Cost 为 pi 账本（get_session_stats）上报的美元实耗，非按牌价重算；订阅套餐模型按实际上报值计。"
        }
        return "Tokens = input + output + cacheWrite（不含 cacheRead）。Cost 按官网/API 牌价从 token 重算为人民币（含缓存与 >200k/272k 长上下文档）；美元牌价按约 \(String(format: "%.2f", ModelPricing.Catalog.shared.exchangeRate)) 汇率换算。订阅套餐模型按对应 API 牌价估算等价花费，非账单实扣。"
    }

    private func usageCostText(_ cost: Double) -> String {
        switch usageUnit {
        case .usd: return formatUSD(cost)
        case .cny: return ModelPricing.formatCNY(cost)
        }
    }

    private func reloadUsage() {
        usageRequestID += 1
        let requestID = usageRequestID
        usageLoading = true
        let period = usagePeriod
        let groupBy = usageGroupBy
        // USD 显示单位 → 账本实耗；CNY → 牌价重算估计（原行为）。
        let unit = PricingSettings.unit()
        let costMode: TokenUsageStats.CostMode = unit == .usd ? .ledger : .estimateCNY
        Task.detached(priority: .utility) {
            let records = TokenUsageStats.loadSharedRecords()
            let report = TokenUsageStats.aggregate(
                records: records,
                period: period,
                groupBy: groupBy,
                costMode: costMode
            )
            await MainActor.run {
                guard requestID == usageRequestID else { return }
                usageUnit = unit
                usageReport = report
                usageLoading = false
            }
        }
    }

    // MARK: - Tools & Skills

    private var toolsSkillsSection: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            Text("工具 / MCP")
                .font(.title3.weight(.semibold))
            Text("普通工具关闭后通过 `--exclude-tools` 在会话重启后生效。Skills 会立即从斜杠菜单隐藏。")
                .font(.caption)
                .foregroundStyle(.secondary)

            catalogGroup(title: "内置工具", entries: ToolSkillCatalog.builtinTools)
            catalogGroup(title: "扩展工具", entries: ToolSkillCatalog.extensionTools)

            Divider()
            mcpSection

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
            ForEach(entries.filter { $0.name != "computer" }) { tool in
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
            Text("默认「跟随主 Agent」= 输入框下方 / 底栏当前选中的模型；也可为 explore / plan / general-purpose 等类型指定固定模型和思考强度，并用「添加备用模型」追加有序 fallback 链（链首为主选，其余按顺序备用）。未指定思考强度时使用 Pi / 模型默认值；下次派出即生效。")
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
                    entries: subagentSettings[agent.name]?.entries ?? [],
                    onSelectModel: { index, newValue in
                        setSubagentModelOverride(newValue, at: index, for: agent.name)
                    },
                    onSelectThinking: { index, newValue in
                        setSubagentThinkingOverride(newValue, at: index, for: agent.name)
                    },
                    onRemoveEntry: { index in
                        removeSubagentModelEntry(at: index, for: agent.name)
                    },
                    onAddEntry: {
                        addSubagentModelEntry(for: agent.name)
                    }
                )
            }
        }
    }

    /// Subagent picker 候选模型的重算（原 pickerModels 计算属性每次 body 求值都
    /// 全量 hiddenModelIds()+filter，切 tab 会卡）。调用时机：reload 完成、
    /// 可见性勾选变化、subagent override 变化。
    private func recomputePickerModels() {
        // Chain-aware: every model referenced anywhere in any agent's chain must stay
        // selectable in the pickers, not only each agent's primary.
        let selectedIds = Set(subagentSettings.values.flatMap { $0.entries.map(\.model) })
        pickerModels = models.filter { model in
            if selectedIds.contains(model.id) { return true }
            return !hiddenIds.contains(model.id)
        }
    }

    private func capability(
        forModelId modelId: String
    ) -> (reasoning: Bool?, thinkingLevelMap: [String: String?]?) {
        guard let model = models.first(where: { $0.id == modelId }) else {
            return (nil, nil)
        }
        return (model.reasoning, model.thinkingLevelMap)
    }

    private func subagentEntries(for agentName: String) -> [SubagentModelSettings.Entry] {
        subagentSettings[agentName]?.entries ?? []
    }

    private func setSubagentModelOverride(_ newValue: String, at index: Int, for agentName: String) {
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        var entries = subagentEntries(for: agentName)
        if trimmed.isEmpty {
            // followMainSentinel: only the chain head can follow main, and a following head
            // cannot be persisted — selecting it clears the whole override (all backups too).
            guard index == 0 else { return }
            SubagentModelSettings.setChain([], for: agentName)
            subagentSettings = SubagentModelSettings.allSettings()
            recomputePickerModels()
            statusMessage = "已恢复 \(agentName) 跟随主 Agent"
            return
        }
        if entries.isEmpty {
            entries = [SubagentModelSettings.Entry(model: "", thinking: nil)]
        }
        guard index >= 0, index < entries.count else { return }
        let cap = capability(forModelId: trimmed)
        let resolution = ThinkingCapability.resolveSelection(
            newModelId: trimmed,
            persistedThinking: entries[index].thinking,
            reasoning: cap.reasoning,
            thinkingLevelMap: cap.thinkingLevelMap
        )
        entries[index] = SubagentModelSettings.Entry(
            model: resolution.modelId ?? trimmed,
            thinking: resolution.thinking
        )
        SubagentModelSettings.setChain(entries, for: agentName)
        subagentSettings = SubagentModelSettings.allSettings()
        recomputePickerModels()
        statusMessage = resolution.didReset
            ? "已重置 \(agentName) 的思考强度（\(trimmed) 不支持该档位）"
            : "已保存 \(agentName) 的模型设置"
    }

    /// Silent and idempotent migration of persisted choices using known model metadata only.
    private func normalizeSubagentThinkingIfNeeded() {
        var changed = false
        for (agent, override) in subagentSettings {
            var entries = override.entries
            var didReset = false
            for (index, entry) in entries.enumerated() {
                let cap = capability(forModelId: entry.model)
                guard ThinkingCapability.normalizationDecision(
                    modelId: entry.model,
                    persistedThinking: entry.thinking,
                    reasoning: cap.reasoning,
                    thinkingLevelMap: cap.thinkingLevelMap
                ) == .reset
                else {
                    continue
                }
                entries[index] = SubagentModelSettings.Entry(model: entry.model, thinking: nil)
                didReset = true
            }
            guard didReset else { continue }
            SubagentModelSettings.setChain(entries, for: agent)
            changed = true
        }
        if changed {
            subagentSettings = SubagentModelSettings.allSettings()
        }
    }

    private func setSubagentThinkingOverride(_ newValue: String, at index: Int, for agentName: String) {
        var entries = subagentEntries(for: agentName)
        guard index >= 0, index < entries.count else { return }
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        entries[index] = SubagentModelSettings.Entry(
            model: entries[index].model,
            thinking: trimmed.isEmpty ? nil : trimmed
        )
        SubagentModelSettings.setChain(entries, for: agentName)
        subagentSettings = SubagentModelSettings.allSettings()
        statusMessage = "已保存 \(agentName) 的思考强度"
    }

    private func removeSubagentModelEntry(at index: Int, for agentName: String) {
        var entries = subagentEntries(for: agentName)
        guard entries.count > 1, index >= 0, index < entries.count else { return }
        let removed = entries.remove(at: index)
        SubagentModelSettings.setChain(entries, for: agentName)
        subagentSettings = SubagentModelSettings.allSettings()
        recomputePickerModels()
        statusMessage = "已移除 \(agentName) 的备用模型 \(removed.model)"
    }

    private func addSubagentModelEntry(for agentName: String) {
        var entries = subagentEntries(for: agentName)
        let used = Set(entries.map(\.model))
        guard let candidate = pickerModels.first(where: { !used.contains($0.id) }) ?? pickerModels.first else {
            return
        }
        entries.append(SubagentModelSettings.Entry(model: candidate.id, thinking: nil))
        SubagentModelSettings.setChain(entries, for: agentName)
        subagentSettings = SubagentModelSettings.allSettings()
        recomputePickerModels()
        statusMessage = "已为 \(agentName) 添加备用模型 \(candidate.id)"
    }

    // MARK: - MCP Servers

    private var mcpSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("MCP 服务器")
                .font(.title3.weight(.semibold))
            Text("添加你自己的 MCP 服务器（如 firecrawl-mcp / brave-mcp / 智谱 MCP），其工具会以 mcp_<服务器名>_<工具名> 暴露给 agent。环境变量用 ${VAR} 引用 ~/.pi/agent/.env 中的值。新增/删除后在下一个会话（或 /pipiui_reload）生效。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if mcpServers.isEmpty {
                Text("尚未添加任何 MCP 服务器。")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                ForEach(Array(mcpServers.enumerated()), id: \.element.id) { index, server in
                    HStack(alignment: .center, spacing: 10) {
                        Toggle("", isOn: Binding(
                            get: { mcpServers[index].enabled },
                            set: { on in
                                mcpServers[index].enabled = on
                                saveMcpServers()
                            }
                        ))
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .controlSize(.small)

                        VStack(alignment: .leading, spacing: 1) {
                            Text(server.name)
                                .font(.callout)
                                .lineLimit(1)
                            Text(mcpServerSubtitle(server))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()

                        Button("测试") {
                            testMcp(server)
                        }
                        .font(.caption)
                        .disabled(mcpTestInProgress)

                        Button("编辑") {
                            editingMcpServer = server
                            showMcpEditor = true
                        }
                        .font(.caption)

                        Button("删除") {
                            mcpServers.removeAll { $0.id == server.id }
                            saveMcpServers()
                        }
                        .font(.caption)
                        .foregroundStyle(.red)
                    }
                    .padding(.vertical, 2)
                }
            }

            Button {
                editingMcpServer = nil
                showMcpEditor = true
            } label: {
                Label("添加服务器", systemImage: "plus")
            }
            .font(.callout)

            if mcpTestInProgress {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("测试连接中…").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let result = mcpTestResult {
                Text(result)
                    .font(.caption)
                    .foregroundStyle(result.hasPrefix("❌") ? .red : .secondary)
            }
        }
        .sheet(isPresented: $showMcpEditor) {
            McpServerEditor(server: editingMcpServer) { server in
                if let i = mcpServers.firstIndex(where: { $0.id == server.name }) {
                    mcpServers[i] = server
                } else {
                    mcpServers.append(server)
                }
                saveMcpServers()
            }
        }
    }

    private func mcpServerSubtitle(_ server: McpServer) -> String {
        switch server.transport {
        case .stdio:
            let args = server.args.joined(separator: " ")
            return args.isEmpty ? "stdio: \(server.command)" : "stdio: \(server.command) \(args)"
        case .http:
            return "http: \(server.url)"
        }
    }

    private func saveMcpServers() {
        McpServerSettings.save(mcpServers)
        mcpTestResult = "已保存。新增/删除服务器后需在下一会话或 /pipiui_reload 生效。"
    }

    private func testMcp(_ server: McpServer) {
        mcpTestInProgress = true
        mcpTestResult = nil
        let variables = EnvFileStore().all()
        Task {
            let result = await McpServerSettings.testConnection(server, variables: variables)
            await MainActor.run {
                mcpTestResult = result.display
                mcpTestInProgress = false
            }
        }
    }

    // MARK: - Vision Fallback (图片转文字)

    private var visionFallbackSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("图片转文字（非多模态模型看图）")
                .font(.title3.weight(.semibold))
            Text("DeepSeek 等不支持直接看图的模型：发送带图消息时，自动把图片转成文字注入消息。直接选一个已配置的多模态模型作为图像识别模型，或仅用本地 OCR。缩略图与 RPC 图片附件保持不变。")
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Picker("图片转文字", selection: $visionFallbackSelection) {
                    ForEach(VisionFallback.visionModels(from: pickerModels)) { m in
                        Text(m.name).tag("model:\(m.id)")
                    }
                    Text("仅本地 OCR（不用云端模型）").tag("ocr")
                    Text("关闭（不转换）").tag("off")
                    Text("手动 endpoint…").tag("manual")
                }
                .onChange(of: visionFallbackSelection) { _, tag in
                    applyVisionFallbackSelection(tag)
                }

                if visionFallbackCloudModelError != nil {
                    Text(visionFallbackCloudModelError!)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }

                if visionFallbackCloudSource == .manual {
                    TextField("服务地址（OpenAI 兼容 base URL）", text: $visionFallbackBaseURL)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { saveVisionFallbackCloud() }
                    HStack(spacing: 8) {
                        SecureField(
                            visionFallbackKeyConfigured ? "已配置 API Key，输入以替换" : "API Key（可选）",
                            text: $visionFallbackApiKey
                        )
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { saveVisionFallbackCloud() }
                        if visionFallbackKeyConfigured {
                            Button("清除 Key") {
                                VisionFallbackSettings.setApiKey("")
                                visionFallbackApiKey = ""
                                visionFallbackKeyConfigured = false
                                statusMessage = "已清除图片描述 API Key"
                            }
                        }
                    }
                    TextField("模型 ID", text: $visionFallbackModelId)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { saveVisionFallbackCloud() }
                    TextField("最大 Token 数", text: $visionFallbackMaxTokens)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { saveVisionFallbackCloud() }
                    Button("保存云端设置") { saveVisionFallbackCloud() }
                    Text("base URL 形如 https://api.openai.com/v1；会自动补 /chat/completions。API Key 仅存本机 UserDefaults。云端失败（网络/超时/4xx/5xx 或凭据解析不到）自动退回仅 OCR。")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else if visionFallbackCloudSource == .configuredModel {
                    Text("已选模型会在发送带图消息时被用作图像识别模型；解析不到其 OpenAI 兼容端点/凭据时自动降级为仅 OCR。")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

            Text("默认「仅本地 OCR」零配置；当前模型若本身支持图片则不会注入。设置立即生效，无需重启会话。")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    /// 单 Picker 选中 → 写盘（复用现有 setters）+ 更新本地状态 + 触发现有解析校验。
    private func applyVisionFallbackSelection(_ tag: String) {
        let snap = VisionFallback.applyUnifiedSelection(tag, to: VisionFallbackSettings.load())
        VisionFallbackSettings.setMode(snap.mode)
        VisionFallbackSettings.setCloudSource(snap.cloudSource)
        VisionFallbackSettings.setCloudModelRef(snap.cloudModelRef)
        visionFallbackCloudSource = snap.cloudSource
        visionFallbackCloudModelRef = snap.cloudModelRef
        if tag.hasPrefix("model:") {
            verifyVisionFallbackConfiguredModel()
        } else {
            visionFallbackCloudModelError = nil
        }
    }

    private func saveVisionFallbackCloud() {
        let base = visionFallbackBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let modelId = visionFallbackModelId.trimmingCharacters(in: .whitespacesAndNewlines)
        let tokens = Int(visionFallbackMaxTokens.trimmingCharacters(in: .whitespacesAndNewlines))
            ?? VisionFallbackSettings.defaultMaxTokens
        var snap = VisionFallbackSettings.load()
        // 手填 endpoint 隐含 OCR+云端模式。
        snap.mode = .ocrAndCloud
        snap.cloudSource = .manual
        snap.baseURL = base
        snap.modelId = modelId.isEmpty ? VisionFallbackSettings.defaultModelId : modelId
        snap.maxTokens = tokens > 0 ? tokens : VisionFallbackSettings.defaultMaxTokens
        snap.cloudModelRef = ""
        let keyTrim = visionFallbackApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !keyTrim.isEmpty {
            snap.apiKey = keyTrim
            visionFallbackKeyConfigured = true
            visionFallbackApiKey = ""
        }
        VisionFallbackSettings.save(snap)
        visionFallbackBaseURL = snap.baseURL
        visionFallbackModelId = snap.modelId
        visionFallbackMaxTokens = String(snap.maxTokens)
        statusMessage = "已保存图片转文字云端设置"
    }

    /// 尝试解析选中的已配置模型为 OpenAI 兼容 endpoint；失败则显示红字提示，
    /// 运行时自动降级为仅 OCR（不 crash、不静默发错请求）。
    private func verifyVisionFallbackConfiguredModel() {
        let ref = visionFallbackCloudModelRef
        guard !ref.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            visionFallbackCloudModelError = nil
            return
        }
        visionFallbackCloudModelError = nil
        Task {
            let config = await VisionFallback.configuredModelConfig(
                modelRef: ref,
                maxTokens: VisionFallbackSettings.defaultMaxTokens
            )
            await MainActor.run {
                visionFallbackCloudModelError = config == nil
                    ? "无法解析此模型的 OpenAI 兼容地址/凭据，发送时将自动降级为仅 OCR。"
                    : nil
            }
        }
    }

    /// 显式「保存」/ 回车提交：留空 = 不修改。
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

    /// reload 的同步 I/O 前缀快照（后台线程执行，主线程只赋值）。
    /// 注意：不再调 SubagentModelSettings.syncJSONFile() / ToolSkillSettings.syncJSONFile()——
    /// 它们的 setter 在真正编辑时已各自同步；reload 无编辑场景不应重写文件。
    private struct ReloadSnapshot {
        var credentials: [PiAuthStore.CredentialInfo]
        var hiddenIds: Set<String>
        var agents: [AgentDefinition]
        var subagentSettings: [String: SubagentModelSettings.Override]
        var disabledTools: Set<String>
        var disabledSkills: Set<String>
        var builtInDisabled: Set<String>
        var webSearchBackend: String
        var envConfiguredProviders: Set<String>
        var visionFallback: VisionFallbackSettings.Snapshot
    }

    /// 磁盘 I/O 集中在后台：auth.json、agents 目录（已有进程级缓存）、UserDefaults、.env 读取。
    nonisolated private static func loadReloadSnapshot() -> ReloadSnapshot {
        let backend = WebSearchSettings.backend()
        let envStore = EnvFileStore()
        let credentials = PiAuthStore.list()
        // .env 已配置 key 的 provider：.env-only 凭据的 provider 也需要
        // 「同时从 .env 移除」选项，故遍历 ProviderEnvMap 全表（而非仅 auth.json 在列）。
        let envConfigured = Set(
            ProviderEnvMap.envVarsByProvider.keys.filter { pid in
                ProviderEnvMap.envVars(forProvider: pid).contains { envStore.isConfigured(forKey: $0) }
            }
        )
        return ReloadSnapshot(
            credentials: credentials,
            hiddenIds: ModelVisibility.hiddenModelIds(),
            agents: AgentCatalog.load(),
            subagentSettings: SubagentModelSettings.allSettings(),
            disabledTools: ToolSkillSettings.disabledTools(),
            disabledSkills: ToolSkillSettings.disabledSkills(),
            builtInDisabled: BuiltInFeatureSettings.disabledIDs(),
            webSearchBackend: backend,
            envConfiguredProviders: envConfigured,
            visionFallback: VisionFallbackSettings.load()
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
        agents = snapshot.agents
        subagentSettings = snapshot.subagentSettings
        disabledTools = snapshot.disabledTools
        disabledSkills = snapshot.disabledSkills
        builtInDisabled = snapshot.builtInDisabled
        webSearchBackend = snapshot.webSearchBackend
        envConfiguredProviders = snapshot.envConfiguredProviders
        visionFallbackSelection = VisionFallback.unifiedSelection(for: snapshot.visionFallback)
        visionFallbackBaseURL = snapshot.visionFallback.baseURL
        visionFallbackModelId = snapshot.visionFallback.modelId
        visionFallbackMaxTokens = String(snapshot.visionFallback.maxTokens)
        visionFallbackKeyConfigured = !snapshot.visionFallback.apiKey.isEmpty
        visionFallbackCloudSource = snapshot.visionFallback.cloudSource
        visionFallbackCloudModelRef = snapshot.visionFallback.cloudModelRef
        visionFallbackCloudModelError = nil
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
        normalizeSubagentThinkingIfNeeded()
    }

    /// 保存 API key 后的即时验证：重加载前用 pi runtime listModels 做轻量抽查，
    /// 确认 key 有效、端点可达。失败以 alert 提示（不阻断保存，跳过 reload）；
    /// 成功按原流程 reload 刷新会话与模型列表。内置 oauth provider 走同一条路，
    /// 认证通过即不弹出提示。
    /// 刷新按钮：先尝试检测各 provider 的在线模型目录并合并新模型（失败则静默跳过），
    /// 再按原流程 reload 重读 models.json 刷新会话；若检测到新模型，把提示拼到状态前。
    @MainActor
    private func refreshWithDiscovery() async {
        var note = ""
        if let results = (try? await PiAuthHelper.discoverModels())?["results"] as? [[String: Any]] {
            let totalAdded = results.reduce(0) { $0 + (($1["added"] as? [Any])?.count ?? 0) }
            if totalAdded > 0 {
                note = "检测到 \(totalAdded) 个新模型,"
            }
        }
        await reload(restartSessions: true)
        if !note.isEmpty {
            statusMessage = note + (statusMessage ?? "")
        }
    }

    @MainActor
    private func verifyAfterSave(restartSessions: Bool = true) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            _ = try await PiAuthHelper.listModels()
        } catch {
            verifyAlertMessage = "API key 已保存，但验证未通过：\(error.localizedDescription)\n\n可能原因：key 不正确、网络不通、或套餐/额度未生效。模型暂未刷新，可重试或重新保存 key。"
            return
        }
        await reload(restartSessions: restartSessions)
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
/// 每个 agent 渲染一条有序 fallback 链：行 0 为链首（可选「跟随主 Agent」），
/// 行 >0 为备用模型；行数 >1 时每行带删除按钮。
private struct SubagentModelRow: View, Equatable {
    let agent: AgentDefinition
    let pickerModels: [ModelInfo]
    /// Empty = no override, rendered as a single "follow main" row.
    let entries: [SubagentModelSettings.Entry]
    let onSelectModel: (Int, String) -> Void
    let onSelectThinking: (Int, String) -> Void
    let onRemoveEntry: (Int) -> Void
    let onAddEntry: () -> Void

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.agent == rhs.agent
            && lhs.pickerModels == rhs.pickerModels
            && lhs.entries == rhs.entries
    }

    /// Displayed chain rows. Empty `entries` renders one following row.
    private var displayedRows: [(model: String, thinking: String)] {
        if entries.isEmpty {
            return [(
                SubagentModelSettings.followMainSentinel,
                SubagentModelSettings.defaultThinkingSentinel
            )]
        }
        return entries.map {
            ($0.model, $0.thinking ?? SubagentModelSettings.defaultThinkingSentinel)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                selectionLogo
                Text(agent.name)
                    .font(.subheadline.weight(.semibold))
                if entries.count > 1 {
                    Text("fallback ×\(entries.count)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Text(agent.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            ForEach(Array(displayedRows.enumerated()), id: \.offset) { index, row in
                chainRow(index: index, model: row.model, thinking: row.thinking)
            }

            Button {
                onAddEntry()
            } label: {
                Label("添加备用模型", systemImage: "plus")
                    .font(.caption)
            }
            .buttonStyle(.borderless)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder
    private func chainRow(index: Int, model: String, thinking: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if index > 0 || entries.count > 1 {
                HStack(spacing: 6) {
                    Text(index == 0 ? "主选" : "备用 \(index)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    if entries.count > 1 {
                        Button {
                            onRemoveEntry(index)
                        } label: {
                            Image(systemName: "trash")
                                .font(.caption)
                        }
                        .buttonStyle(.borderless)
                        .help("从 fallback 链中移除该模型")
                    }
                }
            }
            Picker(
                "模型",
                selection: Binding(get: { model }, set: { onSelectModel(index, $0) })
            ) {
                if index == 0 {
                    Text("跟随主 Agent").tag(SubagentModelSettings.followMainSentinel)
                }
                ForEach(pickerModels) { pickerModel in
                    HStack(spacing: 6) {
                        ProviderLogo(model: pickerModel, size: 12)
                        Text("\(pickerModel.name)（\(pickerModel.id)）")
                        if ModelCapabilities.isRecommended(.worker, for: pickerModel.id) {
                            ModelRoleBadge(role: .worker)
                        }
                    }
                    .tag(pickerModel.id)
                }
            }
            .labelsHidden()

            if isNonReasoning(modelId: model) {
                Text("该模型为非推理模型，思考强度由模型决定。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Picker(
                    "思考强度",
                    selection: Binding(get: { thinking }, set: { onSelectThinking(index, $0) })
                ) {
                    ForEach(allowedThinkingTags(for: model), id: \.self) { tag in
                        Text(thinkingLabel(for: tag)).tag(tag)
                    }
                }
                .disabled(model.isEmpty || model == SubagentModelSettings.followMainSentinel)
                .help(model.isEmpty || model == SubagentModelSettings.followMainSentinel
                    ? "跟随主 Agent 时仅跟随当前底栏模型"
                    : "仅对这个 Subagent 的新进程生效")
            }
        }
    }

    private func capability(
        forModelId modelId: String
    ) -> (reasoning: Bool?, thinkingLevelMap: [String: String?]?) {
        guard let model = pickerModels.first(where: { $0.id == modelId }) else {
            return (nil, nil)
        }
        return (model.reasoning, model.thinkingLevelMap)
    }

    private func isNonReasoning(modelId: String) -> Bool {
        capability(forModelId: modelId).reasoning == .some(false)
    }

    private func allowedThinkingTags(for modelId: String) -> [String] {
        let cap = capability(forModelId: modelId)
        return ThinkingCapability.allowedLevels(
            reasoning: cap.reasoning,
            thinkingLevelMap: cap.thinkingLevelMap
        )
    }

    private func thinkingLabel(for tag: String) -> String {
        switch tag {
        case "": return "默认（由模型决定）"
        case "off": return "关闭思考"
        case "minimal": return "极低"
        case "low": return "低"
        case "medium": return "中"
        case "high": return "高"
        case "xhigh": return "极高"
        case "max": return "最大"
        default: return tag
        }
    }

    @ViewBuilder
    private var selectionLogo: some View {
        if entries.isEmpty {
            Image(systemName: "arrow.triangle.branch")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 14, height: 14)
        } else {
            ProviderLogo(modelRef: entries[0].model, size: 14)
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

/// A key/value row edited in the MCP server editor (env / headers).
private struct McpKVRow: Identifiable {
    let id = UUID()
    var key: String = ""
    var value: String = ""
    var obfuscated: Bool = false
}

/// Editor sheet for one MCP server. stdio: command + args + env; http: url + headers.
private struct McpServerEditor: View {
    @Environment(\.dismiss) private var dismiss

    let server: McpServer?
    let onSave: (McpServer) -> Void

    @State private var name: String
    @State private var transport: McpTransport
    @State private var command: String
    @State private var argsText: String
    @State private var url: String
    @State private var envRows: [McpKVRow]
    @State private var headerRows: [McpKVRow]
    @State private var errorMessage: String?
    @State private var testInProgress = false
    @State private var testResult: String?

    init(server: McpServer?, onSave: @escaping (McpServer) -> Void) {
        self.server = server
        self.onSave = onSave
        _name = State(initialValue: server?.name ?? "")
        _transport = State(initialValue: server?.transport ?? .stdio)
        _command = State(initialValue: server?.command ?? "")
        _argsText = State(initialValue: server?.args.joined(separator: " ") ?? "")
        _url = State(initialValue: server?.url ?? "")
        _envRows = State(initialValue: McpServerEditor.kvRows(server?.env ?? [:] , obfuscated: true))
        _headerRows = State(initialValue: McpServerEditor.kvRows(server?.headers ?? [:], obfuscated: true))
    }

    private static func kvRows(_ dict: [String: String], obfuscated: Bool) -> [McpKVRow] {
        dict.map { McpKVRow(key: $0.key, value: $0.value, obfuscated: obfuscated) }
    }

    private var builtServer: McpServer {
        McpServer(
            name: name,
            enabled: server?.enabled ?? true,
            transport: transport,
            command: command,
            args: McpServerEditor.splitArgs(argsText),
            env: McpServerEditor.dict(rows: envRows),
            url: url,
            headers: McpServerEditor.dict(rows: headerRows)
        )
    }

    /// Last-wins dict from rows, ignoring empty keys (duplicate keys must not crash).
    private static func dict(rows: [McpKVRow]) -> [String: String] {
        var out: [String: String] = [:]
        for row in rows where !row.key.isEmpty {
            out[row.key] = row.value
        }
        return out
    }

    private static func splitArgs(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(server == nil ? "添加 MCP 服务器" : "编辑 MCP 服务器")
                    .font(.headline)
                Spacer()
                Button("完成") { save() }
                    .keyboardShortcut(.defaultAction)
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }

            TextField("服务器名", text: $name)
                .textFieldStyle(.roundedBorder)

            Picker("传输方式", selection: $transport) {
                Text("stdio").tag(McpTransport.stdio)
                Text("http").tag(McpTransport.http)
            }
            .pickerStyle(.segmented)

            if transport == .stdio {
                TextField("command（如 npx）", text: $command)
                    .textFieldStyle(.roundedBorder)
                TextField("args（空格分隔，如 -y firecrawl-mcp）", text: $argsText)
                    .textFieldStyle(.roundedBorder)
                McpKVEditor(title: "环境变量 env（值用 ${VAR} 引用 .env）",
                            rows: $envRows, obfuscated: true)
            } else {
                TextField("url（如 https:// …/mcp）", text: $url)
                    .textFieldStyle(.roundedBorder)
                McpKVEditor(title: "请求头 headers（值用 ${VAR} 引用 .env）",
                            rows: $headerRows, obfuscated: true)
            }

            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.red)
            }

            HStack {
                Button("测试连接") {
                    testConnection()
                }
                .disabled(testInProgress)
                if testInProgress { ProgressView().controlSize(.small) }
                if let testResult {
                    Text(testResult).font(.caption)
                        .foregroundStyle(testResult.hasPrefix("❌") ? .red : .secondary)
                }
                Spacer()
            }

            Text("密钥请写在 ~/.pi/agent/.env，这里用 ${VAR} 引用；App 不代管这些 key。新增/删除服务器后需在下一会话或 /pipiui_reload 生效。")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(20)
        .frame(width: 520)
    }

    private func testConnection() {
        let candidate = builtServer
        if let err = McpServerSettings.validationError(candidate) {
            errorMessage = err
            return
        }
        errorMessage = nil
        testInProgress = true
        testResult = nil
        let variables = EnvFileStore().all()
        Task {
            let result = await McpServerSettings.testConnection(candidate, variables: variables)
            await MainActor.run {
                testResult = result.display
                testInProgress = false
            }
        }
    }

    private func save() {
        let candidate = builtServer
        if let err = McpServerSettings.validationError(candidate) {
            errorMessage = err
            return
        }
        errorMessage = nil
        onSave(candidate)
        dismiss()
    }
}

/// Editable list of key/value rows (env / headers) with add/remove.
private struct McpKVEditor: View {
    let title: String
    @Binding var rows: [McpKVRow]
    let obfuscated: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            ForEach($rows) { $row in
                HStack(spacing: 6) {
                    TextField("键", text: $row.key)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 160)
                    TextField(obfuscated ? "值（${VAR}）" : "值", text: $row.value)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        rows.removeAll { $0.id == row.id }
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.red)
                }
            }
            Button {
                rows.append(McpKVRow(obfuscated: obfuscated))
            } label: {
                Label("添加键值", systemImage: "plus")
            }
            .font(.caption)
        }
    }
}
