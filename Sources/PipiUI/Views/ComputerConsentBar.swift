import SwiftUI
import CoreGraphics

struct ComputerConsentBar: View {
    let sessionKey: String
    @ObservedObject private var coordinator = ComputerCoordinator.shared
    @State private var permissions = ComputerPermissions.snapshot()

    var body: some View {
        if ComputerUseSettings.isEnabled(), shouldShow {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: icon)
                        .foregroundStyle(tint)
                        .frame(width: 18)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.callout.weight(.semibold))
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Spacer()
                    controls
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(tint.opacity(0.10))
            .overlay(alignment: .bottom) { Divider() }
            .task {
                while !Task.isCancelled {
                    permissions = ComputerPermissions.snapshot()
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    private var pending: ComputerCoordinator.PendingApproval? {
        guard coordinator.pendingApproval?.sessionKey == sessionKey else { return nil }
        return coordinator.pendingApproval
    }

    private var shouldShow: Bool {
        pending != nil
            || coordinator.isActive(sessionKey)
            || coordinator.isPaused(sessionKey)
            || coordinator.deniedSessionKeys.contains(sessionKey)
            || (coordinator.hasConsent(for: sessionKey) && !permissions.isReady)
    }

    private var icon: String {
        if coordinator.isActive(sessionKey) { return "desktopcomputer.trianglebadge.exclamationmark" }
        if coordinator.isPaused(sessionKey) { return "pause.circle.fill" }
        return "hand.raised.fill"
    }

    private var tint: Color {
        coordinator.isActive(sessionKey) ? .orange : .yellow
    }

    private var title: String {
        if let pending {
            switch pending.kind {
            case .session:
                return "Computer Use 请求会话授权"
            case .application(let app):
                return "授权目标应用：\(app.name)"
            }
        }
        if coordinator.isPaused(sessionKey) {
            return "Computer Use 已因用户接管暂停"
        }
        if coordinator.deniedSessionKeys.contains(sessionKey) {
            return "Computer Use 已拒绝"
        }
        if coordinator.isActive(sessionKey) {
            return "Computer Use 正在控制桌面"
        }
        return "Computer Use 权限未就绪"
    }

    private var message: String {
        if let pending {
            switch pending.kind {
            case .session:
                return "仅授权这个顶层会话。Computer Use 会看到目标显示器，并能向已批准的应用发送鼠标和键盘事件。"
            case .application(let app):
                let window = app.windowTitle.map { "，窗口「\($0)」" } ?? ""
                return "\(app.bundleID)\(window)。批准的是本次请求捕获的应用身份；动作不会自动重放，模型必须在你切回该应用后重试。"
            }
        }
        if coordinator.isPaused(sessionKey) {
            return "检测到真实鼠标或键盘输入，lease 已释放。恢复后请先切回目标应用，再让模型重试。"
        }
        if coordinator.deniedSessionKeys.contains(sessionKey) {
            return "本会话后续调用会失败，直到你显式重新允许。"
        }
        if coordinator.isActive(sessionKey) {
            let app = coordinator.activeApplication?.name ?? "目标应用"
            let remaining = coordinator.remainingActions.map(String.init) ?? "?"
            return "\(app) · 剩余动作预算 \(remaining) · ⌥⇧Esc 可随时急停"
        }
        return "需要屏幕录制与辅助功能权限；请在设置 → 工具与 Skills 中完成授权。"
    }

    @ViewBuilder
    private var controls: some View {
        if let pending {
            switch pending.kind {
            case .session:
                HStack(spacing: 6) {
                    Button("拒绝") { coordinator.denyPendingSession(sessionKey) }
                    Button("允许本会话") { coordinator.approvePendingSession(sessionKey) }
                        .buttonStyle(.borderedProminent)
                }
            case .application:
                HStack(spacing: 6) {
                    Button("拒绝") {
                        coordinator.denyPendingApplication(sessionKey, persist: false)
                    }
                    Button("始终拒绝") {
                        coordinator.denyPendingApplication(sessionKey, persist: true)
                    }
                    Button("仅本会话允许") {
                        coordinator.approvePendingApplication(sessionKey, persist: false)
                    }
                    Button("始终允许") {
                        coordinator.approvePendingApplication(sessionKey, persist: true)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        } else if coordinator.isPaused(sessionKey) {
            HStack(spacing: 6) {
                Button("保持暂停") {}
                    .disabled(true)
                Button("恢复") { coordinator.resumeAfterUserTakeover(sessionKey) }
                    .buttonStyle(.borderedProminent)
            }
        } else if coordinator.deniedSessionKeys.contains(sessionKey) {
            Button("重新允许本会话") {
                coordinator.allowSessionFromToolbar(sessionKey)
            }
            .buttonStyle(.borderedProminent)
        } else if coordinator.isActive(sessionKey) {
            Button("急停", role: .destructive) {
                coordinator.emergencyStop(sessionKey: sessionKey)
            }
            .buttonStyle(.borderedProminent)
        } else {
            Button("打开设置") {
                AppStore.shared.showSettings = true
            }
        }
    }
}

struct ComputerToolbarControl: View {
    let sessionKey: String
    @ObservedObject private var coordinator = ComputerCoordinator.shared

    var body: some View {
        Menu {
            if coordinator.isActive(sessionKey) {
                let app = coordinator.activeApplication?.name ?? "目标应用"
                Text("正在控制 \(app)")
                Button("急停并中止生成", role: .destructive) {
                    coordinator.emergencyStop(sessionKey: sessionKey)
                }
            } else if coordinator.isPaused(sessionKey) {
                Text("用户接管后已暂停")
                Button("恢复会话授权") {
                    coordinator.resumeAfterUserTakeover(sessionKey)
                }
            } else if coordinator.hasConsent(for: sessionKey) {
                Text("会话已授权，当前无 lease")
                Button("撤销会话授权", role: .destructive) {
                    coordinator.release(sessionKey: sessionKey, revokeConsent: true)
                }
            } else {
                Text("当前会话未授权")
                Button("允许当前会话") {
                    coordinator.allowSessionFromToolbar(sessionKey)
                }
            }
            Divider()
            Text("全局急停：⌥⇧Esc")
        } label: {
            Image(systemName: coordinator.isActive(sessionKey)
                ? "desktopcomputer.trianglebadge.exclamationmark"
                : "desktopcomputer")
                .foregroundStyle(coordinator.isActive(sessionKey) ? .orange : .secondary)
                .overlay(alignment: .topTrailing) {
                    if coordinator.isActive(sessionKey) {
                        Circle().fill(.orange).frame(width: 7, height: 7)
                            .offset(x: 3, y: -3)
                    }
                }
        }
        .help("Computer Use 状态与急停（⌥⇧Esc）")
    }
}

struct ComputerUseSettingsPanel: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var coordinator = ComputerCoordinator.shared
    @State private var enabled = ComputerUseSettings.isEnabled()
    @State private var maxLongEdge = ComputerUseSettings.maxLongEdge()
    @State private var displayID = ComputerUseSettings.selectedDisplayID()
    @State private var permissions = ComputerPermissions.snapshot()
    @State private var allowed = ComputerUseSettings.persistedAllowedBundleIDs()
    @State private var denied = ComputerUseSettings.persistedDeniedBundleIDs()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Computer Use（桌面控制）", systemImage: "desktopcomputer")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Toggle("", isOn: Binding(
                    get: { enabled },
                    set: setEnabled
                ))
                .labelsHidden()
                .toggleStyle(.switch)
            }
            Text("默认关闭。关闭时不会向 pi 挂载 computer 扩展，工具不存在且没有前缀成本。仅顶层会话可用；subagent 永久排除。")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                permissionRow(
                    title: "屏幕录制",
                    granted: permissions.screenRecording,
                    request: {
                        _ = ComputerPermissions.requestScreenRecording()
                        ComputerPermissions.openScreenRecordingSettings()
                    }
                )
                permissionRow(
                    title: "辅助功能",
                    granted: permissions.accessibility,
                    request: {
                        _ = ComputerPermissions.requestAccessibility()
                        ComputerPermissions.openAccessibilitySettings()
                    }
                )
            }

