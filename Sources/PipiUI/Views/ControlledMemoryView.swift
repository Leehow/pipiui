import SwiftUI

struct ControlledMemoryView: View {
    @ObservedObject private var memory = ControlledMemoryStore.shared
    @State private var actionError: String?

    private var projectGroups: [(String, [ControlledMemoryEntry])] {
        Dictionary(grouping: memory.entries.filter { $0.scope == .project }) {
            $0.projectPath ?? "未知项目"
        }.sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("可控记忆")
                        .font(.title3.weight(.semibold))
                    Text("默认关闭。模型只能提交提案；只有你在这里查看来源和差异并点“应用”后，批准记忆才会改变。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("刷新") { memory.refresh() }
            }

            Toggle("为新会话启用记忆", isOn: Binding(
                get: { memory.isEnabled },
                set: { value in
                    do { try memory.setEnabled(value) }
                    catch { actionError = error.localizedDescription }
                }
            ))
            .toggleStyle(.switch)

            Text("启用后，新建 Pi 会话会冻结当时已批准的用户记忆和当前项目记忆；同一会话后续轮次及扩展重载继续使用原快照，不会静默吸收新修改。关闭会立即停止注入和提案，但不会删除已批准内容。批准修改后请新建会话才能使用。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

            usageSection

            Divider()
            proposalSection
            Divider()
            approvedSection

            if let message = actionError ?? memory.lastError {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .task {
            while !Task.isCancelled {
                memory.refresh()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private var usageSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            let user = memory.usage(scope: .user)
            Text("容量（UTF-8 content 字节）")
                .font(.headline)
            usageRow(label: "用户", used: user.used, limit: user.limit)
            ForEach(projectGroups, id: \.0) { path, _ in
                let usage = memory.usage(scope: .project, projectPath: path)
                usageRow(label: URL(fileURLWithPath: path).lastPathComponent, used: usage.used, limit: usage.limit)
            }
        }
    }

    private func usageRow(label: String, used: Int, limit: Int) -> some View {
        HStack {
            Text(label).lineLimit(1)
            Spacer()
            Text("\(used) / \(limit) B")
                .monospacedDigit()
                .foregroundStyle(used >= limit ? .orange : .secondary)
        }
        .font(.caption)
    }

    private var proposalSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("待确认提案（\(memory.proposals.count)）")
                .font(.headline)
            if memory.proposals.isEmpty {
                Text("暂无提案。memory_propose 只能把变更送到这里，不会直接写入批准记忆。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(memory.proposals) { proposal in
                proposalCard(proposal)
            }
        }
    }

    private func proposalCard(_ proposal: ControlledMemoryProposal) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(operationLabel(proposal.operation))
                    .font(.subheadline.weight(.semibold))
                Text(proposal.scope == .user ? "用户" : "项目")
                    .font(.caption)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.accentColor.opacity(0.12)))
                Spacer()
                Text(proposal.source.proposedAt, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text("来源：会话 \(proposal.source.sessionID) · \(proposal.source.projectPath)")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            if let reason = proposal.reason, !reason.isEmpty {
                Text("理由：\(reason)").font(.caption)
            }
            diffView(proposal)
            HStack {
                Spacer()
                Button("拒绝", role: .destructive) {
                    do { try memory.reject(proposal) }
                    catch { actionError = error.localizedDescription }
                }
                Button("应用") {
                    do { try memory.approve(proposal) }
                    catch { actionError = error.localizedDescription }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder
    private func diffView(_ proposal: ControlledMemoryProposal) -> some View {
        if let diff = try? memory.diff(for: proposal) {
            VStack(alignment: .leading, spacing: 5) {
                if let before = diff.before {
                    Text("− \(before)")
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
                if let after = diff.after {
                    Text("+ \(after)")
                        .foregroundStyle(.green)
                        .textSelection(.enabled)
                }
            }
            .font(.system(.caption, design: .monospaced))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.05)))
        } else {
            Text("目标记忆不存在，不能应用。")
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    private var approvedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("已批准记忆（\(memory.entries.count)）")
                .font(.headline)
            if memory.entries.isEmpty {
                Text("尚未批准任何记忆。不会从 MEMORY.md、USER.md 或旧会话自动导入。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(memory.entries) { entry in
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.content).textSelection(.enabled)
                    Text("\(entry.scope == .user ? "用户" : "项目") · 来源会话 \(entry.source.sessionID) · 更新于 \(entry.updatedAt.formatted())")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
            }
        }
    }

    private func operationLabel(_ operation: ControlledMemoryOperation) -> String {
        switch operation {
        case .add: return "新增"
        case .replace: return "替换"
        case .remove: return "删除"
        }
    }
}
