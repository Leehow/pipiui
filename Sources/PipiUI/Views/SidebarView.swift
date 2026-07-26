import SwiftUI

struct SidebarView: View {
    @EnvironmentObject var store: AppStore
    @State private var renameTarget: RenameTarget?
    @State private var renameText: String = ""
    @State private var projectRenameTarget: ProjectRenameTarget?
    @State private var projectRenameText: String = ""
    @State private var archivedExpanded = false
    @State private var projectsExpanded = false
    @State private var pinnedExpanded = false
    /// Project folders can be opened independently. The selected project is
    /// always opened when it is selected, but opening one folder never closes
    /// another.
    @State private var expandedProjectPaths: Set<String> = []
    /// The active-session cap is applied independently inside each project
    /// folder, so one project's "更多" does not affect the others.
    @State private var sessionsExpandedByProject: [String: Bool] = [:]

    /// Shared leading gutter — `.sidebar` List defaults are wider than needed.
    private static let sidebarGutter: CGFloat = 10

    var body: some View {
        VStack(spacing: 0) {
            BrandMark(size: .sidebar)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Self.sidebarGutter + 2)
                .padding(.top, 14)
                .padding(.bottom, 10)
            // ScrollView keeps the sidebar's manual-scroll behavior while the
            // hidden indicator avoids reserving a wide AppKit track on hover.
            // Selection chrome is drawn by SessionRowContainer.background.
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    pinnedSection
                    projectsSection
                    archivedSessionsSection
                }
                .padding(.horizontal, Self.sidebarGutter)
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
            .clipShape(Rectangle())
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        .safeAreaInset(edge: .bottom) {
            HStack {
                Button {
                    store.showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.body)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(HoverButtonStyle())
                .help("设置")
                .accessibilityLabel("设置")

                Spacer(minLength: 0)
            }
            .padding(.horizontal, Self.sidebarGutter + 2)
            .padding(.vertical, 12)
            .background(.bar)
        }
        .onAppear {
            syncProjectsExpansion()
        }
        .onChange(of: store.selectedProjectPath) { _, _ in
            syncProjectsExpansion()
        }
        .onChange(of: store.projects.map(\.path)) { _, _ in
            syncProjectsExpansion()
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
        .sheet(item: $projectRenameTarget) { target in
            VStack(alignment: .leading, spacing: 16) {
                Text("编辑项目名称")
                    .font(.headline)
                TextField("项目名称", text: $projectRenameText)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("取消") { projectRenameTarget = nil }
                        .keyboardShortcut(.cancelAction)
                    Button("保存") {
                        store.renameProject(target.project, to: projectRenameText)
                        projectRenameTarget = nil
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(projectRenameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(20)
            .frame(width: 360)
        }
    }

    /// Ensures the selected project stays visible and open even when selection
    /// came from search/restore rather than a currently visible folder row.
    private func syncProjectsExpansion() {
        guard let path = store.selectedProjectPath else { return }
        expandedProjectPaths.insert(path)
        guard !projectsExpanded else { return }
        guard let index = store.orderedProjects.firstIndex(where: { $0.path == path }) else { return }
        if index >= SidebarListLimits.projects {
            projectsExpanded = true
        }
    }

    private var projectsSection: some View {
        sidebarSection("项目") {
            Button {
                store.addProjectViaPanel()
            } label: {
                Image(systemName: "folder.badge.plus")
            }
            .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
            .help("添加项目")
            .accessibilityLabel("添加项目")
        } rows: {
            let capped = SidebarListLimits.visiblePrefix(
                of: store.orderedProjects,
                limit: SidebarListLimits.projects,
                expanded: projectsExpanded
            )
            ForEach(capped.items, id: \.path) { project in
                projectFolderRow(project)
                if expandedProjectPaths.contains(project.path) {
                    projectSessionChildren(project)
                }
            }
            if capped.showsToggle {
                moreToggle(expanded: $projectsExpanded, sectionName: "项目")
            }
        }
    }

    /// A project is a folder in the sidebar tree. Its primary row both selects
    /// and toggles the folder, avoiding a tiny disclosure-only hit target.
    @ViewBuilder
    private func projectFolderRow(_ project: URL) -> some View {
        let isSelected = project.path == store.selectedProjectPath
        let isExpanded = expandedProjectPaths.contains(project.path)
        let isPinned = store.isProjectPinned(project)
        let displayName = store.projectDisplayName(for: project)
        HStack(spacing: 6) {
            Button {
                selectAndToggleProject(project, wasSelected: isSelected, wasExpanded: isExpanded)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "folder.fill" : "folder")
                        .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                    Text(displayName)
                        .fontWeight(isSelected ? .semibold : .regular)
                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("已置顶项目")
                    }
                    Spacer(minLength: 0)
                    Text("\(store.sessionsByProject[project.path]?.count ?? 0)")
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(isExpanded ? "收起" : "展开")项目\(displayName)")

            Menu {
                Button(isPinned ? "取消置顶项目" : "置顶项目") {
                    store.toggleProjectPin(project)
                }
                Button("在 Finder 中显示") {
                    NSWorkspace.shared.activateFileViewerSelecting([project])
                }
                Button("编辑项目名称") {
                    projectRenameText = displayName
                    projectRenameTarget = ProjectRenameTarget(project: project)
                }
                Button("移除项目", role: .destructive) {
                    store.removeProject(project)
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.caption.weight(.semibold))
                    .frame(width: 20, height: 20)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .help("项目菜单")
            .accessibilityLabel("项目菜单\(displayName)")

            Button {
                selectProject(project)
                store.newSession(project: project)
            } label: {
                Image(systemName: "plus")
                    .font(.caption.weight(.semibold))
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
            .help("新建会话")
            .accessibilityLabel("在\(displayName)中新建会话")
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .background {
            RoundedRectangle(cornerRadius: 7)
                .fill(isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
        }
        .hoverRowBackground(cornerRadius: 7)
    }

    private func selectProject(_ project: URL) {
        expandedProjectPaths.insert(project.path)
        store.selectedProjectPath = project.path
        store.refreshSessions(for: project)
    }

    private func selectAndToggleProject(_ project: URL, wasSelected: Bool, wasExpanded: Bool) {
        store.selectedProjectPath = project.path
        store.refreshSessions(for: project)
        if wasSelected && wasExpanded {
            expandedProjectPaths.remove(project.path)
        } else {
            expandedProjectPaths.insert(project.path)
        }
    }

    @ViewBuilder
    private var pinnedSection: some View {
        let pinned: [(SessionMeta, URL)] = store.pinnedSessionMetas.compactMap { meta in
            guard let project = store.project(forSessionPath: meta.path) else { return nil }
            return (meta, project)
        }
        if !pinned.isEmpty {
            sidebarSection("置顶") {
                EmptyView()
            } rows: {
                let capped = SidebarListLimits.visiblePrefix(
                    of: pinned,
                    limit: SidebarListLimits.pinned,
                    expanded: pinnedExpanded
                )
                ForEach(capped.items, id: \.0.path) { meta, project in
                    let openKey = openKeyFor(meta: meta) ?? "resume:\(meta.path)"
                    let live = openKeyFor(meta: meta).flatMap { store.openSessions[$0] }
                    sessionRow(
                        tag: openKey,
                        onSelect: {
                            store.selectedProjectPath = project.path
                            store.openSession(meta, project: project)
                        },
                        live: live,
                        fallbackTitle: meta.name,
                        idleSubtitle: store.projectDisplayName(for: project),
                        meta: meta,
                        openKey: openKeyFor(meta: meta),
                        project: project,
                        archivePath: meta.path,
                        isPinned: true
                    )
                }
                if capped.showsToggle {
                    moreToggle(expanded: $pinnedExpanded, sectionName: "置顶")
                }
            }
        }
    }

    /// Active session rows live directly under their project folder. There is
    /// deliberately no standalone active-session section.
    private func projectSessionChildren(_ project: URL) -> some View {
        let metas = SessionPinLogic.activeMetas(
            from: store.sessionsByProject[project.path] ?? [],
            excludingPinned: store.userPinnedSessionPaths
        )
        let news = newSessionEntries(project: project)
        let sessionsExpanded = Binding(
            get: { sessionsExpandedByProject[project.path] ?? false },
            set: { sessionsExpandedByProject[project.path] = $0 }
        )
        let visibleCounts = SidebarListLimits.splitVisibleCounts(
            leadingCount: news.count,
            trailingCount: metas.count,
            limit: SidebarListLimits.sessions,
            expanded: sessionsExpanded.wrappedValue
        )
        let visibleNews = Array(news.prefix(visibleCounts.leading))
        let visibleMetas = Array(metas.prefix(visibleCounts.trailing))
        return VStack(alignment: .leading, spacing: 0) {
            // 未落盘，或已有 sessionFile 但 metas 尚未代表该 path 的 new:*（交接空窗）
            ForEach(visibleNews, id: \.0) { key, session in
                sessionRow(
                    tag: key,
                    onSelect: { store.selectedSessionKey = key },
                    live: session,
                    fallbackTitle: "新会话",
                    idleSubtitle: "",
                    meta: nil,
                    openKey: key,
                    project: project,
                    archivePath: session.sessionFile,
                    isPinned: false
                )
            }

            ForEach(visibleMetas) { meta in
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
                    archivePath: meta.path,
                    isPinned: false
                )
            }
            if visibleCounts.showsToggle {
                moreToggle(expanded: sessionsExpanded, sectionName: "\(store.projectDisplayName(for: project)) 会话")
            }
        }
    }

    /// Trailing bleed so header actions clear the sidebar divider (~列表行内边距对齐).
    private static let sectionHeaderTrailingBleed: CGFloat = 12

    private func sidebarSection<Trailing: View, Rows: View>(
        _ title: String,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder rows: () -> Rows
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .tracking(0.5)
                Spacer(minLength: 0)
                trailing()
            }
            .padding(.top, 14)
            .padding(.bottom, 6)
            .padding(.horizontal, 6)
            .padding(.trailing, Self.sectionHeaderTrailingBleed)

            rows()
        }
    }

    @ViewBuilder
    private func moreToggle(expanded: Binding<Bool>, sectionName: String) -> some View {
        Button(expanded.wrappedValue ? "收起" : "更多") {
            expanded.wrappedValue.toggle()
        }
        .buttonStyle(.plain)
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityLabel(expanded.wrappedValue ? "收起\(sectionName)" : "展开更多\(sectionName)")
    }

    @ViewBuilder
    private var archivedSessionsSection: some View {
        let archived = store.archivedSessionMetas
        if !archived.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    archivedExpanded.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: archivedExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 10)
                        Text("已归档")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .tracking(0.5)
                        Spacer(minLength: 0)
                        Text("\(archived.count)")
                            .font(.subheadline)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.top, 14)
                    .padding(.bottom, 6)
                    .padding(.horizontal, 6)
                    .padding(.trailing, Self.sectionHeaderTrailingBleed)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if archivedExpanded {
                    ForEach(archived, id: \.meta.path) { entry in
                        let meta = entry.meta
                        let project = entry.project
                        Button {
                            store.restoreSession(meta, project: project)
                        } label: {
                            SessionRow(
                                title: meta.name,
                                subtitle: "\(store.projectDisplayName(for: project)) · \(Self.relative(meta.modified))",
                                status: .none
                            )
                            .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("取消归档") {
                                store.unarchiveSession(path: meta.path, project: project)
                            }
                            Button("取消归档并打开") {
                                store.restoreSession(meta, project: project)
                            }
                        }
                        .padding(.vertical, 5)
                        .padding(.horizontal, 6)
                        .hoverRowBackground(cornerRadius: 7)
                    }
                }
            }
        }
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
        archivePath: String?,
        isPinned: Bool
    ) -> some View {
        let titleForRename: String = {
            if let live, let name = live.sessionName, !name.isEmpty { return name }
            if let meta { return displayTitle(meta: meta, openKey: openKey) }
            return fallbackTitle
        }()

        // 主区域点选 + 尾部操作按钮，避免整行单一 Button 吞掉子按钮点击
        // hover/selected 背景由 SessionRowContainer.background 单层绘制。
        SessionRowContainer(
            isSelected: store.selectedSessionKey == tag,
            onSelect: onSelect,
            onPin: archivePath.map { path in
                { store.togglePinSession(path: path) }
            },
            isPinned: isPinned,
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
                let interrupted = store.interruptedSessionPaths.contains(meta.path)
                SessionRow(
                    title: displayTitle(meta: meta, openKey: openKey),
                    subtitle: interrupted ? "已中断" : idleSubtitle,
                    status: interrupted ? .interrupted : .none,
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
            if let archivePath {
                Button(isPinned ? "取消置顶" : "置顶") {
                    store.togglePinSession(path: archivePath)
                }
            }
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
                    // Pinned live files belong only in the pinned section.
                    if store.isSessionPinned(file) { return false }
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

private struct ProjectRenameTarget: Identifiable {
    let project: URL
    var id: String { project.path }
}

/// 行容器：左侧点选主区域 + hover 时右侧置顶/改名/归档，避免嵌套 Button 抢事件。
/// Hover 与 selected 共享同一层背景（全宽、圆角），避免两层。
private struct SessionRowContainer<Content: View>: View {
    let isSelected: Bool
    let onSelect: () -> Void
    let onPin: (() -> Void)?
    let isPinned: Bool
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
            .padding(.vertical, 5)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
            .onTapGesture(perform: onSelect)
            .overlay(alignment: .trailing) {
                HStack(spacing: 4) {
                    if let onPin {
                        Button(action: onPin) {
                            Image(systemName: isPinned ? "pin.fill" : "pin")
                                .font(.system(size: 11, weight: .medium))
                                .frame(width: 20, height: 20)
                        }
                        .buttonStyle(HoverButtonStyle(base: .secondary, hovered: .primary))
                        .help(isPinned ? "取消置顶" : "置顶")
                        .accessibilityLabel(isPinned ? "取消置顶" : "置顶")
                    }

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
                .padding(.trailing, 6)
                .opacity(isHovered ? 1 : 0)
                .allowsHitTesting(isHovered)
                .accessibilityHidden(!isHovered)
            }
            .onHover { isHovered = $0 }
            .animation(.easeInOut(duration: 0.12), value: isHovered)
            .animation(.easeInOut(duration: 0.12), value: isSelected)
            // 单层全宽背景：hover 与 selected 同源同几何（ScrollView 行，非 List）。
            .background {
                RoundedRectangle(cornerRadius: 7)
                    .fill(isSelected ? Color.accentColor.opacity(0.12)
                                     : (isHovered ? Color.primary.opacity(0.06) : Color.clear))
                    .padding(.horizontal, 2)
            }
    }
}

/// Sidebar-only session indicator.
/// Priority: main running > background subagents > error > interrupted > unseen-ok/green > none.
private enum SessionRowStatus: Equatable {
    case running
    case subagentsRunning(Int)
    case error
    case interrupted
    case ok
    case none

    static func from(_ session: ChatSession) -> SessionRowStatus {
        if session.isWorking { return .running }
        let n = session.subagents.runningCount
        if n > 0 { return .subagentsRunning(n) }
        if session.lastError != nil || !session.processAlive { return .error }
        if session.hasUnseenInterruption { return .interrupted }
        if session.hasUnseenCompletion { return .ok }
        return .none
    }

    var subtitleOverride: String? {
        switch self {
        case .running: return "进行中"
        case .subagentsRunning(let n):
            return n > 1 ? "\(n) 个子任务" : "子任务中"
        case .interrupted: return "已中断"
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
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
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
        case .error, .interrupted:
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
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
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
        case .error, .interrupted:
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