            Picker("目标显示器", selection: Binding(
                get: { displayID },
                set: { value in
                    displayID = value
                    ComputerUseSettings.setSelectedDisplayID(value)
                    if enabled { store.restartAllOpenSessions() }
                }
            )) {
                ForEach(ComputerUseSettings.activeDisplayIDs(), id: \.self) { id in
                    let main = id == CGMainDisplayID() ? "（主）" : ""
                    Text("Display \(id) \(main)").tag(id)
                }
            }

            Picker("截图最长边", selection: Binding(
                get: { maxLongEdge },
                set: { value in
                    maxLongEdge = value
                    ComputerUseSettings.setMaxLongEdge(value)
                    if enabled { store.restartAllOpenSessions() }
                }
            )) {
                ForEach(ComputerUseSettings.supportedLongEdges, id: \.self) { edge in
                    Text("\(edge) px").tag(edge)
                }
            }

            policyList(title: "始终允许的应用", values: allowed)
            policyList(title: "始终拒绝的应用", values: denied)

            Text("固定拒绝：PipiUI 自身、Terminal/iTerm 类终端、密码管理器、钥匙串和 System Settings。截图只驻留内存；审计日志不记录截图、输入文本或 capability token。")
                .font(.caption2)
                .foregroundStyle(.orange)
            Text("权限应授予稳定签名的 build/PipiUI.app。swift run 继承终端的 TCC 身份，不能作为权限验收。")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
        .task {
            while !Task.isCancelled {
                permissions = ComputerPermissions.snapshot()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func permissionRow(
        title: String,
        granted: Bool,
        request: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: granted ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(granted ? .green : .red)
            Text(title)
                .font(.caption)
            Button(granted ? "设置" : "去授权", action: request)
                .font(.caption)
        }
        .padding(7)
        .background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.035)))
    }

    @ViewBuilder
    private func policyList(
        title: String,
        values: Set<String>
    ) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption.weight(.semibold))
                ForEach(values.sorted(), id: \.self) { bundleID in
                    HStack {
                        Text(bundleID)
                            .font(.caption.monospaced())
                        Spacer()
                        Button {
                            ComputerUseSettings.setPersistedPolicy(
                                bundleID: bundleID,
                                decision: nil
                            )
                            refreshPolicy()
                        } label: {
                            Image(systemName: "xmark.circle")
                        }
                        .buttonStyle(.plain)
                        .help("移除规则")
                    }
                }
            }
        }
    }

    private func setEnabled(_ value: Bool) {
        enabled = value
        ComputerUseSettings.setEnabled(value)
        if !value {
            if let owner = coordinator.activeSessionKey {
                coordinator.emergencyStop(sessionKey: owner)
            } else {
                coordinator.releaseAll(revokeConsent: true)
            }
        }
        store.restartAllOpenSessions()
    }

    private func refreshPolicy() {
        allowed = ComputerUseSettings.persistedAllowedBundleIDs()
        denied = ComputerUseSettings.persistedDeniedBundleIDs()
    }
}
