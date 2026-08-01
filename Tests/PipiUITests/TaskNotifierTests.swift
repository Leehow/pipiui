import XCTest
@testable import PipiUI

@MainActor
final class TaskNotifierTests: XCTestCase {
    /// 独立 UserDefaults suite，避免污染 .standard（与其他测试同风格）。
    private func makeNotifier() -> (TaskNotifier, UserDefaults) {
        let suite = "pipiui.test.tasknotifier.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return (TaskNotifier(defaults: defaults), defaults)
    }

    // MARK: - Boss turn completion lifecycle

    func testCompletionLifecycleWaitsForSubagentThenConsumesOnce() {
        var lifecycle = TaskCompletionLifecycle()
        lifecycle.beginMainAgentTurn(existingSubagents: [])
        lifecycle.observeSubagents([
            .init(id: "agent-child", state: .running)
        ])
        lifecycle.markMainAgentSettled()

        XCTAssertFalse(
            lifecycle.consumeSuccessfulCompletionIfReady(
                isWorking: false,
                hasQueuedPrompt: false,
                processAlive: true,
                lastError: nil,
                runningSubagentCount: 1
            ),
            "主 agent 已 settled 但后台 subagent 仍在运行时不得提醒"
        )

        lifecycle.observeSubagents([
            .init(id: "agent-child", state: .ok)
        ])

        XCTAssertTrue(
            lifecycle.consumeSuccessfulCompletionIfReady(
                isWorking: false,
                hasQueuedPrompt: false,
                processAlive: true,
                lastError: nil,
                runningSubagentCount: 0
            ),
            "最后一个成功 subagent 结束后应触发一次完成提醒"
        )
        XCTAssertFalse(
            lifecycle.consumeSuccessfulCompletionIfReady(
                isWorking: false,
                hasQueuedPrompt: false,
                processAlive: true,
                lastError: nil,
                runningSubagentCount: 0
            ),
            "同一 turn 的完成提醒必须去重"
        )
    }

    func testCompletionLifecycleRejectsFailedAndInterruptedSubagents() {
        let terminalFailures: [TaskCompletionLifecycle.Subagent.State] = [.failed, .interrupted]

        for terminalState in terminalFailures {
            var lifecycle = TaskCompletionLifecycle()
            lifecycle.beginMainAgentTurn(existingSubagents: [])
            lifecycle.observeSubagents([
                .init(id: "agent-child", state: .running)
            ])
            lifecycle.markMainAgentSettled()
            lifecycle.observeSubagents([
                .init(id: "agent-child", state: terminalState)
            ])

            XCTAssertFalse(
                lifecycle.consumeSuccessfulCompletionIfReady(
                    isWorking: false,
                    hasQueuedPrompt: false,
                    processAlive: true,
                    lastError: nil,
                    runningSubagentCount: 0
                ),
                "\(terminalState) subagent 不得产生任务完成提醒"
            )
        }
    }

    // MARK: - shouldNotifyCompletion

    func testShouldNotifyCompletionOnlyWhenUserCannotSeeResult() {
        // 选中且应用激活 = 用户正在看 → 不提醒。
        XCTAssertFalse(TaskNotifier.shouldNotifyCompletion(selected: true, appActive: true))
        // 其余组合（看不到结果）→ 提醒。
        XCTAssertTrue(TaskNotifier.shouldNotifyCompletion(selected: true, appActive: false))
        XCTAssertTrue(TaskNotifier.shouldNotifyCompletion(selected: false, appActive: true))
        XCTAssertTrue(TaskNotifier.shouldNotifyCompletion(selected: false, appActive: false))
    }

    // MARK: - 系统通知门控（.app 包才走 UN）

