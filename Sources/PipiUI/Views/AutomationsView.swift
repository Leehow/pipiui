import SwiftUI

struct AutomationsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var scheduler: AutomationScheduler

    @State private var editingJob: AutomationJob?
    @State private var pendingDelete: AutomationJob?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("自动任务").font(.headline)
                    Text("仅在 Pipi 运行时调度；错过的计划每个任务最多补跑一次。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    editingJob = newDraft(prompt: "")
                } label: {
                    Label("新建", systemImage: "plus")
                }
                Button("完成") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(16)
            Divider()

            if scheduler.jobs.isEmpty {
                ContentUnavailableView(
                    "还没有自动任务",
                    systemImage: "clock.badge.checkmark",
                    description: Text("点击“新建”，或在聊天中输入 /schedule <提示词>。保存前始终会让你确认。")
                )
            } else {
                List {
                    ForEach(scheduler.jobs) { job in
                        jobRow(job)
                    }
                }
                .listStyle(.inset)
            }

            if let error = scheduler.persistenceError {
                Divider()
                Text("保存失败：\(error)")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(10)
            }
        }
        .frame(width: 760, height: 560)
        .onAppear {
            consumeDraftRequest()
        }
        .onChange(of: store.automationDraftRequest?.id) { _, _ in
            consumeDraftRequest()
        }
        .sheet(item: $editingJob) { job in
            AutomationEditorView(
                job: job,
                projects: store.projects,
                skills: availableSkills,
                onSave: { scheduler.upsert($0) }
            )
        }
        .alert("删除自动任务？", isPresented: Binding(
            get: { pendingDelete != nil },
            set: { if !$0 { pendingDelete = nil } }
        )) {
            Button("删除", role: .destructive) {
                if let pendingDelete { scheduler.delete(id: pendingDelete.id) }
                pendingDelete = nil
            }
            Button("取消", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("这只会删除计划，不会删除已经产生的会话。")
        }
    }

    private func consumeDraftRequest() {
        guard let request = AutomationDraftRequestCoordinator.consume(
            &store.automationDraftRequest
        ) else { return }
        editingJob = newDraft(prompt: request.prompt)
    }

    private var availableSkills: [String] {
        ToolSkillCatalog.skills(from: store.currentSession?.availableCommands ?? []).map(\.name)
    }

    private func newDraft(prompt: String) -> AutomationJob {
        let project = store.selectedProject ?? store.projects.first
        let normalizedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = normalizedPrompt.isEmpty ? "新自动任务" : String(normalizedPrompt.prefix(32))
        return AutomationJob(
            title: title,
            projectPath: project?.path ?? "",
            prompt: normalizedPrompt,
            schedule: .once(Date().addingTimeInterval(3600))
        )
    }

    @ViewBuilder
    private func jobRow(_ job: AutomationJob) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: job.enabled ? "clock.badge.checkmark" : "pause.circle")
                .foregroundStyle(job.enabled ? Color.accentColor : Color.secondary)
                .font(.title3)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(job.title).font(.headline)
                    if job.claim != nil {
                        ProgressView().controlSize(.small)
                        Text("运行中").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(job.prompt)
                    .font(.callout)
                    .lineLimit(2)
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(job.schedule.displayName)
                    if let next = job.nextRunAt, job.enabled {
                        Text("下次：\(next.formatted(date: .abbreviated, time: .shortened))")
                    } else if !job.enabled {
                        Text("已暂停")
                    }
                    if let outcome = job.lastOutcome {
                        Text(outcome.status == .succeeded ? "上次成功" : "上次：\(outcome.status.displayName)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let outcome = job.lastOutcome, !outcome.summary.isEmpty {
                    Text(outcome.summary).font(.caption).lineLimit(2)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 7) {
                HStack(spacing: 6) {
                    Button("立即运行") { scheduler.runNow(id: job.id) }
                        .disabled(job.claim != nil)
                    Button(job.enabled ? "暂停" : "继续") {
                        scheduler.setEnabled(!job.enabled, id: job.id)
                    }
                }
                HStack(spacing: 6) {
                    Button("编辑") { editingJob = job }
                    Button("删除", role: .destructive) { pendingDelete = job }
                }
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 6)
    }
}

private extension AutomationOutcome.Status {
    var displayName: String {
        switch self {
        case .succeeded: return "成功"
        case .failed: return "失败"
        case .interrupted: return "已中断"
        case .timedOut: return "超时"
        }
    }
}

private struct AutomationEditorView: View {
    private enum ScheduleKind: String, CaseIterable, Identifiable {
        case once = "一次"
        case daily = "每天"
        case weekly = "每周"
        case interval = "固定间隔"
        var id: String { rawValue }
    }

