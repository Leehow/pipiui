import SwiftUI

struct SidebarView: View {
    @EnvironmentObject var store: AppStore
    @State private var renameTarget: RenameTarget?
    @State private var renameText: String = ""
    @State private var showSettings = false
    /// Per-project expand state for the archived section; missing key = collapsed.
    @State private var archivedExpandedByProject: [String: Bool] = [:]

    var body: some View {
        VStack(spacing: 0) {
            BrandMark(size: .sidebar)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)
            // 普通 List（无 selection）：选中态由 store.selectedSessionKey 驱动，
            // 背景由 SessionRowContainer 的 listRowBackground 单层绘制。
            // 不用 List(selection:) 是为了避开 .sidebar 的系统选中 chrome——
            // 它会在我们的 listRowBackground 之外再叠一层全宽底，形成“两层背景”。
            List {
                projectsSection
                if let project = store.selectedProject {
                    sessionsSection(project: project)
                    archivedSessionsSection(project: project)
                }
            }
            .listStyle(.sidebar)
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 8) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.body)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(HoverButtonStyle())
                .help("设置")
                .accessibilityLabel("设置")

                Spacer(minLength: 0)

                Toggle(isOn: $store.bossModeEnabled) {
                    Label("Boss", systemImage: "crown")
                        .font(.callout)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Boss 模式：新会话以大组长协议启动——不亲自干活，按难度分派 subagent（简单派单兵、复杂派组长、调研扇出），配合反早停失败恢复协议")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.bar)
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet()
                .environmentObject(store)
        }
        .sheet(item: $renameTarget) { target in
            VStack(alignment: .leading, spacing: 16) {
                Text("修改标题")
                    .font(.headline)
                TextField("会话标题", text: $renameText)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("取消") { renameTarget = nil }
                        .keyboardShortcut(.cancelAction)
                    Button("保存") {
                        store.renameSession(
                            meta: target.meta,
                            openKey: target.openKey,
                            project: target.project,
                            to: renameText
                        )
                        renameTarget = nil
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(20)
            .frame(width: 360)
        }
    }

    private var projectsSection: some View {
        Section {
            ForEach(store.projects, id: \.path) { project in
                let isSelected = project.path == store.selectedProjectPath
                SessionRowContainer(
                    isSelected: isSelected,
                    onSelect: {
                        store.selectedProjectPath = project.path
                        store.refreshSessions(for: project)
                    },
                    onRename: { },
                    onArchive: nil
                ) { _ in
                    HStack(spacing: 6) {
                        Image(systemName: "folder")
                            .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                        Text(project.lastPathComponent)
                            .fontWeight(isSelected ? .semibold : .regular)
                        Spacer(minLength: 0)
                        Text("\(store.sessionsByProject[project.path]?.count ?? 0)")
                            .foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contextMenu {
                    Button("在 Finder 中显示") {
                        NSWorkspace.shared.activateFileViewerSelecting([project])
                    }
                    Button("移除项目", role: .destructive) {
                        store.removeProject(project)
                    }
                }
            }
        } header: {
            HStack {
                Text("项目")
                Spacer()
                Button {
                    store.addProjectViaPanel()
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
                .help("添加项目")
                .accessibilityLabel("添加项目")
            }
        }
    }

    private func sessionsSection(project: URL) -> some View {
        let metas = store.sessionsByProject[project.path] ?? []
        return Section {
            // 未落盘，或已有 sessionFile 但 metas 尚未代表该 path 的 new:*（交接空窗）
            ForEach(newSessionEntries(project: project), id: \.0) { key, session in
                sessionRow(
                    tag: key,
                    onSelect: { store.selectedSessionKey = key },
                    live: session,
                    fallbackTitle: "新会话",
                    idleSubtitle: "",
                    meta: nil,
                    openKey: key,
                    project: project,
                    archivePath: session.sessionFile
                )
            }

            ForEach(metas) { meta in
                let openKey = openKeyFor(meta: meta) ?? "resume:\(meta.path)"
                let live = openKeyFor(meta: meta).flatMap { store.openSessions[$0] }
                sessionRow(
                    tag: openKey,
                    onSelect: { store.openSession(meta, project: project) },
                    live: live,
                    fallbackTitle: meta.name,
                    idleSubtitle: Self.relative(meta.modified),
                    meta: meta,
                    openKey: openKeyFor(meta: meta),
                    project: project,
                    archivePath: meta.path
                )
            }
        } header: {
            HStack {
                Text("会话")
                Spacer()
                Button {
                    store.newSession(project: project)
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
                .help("新建会话")
                .accessibilityLabel("新建会话")
            }
        }
    }

    @ViewBuilder
    private func archivedSessionsSection(project: URL) -> some View {
        let archived = store.archivedByProject[project.path] ?? []
        if !archived.isEmpty {
            Section(isExpanded: archivedExpandedBinding(for: project.path)) {
                ForEach(archived) { meta in
                    Button {
                        store.restoreSession(meta, project: project)
                    } label: {
                        SessionRow(
                            title: meta.name,
                            subtitle: Self.relative(meta.modified),
                            status: .none
                        )
                        .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .selectionDisabled(true)
                    .contextMenu {
                        Button("取消归档") {
                            store.unarchiveSession(path: meta.path, project: project)
                        }
                        Button("取消归档并打开") {
                            store.restoreSession(meta, project: project)
                        }
                    }
                    // Match SessionRowContainer insets so time captions share trailing x.
                    .padding(.vertical, 2)
                    .padding(.horizontal, 4)
                    .hoverRowBackground()
                }
            } header: {
                HStack {
                    Text("已归档")
                    Spacer()
                    Text("\(archived.count)")
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    /// Default collapsed (`false`) when project has no remembered expand state.
    private func archivedExpandedBinding(for projectPath: String) -> Binding<Bool> {
        Binding(
            get: { archivedExpandedByProject[projectPath] ?? false },
            set: { archivedExpandedByProject[projectPath] = $0 }
        )
    }

    @ViewBuilder
    private func sessionRow(
        tag: String,
        onSelect: @escaping () -> Void,
        live: ChatSession?,
        fallbackTitle: String,
        idleSubtitle: String,
        meta: SessionMeta?,
        openKey: String?,
        project: URL,
        archivePath: String?
    ) -> some View {
        let titleForRename: String = {
            if let live, let name = live.sessionName, !name.isEmpty { return name }
            if let meta { return displayTitle(meta: meta, openKey: openKey) }
            return fallbackTitle
        }()

        // 主区域点选 + 尾部操作按钮，避免整行单一 Button 吞掉子按钮点击
        // hover/selected 背景统一由 SessionRowContainer 内的 listRowBackground 单层绘制。
        SessionRowContainer(
            isSelected: store.selectedSessionKey == tag,
            onSelect: onSelect,
            onRename: {
                beginRename(
                    id: meta?.path ?? tag,
                    project: project,
                    meta: meta,
                    openKey: openKey ?? (tag.hasPrefix("new:") || tag.hasPrefix("resume:") ? tag : nil),
                    currentTitle: titleForRename
                )
            },
            onArchive: archivePath.map { path in
                { store.archiveSession(path: path, project: project) }
            }
        ) { isHovered in
            if let live {
                LiveSessionRow(
                    session: live,
                    fallbackTitle: fallbackTitle,
                    idleSubtitle: idleSubtitle,
                    hideSubtitle: isHovered
                )
            } else if let meta {
                SessionRow(
                    title: displayTitle(meta: meta, openKey: openKey),
                    subtitle: idleSubtitle,
                    status: .none,
                    hideSubtitle: isHovered
                )
            } else {
                SessionRow(
                    title: fallbackTitle,
                    subtitle: idleSubtitle,
                    status: .none,
                    hideSubtitle: isHovered
                )
            }
        }
        .contextMenu {
            Button("修改标题…") {
                beginRename(
                    id: meta?.path ?? tag,
                    project: project,
                    meta: meta,
                    openKey: openKey ?? (tag.hasPrefix("new:") || tag.hasPrefix("resume:") ? tag : nil),
                    currentTitle: titleForRename
                )
            }
            if let archivePath {
                Button("归档会话") {
                    store.archiveSession(path: archivePath, project: project)
                }
            }
        }
    }

    private func displayTitle(meta: SessionMeta, openKey: String?) -> String {
        if let openKey, let live = store.openSessions[openKey]?.sessionName, !live.isEmpty {
            return live
        }
        return meta.name
    }

    private func beginRename(id: String, project: URL, meta: SessionMeta?, openKey: String?, currentTitle: String) {
        renameText = currentTitle
        renameTarget = RenameTarget(id: id, project: project, meta: meta, openKey: openKey)
    }

    /// new:* 在尚未被 metas 用 sessionFile 路径代表时始终展示（含已有 file 但扫盘未到的交接期）。
    private func newSessionEntries(project: URL) -> [(String, ChatSession)] {
        let metaPaths = Set((store.sessionsByProject[project.path] ?? []).map(\.path))
        return store.openSessions
            .filter { key, session in
                guard key.hasPrefix("new:") else { return false }
                guard session.projectURL.path == project.path else { return false }
                if let file = session.sessionFile {
                    return !metaPaths.contains(file)
                }
                return true
            }
            .sorted { $0.key < $1.key }
    }

    private func openKeyFor(meta: SessionMeta) -> String? {
        store.openSessions.first { $0.value.sessionFile == meta.path }?.key
            ?? (store.openSessions["resume:\(meta.path)"] != nil ? "resume:\(meta.path)" : nil)
    }

    static func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

private struct RenameTarget: Identifiable {
    let id: String
    let project: URL
    let meta: SessionMeta?
    let openKey: String?
}

/// 行容器：左侧点选主区域 + hover 时右侧改名/归档，避免嵌套 Button 抢事件。
/// Hover 与 selected 共享同一层 `.listRowBackground`（全宽、圆角），避免两层背景。
private struct SessionRowContainer<Content: View>: View {
    let isSelected: Bool
    let onSelect: () -> Void
    let onRename: () -> Void
    let onArchive: (() -> Void)?
    @ViewBuilder var content: (_ isHovered: Bool) -> Content

    @State private var isHovered = false

    var body: some View {
        // Non-Button hit target + overlay action Buttons (no nested Button).
        // On hover, content hides its trailing subtitle so actions own that corner.
        content(isHovered)
            .frame(maxWidth: .infinity, alignment: .leading)
            // padding 先于 contentShape：命中范围扩展到含 padding 的整圈
            .padding(.vertical, 2)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
            .onTapGesture(perform: onSelect)
            .overlay(alignment: .trailing) {
                HStack(spacing: 4) {
                    Button(action: onRename) {
                        Image(systemName: "pencil")
                            .font(.system(size: 11, weight: .medium))
                            .frame(width: 20, height: 20)
                    }
                    .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
                    .help("修改标题")
                    .accessibilityLabel("修改标题")

                    if let onArchive {
                        Button(action: onArchive) {
                            Image(systemName: "archivebox")
                                .font(.system(size: 11, weight: .medium))
                                .frame(width: 20, height: 20)
                        }
                        .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
                        .help("归档会话")
                        .accessibilityLabel("归档会话")
                    }
                }
                .padding(.trailing, 4)
                .opacity(isHovered ? 1 : 0)
                .allowsHitTesting(isHovered)
                .accessibilityHidden(!isHovered)
            }
            .onHover { isHovered = $0 }
            .animation(.easeInOut(duration: 0.12), value: isHovered)
            .animation(.easeInOut(duration: 0.12), value: isSelected)
            // 单层全宽背景：hover 与 selected 同源同几何，避免“hover 特别细 / 选中两层”。
            .listRowBackground(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? Color.accentColor.opacity(0.12)
                                     : (isHovered ? Color.primary.opacity(0.06) : Color.clear))
                    .padding(.horizontal, 4)
            )
    }
}

/// Sidebar-only session indicator.
/// Priority: main running > background subagents > error > unseen-ok/green > none.
private enum SessionRowStatus: Equatable {
    case running
    case subagentsRunning(Int)
    case error
    case ok
    case none

    static func from(_ session: ChatSession) -> SessionRowStatus {
        if session.isWorking { return .running }
        let n = session.subagents.runningCount
        if n > 0 { return .subagentsRunning(n) }
        if session.lastError != nil || !session.processAlive { return .error }
        if session.hasUnseenCompletion { return .ok }
        return .none
    }

    var subtitleOverride: String? {
        switch self {
        case .running: return "进行中"
        case .subagentsRunning(let n):
            return n > 1 ? "\(n) 个子任务" : "子任务中"
        default: return nil
        }
    }
}

/// Observes a live ChatSession so status dots update without reselection.
private struct LiveSessionRow: View {
    @ObservedObject var session: ChatSession
    /// Must observe subagents separately — agent_event updates won't refresh via session alone.
    @ObservedObject private var agents: SubagentStore
    /// Fallback when session.sessionName is nil/empty (e.g. disk meta name).
    let fallbackTitle: String
    /// Shown when not running (e.g. relative modified time). Empty for unsaved new sessions.
    let idleSubtitle: String
    /// Hide trailing caption while hover actions occupy that corner.
    var hideSubtitle: Bool = false

    init(
        session: ChatSession,
        fallbackTitle: String,
        idleSubtitle: String,
        hideSubtitle: Bool = false
    ) {
        self.session = session
        self.agents = session.subagents
        self.fallbackTitle = fallbackTitle
        self.idleSubtitle = idleSubtitle
        self.hideSubtitle = hideSubtitle
    }

    var body: some View {
        // Touch agents.runningCount so SwiftUI tracks SubagentStore publishes.
        let _ = agents.runningCount
        let status = SessionRowStatus.from(session)
        // Prefer non-empty live name so disk meta still shows when sessionName unset.
        let title = session.sessionName.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackTitle
        let subtitle = status.subtitleOverride ?? idleSubtitle
        HStack(spacing: 8) {
            // Keep status column width stable so titles don't shift
            statusIndicator(status)
                .frame(width: 12, height: 12)
            TypewriterText(
                text: title,
                animationToken: session.titleAnimationToken,
                font: .body
            )
            Spacer(minLength: 0)
            if !subtitle.isEmpty, !hideSubtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func statusIndicator(_ status: SessionRowStatus) -> some View {
        switch status {
        case .running:
            ProgressView()
                .controlSize(.mini)
                .scaleEffect(0.55)
                .frame(width: 12, height: 12)
        case .subagentsRunning(let count):
            SubagentsRunningIndicator(count: count)
        case .ok:
            Circle()
                .fill(Color.green)
                .frame(width: 7, height: 7)
        case .error:
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
        case .none:
            Circle()
                .fill(Color.clear)
                .frame(width: 7, height: 7)
                .opacity(0)
        }
    }
}

/// Distinct from main-agent ProgressView spinner: people icon + mild pulse.
private struct SubagentsRunningIndicator: View {
    let count: Int
    @State private var pulse = false

    var body: some View {
        ZStack {
            Image(systemName: "person.2.fill")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.orange)
                .opacity(pulse ? 0.45 : 1.0)
            if count > 1 {
                Text("\(min(count, 9))")
                    .font(.system(size: 6, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 2)
                    .background(Capsule().fill(Color.orange.opacity(0.95)))
                    .offset(x: 5, y: -4)
            }
        }
        .frame(width: 12, height: 12)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
        .accessibilityLabel(count > 1 ? "\(count) 个子任务运行中" : "子任务运行中")
    }
}

private struct SessionRow: View {
    let title: String
    let subtitle: String
    var status: SessionRowStatus = .none
    /// Hide trailing caption while hover actions occupy that corner.
    var hideSubtitle: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            // Keep status column width stable so titles don't shift
            statusIndicator
                .frame(width: 12, height: 12)
            Text(title)
                .lineLimit(1)
            Spacer(minLength: 0)
            if !subtitle.isEmpty, !hideSubtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch status {
        case .running:
            ProgressView()
                .controlSize(.mini)
                .scaleEffect(0.55)
                .frame(width: 12, height: 12)
        case .subagentsRunning(let count):
            SubagentsRunningIndicator(count: count)
        case .ok:
            Circle()
                .fill(Color.green)
                .frame(width: 7, height: 7)
        case .error:
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
        case .none:
            Circle()
                .fill(Color.clear)
                .frame(width: 7, height: 7)
                .opacity(0)
        }
    }
}
