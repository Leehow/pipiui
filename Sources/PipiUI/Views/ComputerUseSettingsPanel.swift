import SwiftUI
import CoreGraphics

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

            Text("固定拒绝：PipiUI 自身、常见终端、密码管理器、钥匙串和 System Settings。截图只驻留内存；审计日志不记录截图、输入文本或 capability token。")
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
                coordinator.refreshInputMonitoring(permissionSnapshot: permissions)
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
            coordinator.emergencyStop()
            coordinator.shutdownInputMonitoring()
        } else {
            coordinator.refreshInputMonitoring(permissionSnapshot: permissions)
        }
        store.restartAllOpenSessions()
    }

    private func refreshPolicy() {
        allowed = ComputerUseSettings.persistedAllowedBundleIDs()
        denied = ComputerUseSettings.persistedDeniedBundleIDs()
    }
}