    @Environment(\.dismiss) private var dismiss
    @State private var draft: AutomationJob
    @State private var kind: ScheduleKind
    @State private var date: Date
    @State private var weekday: Int
    @State private var intervalHours: Double
    let projects: [URL]
    let skills: [String]
    let onSave: (AutomationJob) -> Void

    init(job: AutomationJob, projects: [URL], skills: [String], onSave: @escaping (AutomationJob) -> Void) {
        _draft = State(initialValue: job)
        self.projects = projects
        self.skills = skills
        self.onSave = onSave
        let calendar = Calendar.current
        switch job.schedule {
        case .once(let scheduled):
            _kind = State(initialValue: .once)
            _date = State(initialValue: scheduled)
            _weekday = State(initialValue: calendar.component(.weekday, from: scheduled))
            _intervalHours = State(initialValue: 1)
        case .daily(let hour, let minute):
            _kind = State(initialValue: .daily)
            _date = State(initialValue: calendar.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date())
            _weekday = State(initialValue: 2)
            _intervalHours = State(initialValue: 1)
        case .weekly(let day, let hour, let minute):
            _kind = State(initialValue: .weekly)
            _date = State(initialValue: calendar.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date())
            _weekday = State(initialValue: day)
            _intervalHours = State(initialValue: 1)
        case .interval(let seconds):
            _kind = State(initialValue: .interval)
            _date = State(initialValue: Date().addingTimeInterval(seconds))
            _weekday = State(initialValue: 2)
            _intervalHours = State(initialValue: max(0.25, seconds / 3600))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("确认自动任务").font(.headline)
                Spacer()
                Button("取消") { dismiss() }
                Button("保存") {
                    draft.schedule = resolvedSchedule
                    draft.nextRunAt = resolvedSchedule.nextDate(after: Date().addingTimeInterval(-1))
                    onSave(draft)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canSave)
            }
            Form {
                TextField("名称", text: $draft.title)
                Picker("项目", selection: $draft.projectPath) {
                    ForEach(projects, id: \.path) { project in
                        Text(project.lastPathComponent).tag(project.path)
                    }
                }
                TextEditor(text: $draft.prompt)
                    .font(.body)
                    .frame(minHeight: 110)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.secondary.opacity(0.25)))
                Picker("计划", selection: $kind) {
                    ForEach(ScheduleKind.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                scheduleFields
                Picker("Skill（可选）", selection: Binding(
                    get: { draft.skillName ?? "" },
                    set: { draft.skillName = $0.isEmpty ? nil : $0 }
                )) {
                    Text("不指定").tag("")
                    ForEach(skills, id: \.self) { Text($0).tag($0) }
                }
                Text("Skill 会在独立会话启动后核验；若当时不可用，任务会明确失败并提醒，不会悄悄改成普通提示词。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Toggle("启用", isOn: $draft.enabled)
            }
            Text("计划保存在本机 Application Support。任务只会在 Pipi 运行时触发；不会继承以往聊天授予的路径访问权限。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(width: 600, height: 520)
    }

    @ViewBuilder
    private var scheduleFields: some View {
        switch kind {
        case .once:
            DatePicker("执行时间", selection: $date)
        case .daily:
            DatePicker("每天时间", selection: $date, displayedComponents: .hourAndMinute)
        case .weekly:
            Picker("星期", selection: $weekday) {
                ForEach(Array(Calendar.current.weekdaySymbols.enumerated()), id: \.offset) { index, name in
                    Text(name).tag(index + 1)
                }
            }
            DatePicker("执行时间", selection: $date, displayedComponents: .hourAndMinute)
        case .interval:
            HStack {
                Text("每")
                TextField("小时", value: $intervalHours, format: .number.precision(.fractionLength(0...2)))
                    .frame(width: 80)
                Text("小时（最短 15 分钟）")
            }
        }
    }

    private var resolvedSchedule: AutomationSchedule {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        switch kind {
        case .once: return .once(date)
        case .daily: return .daily(hour: components.hour ?? 9, minute: components.minute ?? 0)
        case .weekly: return .weekly(weekday: weekday, hour: components.hour ?? 9, minute: components.minute ?? 0)
        case .interval: return .interval(max(AutomationSchedule.minimumInterval, intervalHours * 3600))
        }
    }

    private var canSave: Bool {
        !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draft.projectPath.isEmpty
            && projects.contains(where: { $0.path == draft.projectPath })
            && !draft.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (kind != .once || date > Date())
    }
}
