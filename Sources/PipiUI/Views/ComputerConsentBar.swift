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
                    coordinator.refreshInputMonitoring(permissionSnapshot: permissions)
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    private var pending: ComputerCoordinator.PendingApproval? {
        guard coordinator.pendingApproval?.sessionKey == sessionKey else { return nil }
        return coordinator.pendingApproval
    }

    private var pendingWrite: ComputerCoordinator.PendingWriteApproval? {
        guard coordinator.pendingWriteApproval?.sessionKey == sessionKey else { return nil }
        return coordinator.pendingWriteApproval
    }

    private var shouldShow: Bool {
        pending != nil
            || pendingWrite != nil
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
        if let pendingWrite {
            if pendingWrite.phase == .approvedAwaitingTargetRefocus {
                return "动作已批准，请切回 \(pendingWrite.targetApplication.name)"
            }
            return "确认 \(pendingWrite.actionKinds.count) 个桌面动作"
        }
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
        if let pendingWrite {
            if pendingWrite.phase == .approvedAwaitingTargetRefocus {
                return "请手动切回 \(pendingWrite.targetApplication.name) "
                    + "(\(pendingWrite.targetApplication.bundleID)，PID "
                    + "\(pendingWrite.targetApplication.processID))。"
                    + "PipiUI 不会主动切换应用；仅当这个精确进程重新位于前台时才执行，"
                    + "超时、进程替换或策略变化都会取消。"
            }
            let actions = pendingWrite.actionKinds.map(\.rawValue).joined(separator: " → ")
            return "仅批准请求 \(pendingWrite.requestID.prefix(8)) 的精确动作指纹；"
                + "\(Int(ComputerRuntimeBudget.maximumApprovalSeconds)) 秒后过期且只能使用一次。"
                + "动作：\(actions)"
        }
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
        if let pendingWrite {
            if pendingWrite.phase == .approvedAwaitingTargetRefocus {
                Button("取消等待") {
                    coordinator.denyPendingWrite(
                        id: pendingWrite.id,
                        requestID: pendingWrite.requestID,
                        fingerprint: pendingWrite.fingerprint
                    )
                }
            } else {
                HStack(spacing: 6) {
                    Button("拒绝") {
                        coordinator.denyPendingWrite(
                            id: pendingWrite.id,
                            requestID: pendingWrite.requestID,
                            fingerprint: pendingWrite.fingerprint
                        )
                    }
                    Button("确认，等待切回目标") {
                        coordinator.approvePendingWrite(
                            id: pendingWrite.id,
                            requestID: pendingWrite.requestID,
                            fingerprint: pendingWrite.fingerprint
                        )
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        } else if let pending {
            switch pending.kind {
            case .session:
                HStack(spacing: 6) {
                    Button("拒绝") {
                        coordinator.denyPendingSession(
                            id: pending.id,
                            sessionKey: sessionKey
                        )
                    }
                    Button("允许本会话") {
                        coordinator.approvePendingSession(
                            id: pending.id,
                            sessionKey: sessionKey
                        )
                    }
                        .buttonStyle(.borderedProminent)
                }
            case .application:
                HStack(spacing: 6) {
                    Button("拒绝") {
                        coordinator.denyPendingApplication(
                            id: pending.id,
                            sessionKey: sessionKey,
                            persist: false
                        )
                    }
                    Button("始终拒绝") {
                        coordinator.denyPendingApplication(
                            id: pending.id,
                            sessionKey: sessionKey,
                            persist: true
                        )
                    }
                    Button("仅本会话允许") {
                        coordinator.approvePendingApplication(
                            id: pending.id,
                            sessionKey: sessionKey,
                            persist: false
                        )
                    }
                    Button("始终允许") {
                        coordinator.approvePendingApplication(
                            id: pending.id,
                            sessionKey: sessionKey,
                            persist: true
                        )
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
