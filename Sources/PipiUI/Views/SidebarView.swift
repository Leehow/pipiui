import SwiftUI
import UniformTypeIdentifiers

struct SidebarView: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject private var computerCoordinator =
        ComputerCoordinator.shared
    @State private var renameTarget: RenameTarget?
    @State private var renameText: String = ""
    @State private var projectRenameTarget: ProjectRenameTarget?
    @State private var projectRenameText: String = ""
    @State private var archivedExpanded = false
    /// Visible row counts for the 项目/置顶 sections: each 「更多」 click adds
    /// `SidebarListLimits.pageSize` rows until everything is shown, then the
    /// same button reads 「收起」 and collapses back to the initial cap.
    @State private var projectsShown = SidebarListLimits.projects
    @State private var pinnedShown = SidebarListLimits.pinned
    /// Project folders can be opened independently. The selected project is
    /// always opened when it is selected, but opening one folder never closes
    /// another.
    @State private var expandedProjectPaths: Set<String> = LayoutPersistence.expandedProjectPaths()
    /// The active-session cap is applied independently inside each project
    /// folder, so one project's "更多" does not affect the others.
    @State private var sessionsShownByProject: [String: Int] = [:]
    /// Settings sheet is presented from this sidebar (window-local): opening it in
    /// one window never opens settings in another window of the same app.
    @State private var showSettings = false
    /// Subagent settings are window-local and open directly to the model tab.
    @State private var showSubagentSettings = false
    /// Remote connection details are also window-local and never alter project
    /// or session selection.
    @State private var showRemoteConnection = false
    /// Computer Use settings open as a window-local sheet, like remote connection.
    @State private var showComputerUseSettings = false
    /// Session search stays in the sidebar: a nonempty global query replaces
    /// the normal tree below this field with its matching sessions.
    @State private var sessionSearchQuery = ""
    @State private var sessionSearchHits: [SessionSearchHit] = []
    @State private var sessionSearchInProgress = false
    @State private var sessionSearchError: String?
    @FocusState private var sessionSearchFocused: Bool

    /// Shared leading gutter — `.sidebar` List defaults are wider than needed.
    private static let sidebarGutter: CGFloat = 10

    var body: some View {
        VStack(spacing: 0) {
            BrandMark(size: .sidebar)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Self.sidebarGutter + 2)
                .padding(.top, 14)
                .padding(.bottom, 10)
            sessionSearchField
            // Thin overlay scroller with automatic indicators, matching the
            // main transcript: it appears/flashes while scrolling and hides
            // when idle. Selection chrome is drawn by
            // SessionRowContainer.background.
            ScrollView {
                // The sidebar has bounded, paged content. A plain stack avoids
                // LazyVStack's repeated size-estimation cycle when scrolling an
                // expanded project tree containing dynamic hoverable rows.
                VStack(alignment: .leading, spacing: 0) {
                    if sessionSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        pinnedSection
                        projectsSection
                        archivedSessionsSection
                    } else {
                        sessionSearchResults
                    }
                }
                .padding(.horizontal, Self.sidebarGutter)
                .padding(.vertical, 8)
                .overlayScrollers()
            }
            .scrollIndicators(.automatic)
            .clipShape(Rectangle())
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        .safeAreaInset(edge: .bottom) {
            HStack {
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

                Button {
                    showComputerUseSettings = true
                } label: {
                    Image(systemName: computerCoordinator.emergencyStopped
                        ? "desktopcomputer.trianglebadge.exclamationmark"
                        : "desktopcomputer")
                        .font(.body)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(HoverButtonStyle(
                    base: store.computerUseEnabled
                        && !computerCoordinator.emergencyStopped
                        ? .accentColor : .secondary,
                    hovered: store.computerUseEnabled
                        && !computerCoordinator.emergencyStopped
                        ? .accentColor : .primary
                ))
                .background {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(store.computerUseEnabled
                            && !computerCoordinator.emergencyStopped
                            ? Color.accentColor.opacity(0.14)
                            : .clear)
                }
                .help("桌面控制设置")
                .accessibilityLabel("桌面控制设置")
                .accessibilityValue(computerCoordinator.emergencyStopped
                    ? "已急停"
                    : (store.computerUseEnabled ? "已开启" : "已关闭"))

                Button {
                    showRemoteConnection = true
                } label: {
                    Image(systemName: "qrcode")
                        .font(.body)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(HoverButtonStyle(
                    base: remoteConnectionButtonColor,
                    hovered: remoteConnectionIndicator == .off ? .primary : remoteConnectionButtonColor
                ))
                .background {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(remoteConnectionButtonBackground)
                }
                .help(RemoteConnectionAccessibility.sidebarButtonLabel)
                .accessibilityLabel(RemoteConnectionAccessibility.sidebarButtonLabel)
                .accessibilityValue(
                    store.remoteRelayConfiguration.enabled
                        ? "Signaling WSS：\(store.remoteRelayState.displayText)；浏览器：\(store.remotePeerProductionState.displayText)"
                        : store.localRemoteStatus
                )

                Button {
                    showSubagentSettings = true
                } label: {
                    Image(systemName: "person.2")
                        .font(.body)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(HoverButtonStyle())
                .help("Subagent 模型")
                .accessibilityLabel("Subagent 模型")

                piUpdateIndicatorButton

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
        .onChange(of: expandedProjectPaths) { _, newValue in
            LayoutPersistence.saveExpandedProjectPaths(newValue)
        }
        .task(id: sessionSearchIdentity) {
            await updateSessionSearch()
        }
        .onExitCommand {
            clearSessionSearch()
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
            // Click on the dimmed overlay discards unsaved input, same as Esc/取消.
            .dismissOnOutsideClick { renameTarget = nil }
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
            // Click on the dimmed overlay discards unsaved input, same as Esc/取消.
            .dismissOnOutsideClick { projectRenameTarget = nil }
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet()
                .environmentObject(store)
                .accessibilityIdentifier("PipiUI.SettingsPanel")
        }
        .sheet(isPresented: $showSubagentSettings) {
            SettingsSheet(initialTab: .subagentModels)
                .environmentObject(store)
                .accessibilityIdentifier("PipiUI.SettingsPanel")
        }
        .sheet(isPresented: $showRemoteConnection) {
            RemoteConnectionSheet()
                .environmentObject(store)
                .dismissOnOutsideClick { showRemoteConnection = false }
        }
        .sheet(isPresented: $showComputerUseSettings) {
            ScrollView {
                ComputerUseSettingsPanel()
                    .environmentObject(store)
                    .padding(22)
            }
            .frame(width: 560)
            .frame(maxHeight: 760)
            .dismissOnOutsideClick { showComputerUseSettings = false }
        }
        .sheet(isPresented: $store.isUpdateCenterPresented) {
            UpdateCenterSheet()
                .environmentObject(store)
        }
    }

    /// Bottom sidebar indicator for any-product update availability.
    @ViewBuilder
    private var piUpdateIndicatorButton: some View {
        if store.isAnyUpdateChecking {
            ProgressView()
                .controlSize(.small)
                .frame(width: 22, height: 22)
                .accessibilityLabel("正在检查更新")
        } else if store.anyUpdateAvailable {
            let names = store.productsWithUpdates.map(\.displayName).joined(separator: "、")
            let detail = store.productsWithUpdates.compactMap { info -> String? in
                guard let latest = info.latestVersion else { return info.displayName }
                return "\(info.displayName) \(latest)"
            }.joined(separator: "、")
            Button {
                store.isUpdateCenterPresented = true
            } label: {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.body)
                    .frame(width: 22, height: 22)
                    .foregroundStyle(Color.orange)
                    .background(alignment: .topTrailing) {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 7, height: 7)
                            .offset(x: 2, y: -2)
                    }
            }
            .buttonStyle(HoverButtonStyle())
            .help("有可用更新 (\(detail))")
            .accessibilityLabel("有可用更新 (\(names))，点击打开更新中心")
        }
    }

    private var remoteConnectionIndicator: LocalRemoteConnectionIndicator {
        if store.remotePeerProductionState == .connected {
            return .listening
        }
        if store.remoteRelayConfiguration.enabled {
            if case .failed = store.remotePeerProductionState {
                return .failed
            }
            switch store.remoteRelayState {
            case .authenticationFailed, .invalidConfiguration, .protocolMismatch:
                return .failed
            case .disabled:
                break
            case .connecting, .retrying:
                return .starting
            case .connected:
                return .listening
            }
        }
        return .resolve(
            enabled: store.localRemoteEnabled,
            url: store.localRemoteURL,
            status: store.localRemoteStatus
        )
    }

    private var remoteConnectionButtonColor: Color {
        switch remoteConnectionIndicator {
        case .off:
            return .secondary
        case .starting:
            return .accentColor
        case .listening:
            return .green
        case .failed:
            return .orange
        }
    }

    private var remoteConnectionButtonBackground: Color {
        switch remoteConnectionIndicator {
        case .off:
            return .clear
        case .starting:
            return Color.accentColor.opacity(0.10)
        case .listening:
            return Color.green.opacity(0.12)
        case .failed:
            return Color.orange.opacity(0.10)
        }
    }

    /// Ensures the selected project stays visible and open even when selection
    /// came from search/restore rather than a currently visible folder row.
    private func syncProjectsExpansion() {
        guard let path = store.selectedProjectPath else { return }
        // Drop persisted folders that no longer exist. Only prune once the
        // project list has loaded so a still-empty list cannot clear the
        // stored preference; the mutation persists via onChange below.
        let knownProjectPaths = Set(store.projects.map(\.path))
        if !knownProjectPaths.isEmpty {
            expandedProjectPaths.formIntersection(knownProjectPaths)
        }
        expandedProjectPaths.insert(path)
        guard let index = store.orderedProjects.firstIndex(where: { $0.path == path }) else { return }
        if index + 1 > projectsShown {
            projectsShown = index + 1
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
                shown: projectsShown
            )
            ForEach(capped.items, id: \.path) { project in
                projectFolderRow(project)
                if expandedProjectPaths.contains(project.path) {
                    projectSessionChildren(project)
                }
            }
            if capped.showsToggle {
                moreToggle(
                    shown: $projectsShown,
                    total: store.orderedProjects.count,
                    limit: SidebarListLimits.projects,
                    sectionName: "项目"
                )
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
        let sessionCount = store.sessionsByProject[project.path]?.count ?? 0
        HStack(spacing: 6) {
            Button {
                selectAndToggleProject(project, wasSelected: isSelected, wasExpanded: isExpanded)
            } label: {
                HStack(spacing: 6) {
                    // Project folders are containers, not primary selection targets:
                    // keep open/toggle behavior but never paint selected-row chrome.
                    Image(systemName: isExpanded ? "folder.fill" : "folder")
                        .foregroundStyle(.secondary)
                    Text(displayName)
                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("已置顶项目")
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(isExpanded ? "收起" : "展开")项目\(displayName)")

            Menu {
                Text("共 \(sessionCount) 个会话")
                Divider()
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
            .pointingHandCursor()

            // New-session button: default engine is resolved by AppStore.newSession
            // from the global JcodeSettings toggle (设置 → 实验 tab).
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
        .onDrag {
            return NSItemProvider(object: project.path as NSString)
        }
        .onDrop(of: [UTType.plainText], delegate: ProjectDropDelegate(project: project, store: store))
        .hoverRowBackground(cornerRadius: 7)
    }

    private func selectProject(_ project: URL) {
        expandedProjectPaths.insert(project.path)
        store.selectedProjectPath = project.path
        store.refreshSessions(for: project)
    }

    private func openSearchHit(_ hit: SessionSearchHit) {
        let project = hit.projectPath.flatMap { path in
            store.projects.first(where: { $0.path == path })
        }
        guard let project else { return }
        expandedProjectPaths.insert(project.path)
        sessionsShownByProject[project.path] = Int.max
        store.selectedProjectPath = project.path
        switch SessionSearch.openAction(for: hit) {
        case .selectLive(let key):
            store.selectedSessionKey = key
        case .openDisk(let meta):
            store.openSession(meta, project: project)
        case .restoreArchived(let meta):
            store.restoreSession(meta, project: project)
        }
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
                    shown: pinnedShown
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
                    moreToggle(
                        shown: $pinnedShown,
                        total: pinned.count,
                        limit: SidebarListLimits.pinned,
                        sectionName: "置顶"
                    )
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
        let sessionsShown = Binding(
            get: { sessionsShownByProject[project.path] ?? SidebarListLimits.sessions },
            set: { sessionsShownByProject[project.path] = $0 }
        )
        let visibleCounts = SidebarListLimits.splitVisibleCounts(
            leadingCount: news.count,
            trailingCount: metas.count,
            limit: SidebarListLimits.sessions,
            shown: sessionsShown.wrappedValue
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
                moreToggle(
                    shown: sessionsShown,
                    total: news.count + metas.count,
                    limit: SidebarListLimits.sessions,
                    sectionName: "\(store.projectDisplayName(for: project)) 会话"
                )
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

    /// 「更多」 reveals one page (10 rows) per click until everything is shown;
    /// at that point the same button reads 「收起」 and collapses back to the cap.
    @ViewBuilder
    private func moreToggle(shown: Binding<Int>, total: Int, limit: Int, sectionName: String) -> some View {
        let collapsed = total > limit && shown.wrappedValue >= total
        Button(collapsed ? "收起" : "更多") {
            if shown.wrappedValue >= total, total > limit {
                shown.wrappedValue = limit
            } else {
                shown.wrappedValue = min(total, shown.wrappedValue + SidebarListLimits.pageSize)
            }
        }
        .buttonStyle(.plain)
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityLabel(collapsed ? "收起\(sectionName)" : "展开更多\(sectionName)")
        .pointingHandCursor()
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
                .pointingHandCursor()

                if archivedExpanded {
                    ForEach(archived, id: \.meta.path) { entry in
                        let meta = entry.meta
                        let project = entry.project
                        Button {
                            store.restoreSession(meta, project: project)
                        } label: {
                            SessionRow(
                                title: meta.name,
                                modelRef: meta.modelRef,
                                subtitle: "\(store.projectDisplayName(for: project)) · \(Self.relative(meta.modified))",
                                status: .none,
                                engineKind: meta.engineKind
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
        ) { isHovered, actionAreaWidth in
            if let live {
                LiveSessionRow(
                    session: live,
                    fallbackTitle: fallbackTitle,
                    idleSubtitle: idleSubtitle,
                    hideSubtitle: isHovered,
                    reservedTrailingWidth: actionAreaWidth
                )
            } else if let meta {
                let interrupted = store.interruptedSessionPaths.contains(meta.path)
                SessionRow(
                    title: displayTitle(meta: meta, openKey: openKey),
                    modelRef: meta.modelRef,
                    subtitle: interrupted ? "已中断" : idleSubtitle,
                    status: interrupted ? .interrupted : .none,
                    engineKind: meta.engineKind,
                    hideSubtitle: isHovered,
                    reservedTrailingWidth: actionAreaWidth
                )
            } else {
                SessionRow(
                    title: fallbackTitle,
                    subtitle: idleSubtitle,
                    status: .none,
                    hideSubtitle: isHovered,
                    reservedTrailingWidth: actionAreaWidth
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

    private var sessionSearchField: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("搜索所有会话", text: $sessionSearchQuery)
                .textFieldStyle(.plain)
                .focused($sessionSearchFocused)
                .accessibilityLabel("搜索所有会话")
            if sessionSearchQuery.isEmpty {
                Text("⌘K")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else {
                Button(action: clearSessionSearch) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .help("清除搜索")
                .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
        .overlay {
            Button(action: focusSessionSearch) { EmptyView() }
                .keyboardShortcut("k", modifiers: .command)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
        .help("跨项目搜索活跃和已归档会话")
        .padding(.horizontal, Self.sidebarGutter)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var sessionSearchResults: some View {
        if let sessionSearchError {
            VStack(alignment: .leading, spacing: 6) {
                Text("搜索暂不可用").font(.callout.weight(.medium))
                Text(sessionSearchError).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 8)
        } else if sessionSearchInProgress {
            HStack(spacing: 7) {
                ProgressView().controlSize(.small)
                Text("正在更新索引并搜索…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 18)
        } else if sessionSearchHits.isEmpty {
            Text("无匹配会话")
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.vertical, 8)
        } else {
            ForEach(sessionSearchHits) { hit in
                Button {
                    openSearchHit(hit)
                    clearSessionSearch()
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(hit.title).font(.body).lineLimit(1)
                            if hit.isArchived { sessionSearchBadge("已归档", color: .secondary) }
                            if hit.isLive { sessionSearchBadge("新会话", color: .accentColor) }
                            if let role = hit.role {
                                sessionSearchBadge(role == "user" ? "用户" : "助手", color: .secondary)
                            }
                            Spacer(minLength: 0)
                            if let modified = hit.messageTimestamp ?? hit.modified {
                                Text(Self.relative(modified))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        if let projectName = hit.projectName {
                            Text(projectName)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                        Text(hit.snippet ?? "标题或项目匹配")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, 6)
                .padding(.horizontal, 6)
                .hoverRowBackground(cornerRadius: 7)
            }
        }
    }

    @ViewBuilder
    private func sessionSearchBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(color.opacity(0.15), in: Capsule())
    }

    private var sessionSearchSourceGeneration: String {
        store.projects.map { project in
            let active = store.sessionsByProject[project.path] ?? []
            let archived = store.archivedByProject[project.path] ?? []
            let fileStates = (active + archived)
                .map { "\($0.path):\($0.modified.timeIntervalSince1970)" }
                .sorted()
                .joined(separator: ",")
            return "\(project.path):\(store.projectDisplayName(for: project)):\(active.count):\(archived.count):\(fileStates)"
        }.joined(separator: "|")
    }

    private var sessionSearchIdentity: String {
        "\(sessionSearchQuery)|\(sessionSearchSourceGeneration)"
    }

    private func focusSessionSearch() {
        for project in store.projects {
            store.refreshSessions(for: project)
        }
        sessionSearchFocused = true
    }

    private func clearSessionSearch() {
        sessionSearchQuery = ""
        sessionSearchHits = []
        sessionSearchInProgress = false
        sessionSearchError = nil
        sessionSearchFocused = false
    }

    @MainActor
    private func updateSessionSearch() async {
        let query = sessionSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            sessionSearchHits = []
            sessionSearchInProgress = false
            sessionSearchError = nil
            return
        }

        sessionSearchInProgress = true
        sessionSearchError = nil
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        let sources = sessionSearchSources()
        let live = sessionSearchLiveSources()
        do {
            try await SessionSearchIndex.shared.synchronize(sources: sources)
            var results = try await SessionSearchIndex.shared.search(query: query, projectPath: nil)
            let liveHits = live.compactMap { entry -> SessionSearchHit? in
                guard entry.title.range(of: query, options: .caseInsensitive) != nil else { return nil }
                return SessionSearchHit(
                    path: entry.key,
                    title: entry.title,
                    modified: nil,
                    snippet: nil,
                    isTitleMatch: true,
                    isArchived: false,
                    isLive: true,
                    projectPath: entry.projectPath,
                    projectName: entry.projectName
                )
            }
            results = Array((liveHits + results).prefix(SessionSearchIndex.resultCap))
            guard !Task.isCancelled else { return }
            sessionSearchHits = results
            sessionSearchInProgress = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            sessionSearchError = error.localizedDescription
            sessionSearchInProgress = false
        }
    }

    private func sessionSearchSources() -> [SessionSearchSource] {
        store.projects.flatMap { project -> [SessionSearchSource] in
            let projectName = store.projectDisplayName(for: project)
            let archivedPaths = Set((store.archivedByProject[project.path] ?? []).map(\.path))
            let all = (store.sessionsByProject[project.path] ?? []) + (store.archivedByProject[project.path] ?? [])
            return Dictionary(all.map { ($0.path, $0) }, uniquingKeysWith: { _, newer in newer }).values.map { meta in
                SessionSearchSource(
                    projectPath: project.path,
                    projectName: projectName,
                    sessionPath: meta.path,
                    title: meta.name,
                    modified: meta.modified,
                    isArchived: archivedPaths.contains(meta.path)
                )
            }
        }
    }

    private func sessionSearchLiveSources() -> [SessionSearchLiveSource] {
        store.openSessions.compactMap { key, session in
            guard key.hasPrefix("new:") else { return nil }
            let project = session.projectURL
            let title = session.sessionName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return SessionSearchLiveSource(
                projectPath: project.path,
                projectName: store.projectDisplayName(for: project),
                key: key,
                title: title.isEmpty ? "新会话" : title
            )
        }
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

private struct ProjectDropDelegate: DropDelegate {
    let project: URL
    let store: AppStore

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [UTType.plainText])
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        guard let provider = info.itemProviders(for: [UTType.plainText]).first else { return false }
        provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let path = object as? String else { return }
            DispatchQueue.main.async {
                store.moveProject(path: path, before: project.path)
            }
        }
        return true
    }
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
    @ViewBuilder var content: (_ isHovered: Bool, _ actionAreaWidth: CGFloat) -> Content

    @State private var isHovered = false

    /// Includes the buttons' spacing and right inset so title text never extends beneath them.
    private var actionAreaWidth: CGFloat {
        let count = 1 + (onPin == nil ? 0 : 1) + (onArchive == nil ? 0 : 1)
        return CGFloat(count * 20 + max(count - 1, 0) * 4 + 6)
    }

    var body: some View {
        // Non-Button hit target + overlay action Buttons (no nested Button).
        // On hover, content hides its trailing subtitle and reserves the action area.
        content(isHovered, isHovered ? actionAreaWidth : 0)
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
    /// Reserved action-button width so title text never extends beneath the buttons.
    var reservedTrailingWidth: CGFloat = 0

    init(
        session: ChatSession,
        fallbackTitle: String,
        idleSubtitle: String,
        hideSubtitle: Bool = false,
        reservedTrailingWidth: CGFloat = 0
    ) {
        self.session = session
        self.agents = session.subagents
        self.fallbackTitle = fallbackTitle
        self.idleSubtitle = idleSubtitle
        self.hideSubtitle = hideSubtitle
        self.reservedTrailingWidth = reservedTrailingWidth
    }

    var body: some View {
        // Touch agents.runningCount so SwiftUI tracks SubagentStore publishes.
        let _ = agents.runningCount
        let status = SessionRowStatus.from(session)
        // Prefer non-empty live name so disk meta still shows when sessionName unset.
        let title = session.sessionName.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackTitle
        let subtitle = status.subtitleOverride ?? idleSubtitle
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            // Keep status column width stable so titles don't shift
            statusIndicator(status)
                .frame(width: 12, height: 12)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] }
            if let model = session.model {
                ProviderLogo(model: model, size: 13)
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] }
            }
            TypewriterText(
                text: title,
                animationToken: session.titleAnimationToken,
                font: .body
            )
            if session.engineKind == .jcode {
                EngineBadge.jcode
            }
            Spacer(minLength: 0)
            if !subtitle.isEmpty, !hideSubtitle {
                Text(subtitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.trailing, reservedTrailingWidth)
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
/// Pulse runs on CALayer (WindowServer), not SwiftUI's render loop — avoids a
/// permanent main-thread DisplayList walk while any subagent badge is visible.
private struct SubagentsRunningIndicator: View {
    let count: Int

    var body: some View {
        ZStack {
            LayerOpacityPulsingSymbol(
                systemName: "person.2.fill",
                pointSize: 9,
                weight: .semibold,
                tint: .systemOrange
            )
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
        .accessibilityLabel(count > 1 ? "\(count) 个子任务运行中" : "子任务运行中")
    }
}

/// SF Symbol whose layer opacity pulses 1.0 ↔ 0.45 via CABasicAnimation.
/// Layer animations do not drive SwiftUI's per-frame DisplayList updates.
private struct LayerOpacityPulsingSymbol: NSViewRepresentable {
    let systemName: String
    let pointSize: CGFloat
    let weight: NSFont.Weight
    let tint: NSColor

    func makeNSView(context: Context) -> PulsingSymbolNSView {
        let view = PulsingSymbolNSView()
        view.configure(systemName: systemName, pointSize: pointSize, weight: weight, tint: tint)
        return view
    }

    func updateNSView(_ nsView: PulsingSymbolNSView, context: Context) {
        nsView.configure(systemName: systemName, pointSize: pointSize, weight: weight, tint: tint)
    }

    static func dismantleNSView(_ nsView: PulsingSymbolNSView, coordinator: ()) {
        nsView.stopPulse()
    }
}

private final class PulsingSymbolNSView: NSView {
    private static let animationKey = "pipiui.subagentPulse.opacity"

    private let imageView = NSImageView()
    private var configuredKey: String?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        imageView.wantsLayer = true
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.animates = false
        addSubview(imageView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layout() {
        super.layout()
        imageView.frame = bounds
        // Layer is created lazily; attach the pulse once the backing layer exists.
        startPulseIfNeeded()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil {
            stopPulse()
        } else {
            startPulseIfNeeded()
        }
    }

    func configure(systemName: String, pointSize: CGFloat, weight: NSFont.Weight, tint: NSColor) {
        let key = "\(systemName)|\(pointSize)|\(weight.rawValue)|\(tint)"
        if configuredKey != key {
            configuredKey = key
            let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
            imageView.image = NSImage(systemSymbolName: systemName, accessibilityDescription: nil)?
                .withSymbolConfiguration(config)
            imageView.contentTintColor = tint
        }
        startPulseIfNeeded()
    }

    func startPulseIfNeeded() {
        guard window != nil else { return }
        imageView.wantsLayer = true
        guard let layer = imageView.layer else { return }
        guard layer.animation(forKey: Self.animationKey) == nil else { return }

        // Match prior SwiftUI pulse: opacity 1.0 ↔ 0.45, easeInOut 0.9s, autoreverse forever.
        layer.opacity = 1.0
        let anim = CABasicAnimation(keyPath: "opacity")
        anim.fromValue = 1.0
        anim.toValue = 0.45
        anim.duration = 0.9
        anim.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        anim.autoreverses = true
        anim.repeatCount = .infinity
        anim.isRemovedOnCompletion = false
        layer.add(anim, forKey: Self.animationKey)
    }

    func stopPulse() {
        imageView.layer?.removeAnimation(forKey: Self.animationKey)
        imageView.layer?.opacity = 1.0
    }
}

/// Trailing engine marker shown next to a session title. Only `.jcode`
/// renders anything (pi is the default/legacy majority case — a badge there
/// would just add noise). Styled as a low-key capsule matching the search
/// result badges so live and idle rows read the same.
private enum EngineBadge {
    static var jcode: some View {
        Text("jc")
            .font(.system(size: 9, weight: .semibold, design: .monospaced))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(
                Capsule().fill(Color.secondary.opacity(0.15))
            )
            .accessibilityLabel("jcode 引擎")
    }
}

private struct SessionRow: View {
    let title: String
    var modelRef: String? = nil
    let subtitle: String
    var status: SessionRowStatus = .none
    /// Which engine backs this session; `.jcode` shows a small trailing badge.
    /// Defaults to `.pi` (no badge) for the legacy/majority case.
    var engineKind: EngineKind = .pi
    /// Hide trailing caption while hover actions occupy that corner.
    var hideSubtitle: Bool = false
    /// Reserved action-button width so title text never extends beneath the buttons.
    var reservedTrailingWidth: CGFloat = 0

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            // Keep status column width stable so titles don't shift
            statusIndicator
                .frame(width: 12, height: 12)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] }
            if let modelRef {
                ProviderLogo(modelRef: modelRef, size: 13)
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] }
            }
            Text(title)
                .lineLimit(1)
                .truncationMode(.tail)
            if engineKind == .jcode {
                EngineBadge.jcode
            }
            Spacer(minLength: 0)
            if !subtitle.isEmpty, !hideSubtitle {
                Text(subtitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.trailing, reservedTrailingWidth)
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
