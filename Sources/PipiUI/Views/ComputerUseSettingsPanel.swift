import SwiftUI
import CoreGraphics

struct ComputerUseSettingsPanel: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject private var coordinator = ComputerCoordinator.shared
    @State private var maxLongEdge = ComputerUseSettings.maxLongEdge()
    @State private var displayID = ComputerUseSettings.selectedDisplayID()
    @State private var permissions = ComputerPermissions.snapshot()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Computer Use（桌面控制）", systemImage: "desktopcomputer")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Toggle("", isOn: Binding(
                    get: { store.computerUseEnabled },
                    set: { store.setComputerUseEnabled($0) }
                ))
                .labelsHidden()
                .toggleStyle(.switch)
            }
            Text("默认关闭。打开后进入无限制模式：所有顶层会话和 subagent 都可调用 computer / open_application，不做会话、应用、高风险或写操作确认。")
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
                    if store.computerUseEnabled { store.restartAllOpenSessions() }
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
                    if store.computerUseEnabled { store.restartAllOpenSessions() }
                }
            )) {
                ForEach(ComputerUseSettings.supportedLongEdges, id: \.self) { edge in
                    Text("\(edge) px").tag(edge)
                }
            }

            Text("PipiUI 不会因普通鼠标、键盘或滚动输入暂停，也不会执行应用 allow/deny、敏感文本/快捷键或破坏性动作策略。历史 allow/deny 数据仅为迁移兼容保留，不参与执行。唯一自动串行化是当前实际执行中的全局互斥槽；操作结束、失败或取消后立即释放。")
                .font(.caption2)
                .foregroundStyle(.orange)
            Text("保留的闸门只有：全局开关、macOS TCC、手动急停，以及目标进程/焦点/截图/坐标/event-post 校验和 held-input 清理。")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("截图只驻留内存；审计日志不记录截图、输入文本或 capability token。")
                .font(.caption2)
                .foregroundStyle(.secondary)
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

}
