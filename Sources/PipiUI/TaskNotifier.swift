import Foundation
import AppKit
import UserNotifications

/// 任务提醒设置持久化（与 `BuiltInFeatureSettings` 同风格：缺省 = 开启，只有
/// 显式写入的 Bool 才生效）。
enum TaskNotifierSettings {
    static let completionKey = "pipiui.notifyCompletion"
    static let errorKey = "pipiui.notifyError"

    static func completionEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: completionKey) as? Bool ?? true
    }

    static func errorEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: errorKey) as? Bool ?? true
    }

    static func setCompletionEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: completionKey)
    }

    static func setErrorEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: errorKey)
    }
}

/// 一次任务提醒的完整内容（标题 + 正文），用于系统通知与应用内横幅。
struct TaskAlert {
    enum Kind: Equatable {
        case completion
        case error
    }

    let kind: Kind
    let title: String
    let body: String
}

/// 应用内横幅内容（SwiftUI overlay 驱动）。
struct Toast: Equatable {
    let kind: TaskAlert.Kind
    let message: String
}

/// 任务完成 / 任务出错提醒。
///
/// 两条投递路径：
/// - 打包运行（`Bundle.main.bundleIdentifier != nil`）：UNUserNotificationCenter
///   系统通知 + 默认提示音；首次使用时惰性申请授权。
/// - 开发运行（`swift run`，bundle id 为 nil）或系统通知授权被拒：应用内顶部横幅
///   + NSSound（完成「Glass」/ 出错「Sosumi」）。
///
/// 所有投递副作用都经过 `deliver` 缝（默认指向真实实现），测试可替换它以捕获
/// `TaskAlert`，完全不触碰 UNUserNotificationCenter / NSSound。设置开关在调用
/// `deliver` 之前判定——开关关闭时什么都不做（无 UN、无横幅、无声音）。
@MainActor
final class TaskNotifier: ObservableObject {
    static let shared = TaskNotifier()

    /// 应用内横幅状态：SwiftUI 在窗口顶部 overlay 展示；last wins（新横幅顶掉旧的）。
    @Published var toast: Toast?

    /// 投递缝：默认走真实实现（UN / 横幅 + 声音）；测试注入捕获闭包。
    var deliver: @MainActor (TaskAlert) -> Void

    /// 可注入 UserDefaults（测试用独立 suite，避免污染 `.standard`）。
    let defaults: UserDefaults

    private enum AuthorizationState {
        case unknown
        case granted
        case denied
    }