    func testSystemNotificationGateRequiresRealAppBundle() {
        XCTAssertTrue(TaskNotifier.shouldUseSystemNotifications(
            bundleIdentifier: "com.leehow.pipiui",
            bundlePathExtension: "app"
        ))
        // swift run / XCTest 宿主：无 bundle id 或非 .app → 走应用内横幅。
        XCTAssertFalse(TaskNotifier.shouldUseSystemNotifications(
            bundleIdentifier: nil,
            bundlePathExtension: "app"
        ))
        XCTAssertFalse(TaskNotifier.shouldUseSystemNotifications(
            bundleIdentifier: "com.example.test",
            bundlePathExtension: "bin"
        ))
        XCTAssertFalse(TaskNotifier.shouldUseSystemNotifications(
            bundleIdentifier: nil,
            bundlePathExtension: "bin"
        ))
    }

    // MARK: - truncated

    func testTruncatedLeavesShortAndEmptyStringsUntouched() {
        XCTAssertEqual(TaskNotifier.truncated("任务已完成"), "任务已完成")
        XCTAssertEqual(TaskNotifier.truncated(""), "")
    }

    func testTruncatedCutsLongStringAtCharacterBoundary() {
        let long = String(repeating: "长", count: 100)
        let cut = TaskNotifier.truncated(long)
        XCTAssertEqual(cut.count, 81, "80 个字符 + 省略号")
        XCTAssertTrue(cut.hasSuffix("…"))
        XCTAssertEqual(String(cut.dropLast()), String(repeating: "长", count: 80))
    }

    func testTruncatedRespectsCustomLimit() {
        let text = String(repeating: "a", count: 100)
        XCTAssertEqual(TaskNotifier.truncated(text, limit: 5), "aaaaa…")
        XCTAssertEqual(TaskNotifier.truncated(text, limit: 80).count, 81)
    }

    // MARK: - 设置开关门控

    func testCompletionToggleOffDeliversNothing() {
        let (notifier, defaults) = makeNotifier()
        TaskNotifierSettings.setCompletionEnabled(false, defaults: defaults)
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        notifier.notifyCompletion(sessionTitle: "测试会话")

        XCTAssertTrue(delivered.isEmpty, "开关关闭时不得投递任何提醒")
    }

    func testCompletionToggleOnDeliversCompletionAlert() {
        let (notifier, _) = makeNotifier()
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        notifier.notifyCompletion(sessionTitle: "测试会话")

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertEqual(delivered[0].title, "任务完成")
        XCTAssertEqual(delivered[0].body, "「测试会话」任务已完成")
    }

    func testErrorToggleOffDeliversNothing() {
        let (notifier, defaults) = makeNotifier()
        TaskNotifierSettings.setErrorEnabled(false, defaults: defaults)
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        notifier.notifyError(sessionTitle: "测试会话", message: "pi 进程退出 (code 1)")

        XCTAssertTrue(delivered.isEmpty, "开关关闭时不得投递任何提醒")
    }

    func testErrorToggleOnDeliversErrorAlertWithTruncatedMessage() {
        let (notifier, _) = makeNotifier()
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        let longMessage = String(repeating: "出错了", count: 50)
        notifier.notifyError(sessionTitle: "测试会话", message: longMessage)

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertEqual(delivered[0].title, "任务出错")
        XCTAssertEqual(
            delivered[0].body,
            "「测试会话」任务出错：\(TaskNotifier.truncated(longMessage))"
        )
    }

    // MARK: - 设置读写

    func testDefaultsAreEnabled() {
        let (notifier, _) = makeNotifier()
        XCTAssertTrue(notifier.notifyCompletionEnabled)
        XCTAssertTrue(notifier.notifyErrorEnabled)
    }

    func testTogglesPersistToUserDefaults() {
        let (notifier, defaults) = makeNotifier()

        notifier.setNotifyCompletionEnabled(false)
        XCTAssertFalse(notifier.notifyCompletionEnabled)
        XCTAssertEqual(
            defaults.object(forKey: TaskNotifierSettings.completionKey) as? Bool,
            false
        )

        notifier.setNotifyCompletionEnabled(true)
        XCTAssertTrue(notifier.notifyCompletionEnabled)

        notifier.setNotifyErrorEnabled(false)
        XCTAssertFalse(notifier.notifyErrorEnabled)
        XCTAssertEqual(
            defaults.object(forKey: TaskNotifierSettings.errorKey) as? Bool,
            false
        )
    }
}
