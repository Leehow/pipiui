import SwiftUI

/// Runtime status only. Unrestricted Computer Use has no approval, takeover,
/// resume, lease-budget, or expiry controls.
struct ComputerConsentBar: View {
    let sessionKey: String
    @ObservedObject private var coordinator = ComputerCoordinator.shared
    @State private var permissions = ComputerPermissions.snapshot()
    @State private var showSettings = false

    var body: some View {
        if ComputerUseSettings.isEnabled(), shouldShow {
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
                }
                Spacer()
                controls
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(tint.opacity(0.08))
            .overlay(alignment: .bottom) { Divider() }
            .task {
                while !Task.isCancelled {
                    permissions = ComputerPermissions.snapshot()
                    coordinator.refreshInputMonitoring(
                        permissionSnapshot: permissions
                    )
                    try? await Task.sleep(for: .seconds(2))
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsSheet()
                    .environmentObject(AppStore.shared)
                    .accessibilityIdentifier("PipiUI.SettingsPanel")
            }
        }
    }

    private var shouldShow: Bool {
        coordinator.isActive(sessionKey)
            || coordinator.emergencyStopped
            || !permissions.isReady
    }

    private var icon: String {
        if coordinator.emergencyStopped {
            return "exclamationmark.octagon.fill"
        }
        if coordinator.isActive(sessionKey) {
            return "desktopcomputer.trianglebadge.exclamationmark"
        }
        return "hand.raised.fill"
    }

    private var tint: Color {
        coordinator.emergencyStopped
            ? .red
            : (coordinator.isActive(sessionKey) ? .accentColor : .yellow)
    }

    private var title: String {
        if coordinator.emergencyStopped {
            return "Computer Use 已全局急停"
        }
        if coordinator.isActive(sessionKey) {
            return "Computer Use 正在执行桌面操作"
        }
        return "Computer Use 权限未就绪"
    }

    private var message: String {
        if coordinator.emergencyStopped {
            return "操作与 held input 已清理。点击底部桌面按钮可重新开启。"
        }
        if coordinator.isActive(sessionKey) {
            let app = coordinator.activeApplication?.name ?? "目标应用"
            return "\(app) · 无审批/接管暂停/跨请求 lease · ⌥⇧Esc 可急停"
        }
        return "只需要 macOS 屏幕录制与辅助功能权限。"
    }

    @ViewBuilder
    private var controls: some View {
        if coordinator.emergencyStopped {
            Button("重新开启") {
                AppStore.shared.setComputerUseEnabled(true)
            }
            .buttonStyle(.borderedProminent)
        } else if coordinator.isActive(sessionKey) {
            Button("急停", role: .destructive) {
                coordinator.emergencyStop()
            }
            .buttonStyle(.borderedProminent)
        } else {
            Button("打开设置") {
                showSettings = true
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
                Text("正在执行 \(app)")
                Button("全局急停并中止生成", role: .destructive) {
                    coordinator.emergencyStop()
                }
            } else if coordinator.emergencyStopped {
                Text("全局急停已触发")
                Button("重新开启桌面控制") {
                    AppStore.shared.setComputerUseEnabled(true)
                }
            } else {
                Text("无限制模式已开启")
            }
            Divider()
            Text("普通鼠标键盘输入不会暂停 · 急停：⌥⇧Esc")
        } label: {
            Image(systemName: coordinator.isActive(sessionKey)
                ? "desktopcomputer.trianglebadge.exclamationmark"
                : "desktopcomputer")
                .foregroundStyle(
                    coordinator.isActive(sessionKey)
                        ? Color.accentColor : Color.secondary
                )
                .overlay(alignment: .topTrailing) {
                    if coordinator.isActive(sessionKey) {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 7, height: 7)
                            .offset(x: 3, y: -3)
                    }
                }
        }
        .help("Computer Use 无限制模式与急停（⌥⇧Esc）")
    }
}
