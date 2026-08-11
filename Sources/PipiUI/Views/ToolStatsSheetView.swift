import SwiftUI

/// 工具耗时统计 sheet：从当前会话 transcript 实时聚合已完成工具调用的耗时。
/// 不持有 transcript 副本；每次呈现 / transcript 更新时从 live session 重新计算。
struct ToolStatsSheetView: View {
    @ObservedObject var session: ChatSession
    @Environment(\.dismiss) private var dismiss

    private var report: ToolStatsReport {
        ToolCallStats.compute(items: session.transcript)
    }

    private var health: ToolCallHealthReport {
        ToolCallHealth.compute(items: session.transcript)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if report.rows.isEmpty {
                emptyState
            } else {
                table
            }
            healthFooter
        }
        .frame(width: 520, height: 420)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "timer")
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 26, height: 26)
                .background(
                    Color.accentColor.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: 7)
                )
                .accessibilityHidden(true)
            Text("工具耗时统计")
                .font(.title3.weight(.semibold))
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("关闭")
        }
        .padding(16)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 30))
                .foregroundStyle(.secondary.opacity(0.7))
            Text("暂无已完成的工具调用")
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("工具执行完成后会记录耗时，本面板按工具类型汇总本次会话的耗时。")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var table: some View {
        ScrollView {
            Grid(alignment: .trailing, horizontalSpacing: 18, verticalSpacing: 9) {
                GridRow {
                    Text("工具")
                        .gridColumnAlignment(.leading)
                    Text("次数")
                    Text("平均")
                    Text("合计")
                    Text("最长")
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

                ForEach(report.rows, id: \.name) { row in
                    GridRow {
                        Text(row.name)
                            .font(.body.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .gridColumnAlignment(.leading)
                        Text("\(row.count)")
                            .font(.body.monospacedDigit())
                        Text(DurationFormat.compact(row.averageSeconds))
                            .font(.body.monospacedDigit())
                        Text(TurnDurationFormat.elapsed(row.totalSeconds))
                            .font(.body.monospacedDigit())
                        Text(DurationFormat.compact(row.maxSeconds))
                            .font(.body.monospacedDigit())
                    }
                }

                Divider()

                GridRow {
                    Text("总计")
                        .font(.body.weight(.semibold))
                        .gridColumnAlignment(.leading)
                    Text("\(report.callCount)")
                        .font(.body.weight(.semibold).monospacedDigit())
                    Text(overallAverage.map(DurationFormat.compact) ?? "—")
                        .font(.body.monospacedDigit())
                    Text(TurnDurationFormat.elapsed(report.totalSeconds))
                        .font(.body.weight(.semibold).monospacedDigit())
                    Text(overallMax.map(DurationFormat.compact) ?? "—")
                        .font(.body.monospacedDigit())
                }
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// 只在有异常时出现：干净的会话不该为一条永远为 0 的指标付出版面。
    @ViewBuilder
    private var healthFooter: some View {
        let health = self.health
        if !health.isClean {
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                if health.toolFreeRounds > 0 {
                    Label(
                        "\(health.toolFreeRounds)/\(health.rounds) 轮全程没有调用任何工具",
                        systemImage: "wrench.and.screwdriver"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                if !health.leakedTokens.isEmpty {
                    Label(
                        "疑似未解析的工具调用 \(health.leakedTokenCount) 处：\(leakSummary(health))",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.caption)
                    .foregroundStyle(.orange)
                    Text("控制标记出现在正文里，说明工具调用是在模型/网关侧漏掉的，不是任务没做。")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
    }

    private func leakSummary(_ health: ToolCallHealthReport) -> String {
        health.leakedTokens
            .prefix(3)
            .map { $0.count > 1 ? "\($0.token) ×\($0.count)" : $0.token }
            .joined(separator: "、")
    }

    private var overallAverage: TimeInterval? {
        guard report.callCount > 0 else { return nil }
        return (report.totalSeconds / Double(report.callCount) * 10).rounded() / 10
    }

    private var overallMax: TimeInterval? {
        report.rows.map(\.maxSeconds).max()
    }
}