    private var authorizationState: AuthorizationState = .unknown
    private var toastDismissTask: Task<Void, Never>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // 先占位再捕获 self：Swift 不允许在全部属性初始化完成前于闭包里引用 self。
        self.deliver = { _ in }
        self.deliver = { [weak self] alert in
            guard let self else { return }
            if Self.shouldUseSystemNotifications(
                bundleIdentifier: Bundle.main.bundleIdentifier,
                bundlePathExtension: Bundle.main.bundleURL.pathExtension
            ) {
                self.deliverSystemNotification(alert)
            } else {
                self.deliverInApp(alert)
            }
        }
    }

    // MARK: - Settings

    var notifyCompletionEnabled: Bool {
        TaskNotifierSettings.completionEnabled(defaults: defaults)
    }

    var notifyErrorEnabled: Bool {
        TaskNotifierSettings.errorEnabled(defaults: defaults)
    }

    func setNotifyCompletionEnabled(_ enabled: Bool) {
        TaskNotifierSettings.setCompletionEnabled(enabled, defaults: defaults)
    }

    func setNotifyErrorEnabled(_ enabled: Bool) {
        TaskNotifierSettings.setErrorEnabled(enabled, defaults: defaults)
    }

    // MARK: - Alerts

    func notifyCompletion(sessionTitle: String, subagentTitles: [String] = []) {
        guard notifyCompletionEnabled else { return }
        var body = "「\(sessionTitle)」任务已完成"
        if !subagentTitles.isEmpty {
            let listed = subagentTitles.prefix(3).joined(separator: "、")
            let more = subagentTitles.count > 3 ? " 等\(subagentTitles.count)项" : ""
            body += "（子任务：\(listed)\(more)）"
        }
        deliver(TaskAlert(
            kind: .completion,
            title: "任务完成",
            body: body
        ))
    }

    /// 本轮子任务出错/需人工介入：单个直接点名；多个至少列出前 3 个并显示剩余数量。
    /// 剩余数量放在列表前，避免被正文截断吞掉。
    func notifySubagentError(sessionTitle: String, issues: [(title: String, reason: String)]) {
        guard notifyErrorEnabled, !issues.isEmpty else { return }
        let body: String
        if issues.count == 1 {
            body = "「\(sessionTitle)」子任务「\(issues[0].title)」\(issues[0].reason)"
        } else {
            let marks = ["①", "②", "③"]
            let listed = issues.prefix(3).enumerated().map { index, issue in
                "\(marks[index])「\(issue.title)」\(issue.reason)"
            }.joined(separator: "；")
            var text = "「\(sessionTitle)」\(issues.count) 项子任务需人工介入"
            if issues.count > 3 {
                text += "（另有 \(issues.count - 3) 项）"
            }
            body = text + "：\(listed)"
        }
        deliver(TaskAlert(kind: .error, title: "任务出错", body: Self.truncated(body)))
    }

    func notifyError(sessionTitle: String, message: String) {
        guard notifyErrorEnabled else { return }
        deliver(TaskAlert(
            kind: .error,
            title: "任务出错",
            body: "「\(sessionTitle)」任务出错：\(Self.truncated(message))"
        ))
    }

    func notifyAutomationCompletion(title: String, summary: String) {
        guard notifyCompletionEnabled else { return }
        deliver(TaskAlert(
            kind: .completion,
            title: "自动任务完成",
            body: "「\(title)」：\(Self.truncated(summary))"
        ))
    }

    func notifyAutomationError(title: String, message: String) {
        guard notifyErrorEnabled else { return }
        deliver(TaskAlert(
            kind: .error,
            title: "自动任务出错",
            body: "「\(title)」：\(Self.truncated(message))"
        ))
    }

    /// 立即收起应用内横幅（点击横幅时调用；自动收起走内部定时任务）。
    func dismissToast() {
        toastDismissTask?.cancel()
        toastDismissTask = nil
        toast = nil
    }

    // MARK: - 纯函数（可单测）

    /// 用户是否看不到结果：未选中会话或应用未激活 → 需要弹任务完成提醒。
    /// 与绿色角标语义一致：选中且激活时用户在观看，不打扰。
    nonisolated static func shouldNotifyCompletion(selected: Bool, appActive: Bool) -> Bool {
        !(selected && appActive)
    }

    /// 系统通知只在真正的 .app 包内可用：`swift run`（bundle id 为 nil）与
    /// XCTest 宿主（bundle 不是 .app）都会让 UNUserNotificationCenter 抛异常，
    /// 必须回退到应用内横幅。
    nonisolated static func shouldUseSystemNotifications(
        bundleIdentifier: String?,
        bundlePathExtension: String
    ) -> Bool {
        bundleIdentifier != nil && bundlePathExtension == "app"
    }

    /// 按字符截断（非字节），超出时补「…」。
    nonisolated static func truncated(_ text: String, limit: Int = 80) -> String {
        let characters = Array(text)
        guard characters.count > limit else { return text }
        guard limit > 0 else { return "…" }
        return String(characters[0..<limit]) + "…"
    }

    // MARK: - 真实投递

    /// 打包运行：UNUserNotificationCenter 系统通知。首次使用惰性申请授权；
    /// 授权被拒回退到应用内横幅 + 提示音。
    private func deliverSystemNotification(_ alert: TaskAlert) {
        switch authorizationState {
        case .granted:
            postSystemNotification(alert)
        case .denied:
            deliverInApp(alert)
        case .unknown:
            let center = UNUserNotificationCenter.current()
            center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.authorizationState = granted ? .granted : .denied
                    if granted {
                        self.postSystemNotification(alert)
                    } else {
                        self.deliverInApp(alert)
                    }
                }
            }
        }
    }

    private func postSystemNotification(_ alert: TaskAlert) {
        let content = UNMutableNotificationContent()
        content.title = alert.title
        content.body = alert.body
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    /// 应用内顶部横幅 + 提示音（开发运行或系统通知授权被拒的兜底）。
    private func deliverInApp(_ alert: TaskAlert) {
        toast = Toast(kind: alert.kind, message: alert.body)
        playSound(for: alert.kind)
        scheduleToastDismiss()
    }

    private func playSound(for kind: TaskAlert.Kind) {
        let name = kind == .completion ? "Glass" : "Sosumi"
        NSSound(named: name)?.play()
    }

    /// 约 3.5 秒后自动收起横幅；新横幅顶掉旧横幅（last wins）。
    private func scheduleToastDismiss() {
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
}
