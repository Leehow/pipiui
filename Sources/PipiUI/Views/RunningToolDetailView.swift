import SwiftUI

/// Value handed from a live tool card to the stable detail-level presenter.
struct RunningToolDetailPresentation: Equatable, Identifiable {
    let id: String
    let call: ToolCallBlock

    init(call: ToolCallBlock) {
        self.id = call.id
        self.call = call
    }
}

/// Detached sheet for watching a tool call's command, elapsed time, and live output.
///
/// Presented by `ChatDetailView` outside the transcript lazy stack so opening it
/// never changes row height. Reads `toolRuns[call.id]` from StreamingState so
/// partial output keeps updating while the sheet is open.
///
/// Bash/shell tools use `StreamingTerminalTextView` (incremental NSTextView) so
/// partial stdout paints like a real terminal instead of a rebuilt Text blob.
struct RunningToolDetailView: View {
    let call: ToolCallBlock
    let run: ToolRun?
    var onDismiss: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss

    private var isRunning: Bool { run?.isRunning == true }
    private var isError: Bool { run?.isError == true }

    /// Terminal-style tools get the streaming NSTextView surface.
    private var usesStreamingTerminal: Bool {
        switch call.name {
        case "bash", "shell": return true
        default: return false
        }
    }

    private var statusColor: Color {
        if isRunning { return .blue }
        if run == nil { return .secondary }
        return isError ? .red : .green
    }

    private var statusLabel: String {
        if isRunning { return "运行中" }
        if run == nil { return "未知" }
        return isError ? "失败" : "完成"
    }

    private var displayOutput: String {
        ComputerScreenshotMarker.displayText(run?.output ?? "")
    }

    private var outputPreview: ToolOutputRenderPreview {
        ToolOutputRenderBudget.preview(output: displayOutput, expanded: true)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if usesStreamingTerminal {
                terminalBody
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        commandSection
                        activitySection
                        plainOutputSection
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(minWidth: 520, idealWidth: 680, maxWidth: 900, minHeight: 360, idealHeight: 560, maxHeight: 760)
        .background(Color(nsColor: .textBackgroundColor))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("工具运行详情 \(call.name)")
    }

    /// Bash/shell layout: fixed header meta + terminal surface that owns scrolling.
    private var terminalBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            commandSection
            activitySection
            streamingOutputSection
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .foregroundStyle(statusColor)
                .imageScale(.large)
            Text(call.name)
                .font(.headline.monospaced())
            statusBadge
            Spacer(minLength: 16)
            Button("完成") {
                if let onDismiss {
                    onDismiss()
                } else {
                    dismiss()
                }
            }
            .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var statusBadge: some View {
        HStack(spacing: 6) {
            if isRunning {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(statusColor)
                    .font(.caption)
            }
            Text(statusLabel)
                .font(.caption.weight(.medium))
                .foregroundStyle(statusColor)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(statusColor.opacity(0.12))
        )
        .accessibilityLabel("状态 \(statusLabel)")
    }

    private var commandSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("命令")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(call.argsSummary.isEmpty ? "…" : call.argsSummary)
                .font(.callout.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.primary.opacity(0.04))
                )
        }
    }

    @ViewBuilder
    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("运行状态")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let startedAt = run?.startedAt {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(elapsedLine(now: context.date, startedAt: startedAt))
                            .font(.callout.monospacedDigit())
                        Text(lastOutputLine(now: context.date))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else if isRunning {
                Text("已运行 …")
                    .font(.callout)
                Text("等待输出…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(isError ? "已结束（失败）" : "已结束")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Streaming terminal surface for bash/shell. Empty-running shows a waiting
    /// line with elapsed seconds so the sheet is never just a spinner.
    private var streamingOutputSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("输出")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if !displayOutput.isEmpty,
                   displayOutput.utf16.count > TerminalOutputSanitizer.displayUTF16Limit {
                    Text("显示已截断")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            if displayOutput.isEmpty {
                emptyStreamingPlaceholder
            } else {
                StreamingTerminalTextView(
                    text: displayOutput,
                    isLive: isRunning
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .frame(minHeight: 180)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.primary.opacity(0.08))
                )
                .accessibilityLabel("流式终端输出")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var emptyStreamingPlaceholder: some View {
        Group {
            if isRunning {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds: Int = {
                        if let startedAt = run?.startedAt {
                            return max(0, Int(context.date.timeIntervalSince(startedAt)))
                        }
                        return 0
                    }()
                    Text("运行中 · 已等待 \(seconds)s")
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(12)
                }
            } else {
                Text("（无输出）")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 180)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.primary.opacity(0.03))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(Color.primary.opacity(0.08))
        )
    }

    private var plainOutputSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("输出")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if outputPreview.isTruncated {
                    Text("显示已截断")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            if displayOutput.isEmpty {
                Text(isRunning ? runningWaitLabel : "（无输出）")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary.opacity(0.03))
                    )
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        Text(outputPreview.text)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .id("tool-output-bottom")
                    }
                    .frame(minHeight: 160, maxHeight: 420)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary.opacity(0.03))
                    )
                    .onAppear {
                        if isRunning {
                            proxy.scrollTo("tool-output-bottom", anchor: .bottom)
                        }
                    }
                    .onChange(of: displayOutput) { _, _ in
                        guard isRunning else { return }
                        proxy.scrollTo("tool-output-bottom", anchor: .bottom)
                    }
                }
            }
        }
    }

    /// Non-terminal empty-running label (kept simple; terminal path uses TimelineView).
    private var runningWaitLabel: String {
        if let startedAt = run?.startedAt {
            let seconds = max(0, Int(Date().timeIntervalSince(startedAt)))
            return "运行中 · 已等待 \(seconds)s"
        }
        return "运行中 · 等待输出…"
    }

    private func elapsedLine(now: Date, startedAt: Date) -> String {
        let label = DurationFormat.compact(now.timeIntervalSince(startedAt))
        if isRunning {
            return "已运行 \(label)"
        }
        return "用时 \(label)"
    }

    private func lastOutputLine(now: Date) -> String {
        guard isRunning else {
            if isError { return "执行失败" }
            return "执行完成"
        }
        guard let lastOutputAt = run?.lastOutputAt else {
            return "等待输出…"
        }
        let ago = DurationFormat.compact(now.timeIntervalSince(lastOutputAt))
        return "最后输出：\(ago) 前"
    }

    private var iconName: String {
        switch call.name {
        case "bash", "shell": return "terminal"
        case "read": return "doc.text"
        case "edit", "write": return "pencil"
        case "generate_image": return "wand.and.stars"
        case "computer", "open_application": return "desktopcomputer"
        default: return "wrench.and.screwdriver"
        }
    }
}
