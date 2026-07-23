import SwiftUI

struct SidebarView: View {
    @EnvironmentObject var store: AppStore
    @State private var renameTarget: RenameTarget?
    @State private var renameText: String = ""
    /// Per-project expand state for the archived section; missing key = collapsed.
    @State private var archivedExpandedByProject: [String: Bool] = [:]

    /// List 在 tag 短暂缺失时会把 selection 清成 nil；open 中的会话拒绝被这样清掉。
    private var selectionBinding: Binding<String?> {
        Binding(
            get: { store.selectedSessionKey },
            set: { newValue in
                if newValue == nil,
                   let old = store.selectedSessionKey,
                   store.openSessions[old] != nil {
                    return
                }
                store.selectedSessionKey = newValue
            }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            BrandMark(size: .sidebar)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)
            List(selection: selectionBinding) {
                projectsSection
                if let project = store.selectedProject {
                    sessionsSection(project: project)
                    archivedSessionsSection(project: project)
                }
            }
            .listStyle(.sidebar)
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
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
                HStack(spacing: 6) {
                    Image(systemName: "folder")
                        .foregroundStyle(project.path == store.selectedProjectPath ? Color.accentColor : .secondary)
                    Text(project.lastPathComponent)
                        .fontWeight(project.path == store.selectedProjectPath ? .semibold : .regular)
                    Spacer(minLength: 0)
                    Text("\(store.sessionsByProject[project.path]?.count ?? 0)")
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    store.selectedProjectPath = project.path
                    store.refreshSessions(for: project)
                }
                .contextMenu {
                    Button("在 Finder 中显示") {
                        NSWorkspace.shared.activateFileViewerSelecting([project])
                    }
                    Button("移除项目", role: .destructive) {
                        store.removeProject(project)
                    }
                }
                .hoverRowBackground()
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
        // Selection fill lives in listRowBackground so it replaces system sidebar chrome
        // (Color.clear does not). Hover fill stays inside SessionRowContainer only.
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
        .tag(tag)
        .listRowBackground(
            RoundedRectangle(cornerRadius: 6)
                .fill(store.selectedSessionKey == tag ? Color.accentColor.opacity(0.12) : Color.clear)
                .padding(.horizontal, 4)
        )
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
/// Hover fill only; selected fill is drawn via listRowBackground on the List row.
private struct SessionRowContainer<Content: View>: View {
    let isSelected: Bool
    let onSelect: () -> Void
    let onRename: () -> Void
    let onArchive: (() -> Void)?
    @ViewBuilder var content: (_ isHovered: Bool) -> Content

    @State private var isHovered = false

    /// Hover-only; selection highlight is owned by the row's listRowBackground.
    private var rowFill: Color {
        if isHovered && !isSelected {
            return Color.primary.opacity(0.06)
        }
        return .clear
    }

    var body: some View {
        // Non-Button hit target + overlay action Buttons (no nested Button).
        // On hover, content hides its trailing subtitle so actions own that corner.
        content(isHovered)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(perform: onSelect)
            .padding(.vertical, 2)
            .padding(.horizontal, 4)
            .background {
                RoundedRectangle(cornerRadius: 6)
                    .fill(rowFill)
            }
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
    }
}

/// Sidebar-only session indicator. Priority: running > error > unseen-ok/green > none.
private enum SessionRowStatus: Equatable {
    case running
    case error
    case ok
    case none

    static func from(_ session: ChatSession) -> SessionRowStatus {
        if session.isWorking { return .running }
        if session.lastError != nil || !session.processAlive { return .error }
        if session.hasUnseenCompletion { return .ok }
        return .none
    }
}

/// Observes a live ChatSession so status dots update without reselection.
private struct LiveSessionRow: View {
    @ObservedObject var session: ChatSession
    /// Fallback when session.sessionName is nil/empty (e.g. disk meta name).
    let fallbackTitle: String
    /// Shown when not running (e.g. relative modified time). Empty for unsaved new sessions.
    let idleSubtitle: String
    /// Hide trailing caption while hover actions occupy that corner.
    var hideSubtitle: Bool = false

    var body: some View {
        let status = SessionRowStatus.from(session)
        // Prefer non-empty live name so disk meta still shows when sessionName unset.
        let title = session.sessionName.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackTitle
        let subtitle = status == .running ? "进行中" : idleSubtitle
        HStack(spacing: 8) {
            // Keep status column width stable so titles don't shift
            statusIndicator(status)
                .frame(width: 10, height: 10)
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
                .frame(width: 10, height: 10)
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
                .frame(width: 10, height: 10)
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
                .frame(width: 10, height: 10)
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
