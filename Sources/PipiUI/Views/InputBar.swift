import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// Captures ⌘V image pastes while the composer is focused (TextField would otherwise insert a path).
final class ComposerPasteCatcher {
    var focused = false
    var onPasteImages: ([DraftImage]) -> Void = { _ in }
    private var monitor: Any?

    func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            guard self.focused,
                  event.modifierFlags.contains(.command),
                  !event.modifierFlags.contains(.shift),
                  !event.modifierFlags.contains(.option),
                  !event.modifierFlags.contains(.control),
                  event.charactersIgnoringModifiers?.lowercased() == "v"
            else { return event }

            guard ImageAttachment.pasteboardHasImage() else { return event }
            let images = ImageAttachment.imagesFromPasteboard()
            guard !images.isEmpty else { return event }
            DispatchQueue.main.async { self.onPasteImages(images) }
            return nil
        }
    }

    func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    deinit { stop() }
}

/// Arrow/Tab/Return/Esc while slash palette is open. Mirrors ComposerPasteCatcher lifecycle.
final class ComposerSlashKeyMonitor {
    var isActive = false
    var onMove: (Int) -> Void = { _ in }
    var onEscape: () -> Void = {}
    var onTab: () -> Void = {}
    /// Return true if the key was handled and should not propagate.
    var onReturn: () -> Bool = { false }
    private var monitor: Any?

    func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isActive else { return event }
            let mods = event.modifierFlags.intersection([.command, .option, .control])
            guard mods.isEmpty else { return event }

            switch event.keyCode {
            case 126: // up
                self.onMove(-1)
                return nil
            case 125: // down
                self.onMove(1)
                return nil
            case 53: // escape
                self.onEscape()
                return nil
            case 48: // tab
                self.onTab()
                return nil
            case 36, 76: // return / keypad enter
                if self.onReturn() { return nil }
                return event
            default:
                return event
            }
        }
    }

    func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    deinit { stop() }
}

struct InputBar: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject var session: ChatSession
    @State private var attachError: String?
    @FocusState private var focused: Bool
    @State private var pasteCatcher = ComposerPasteCatcher()
    @State private var slashKeyMonitor = ComposerSlashKeyMonitor()
    @State private var slashMatches: [SlashCommand] = []
    @State private var slashSelectedIndex: Int = 0
    @State private var slashPaletteVisible: Bool = false
    @State private var showQuotaPopover: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            if !session.messageQueue.isEmpty {
                queueStrip
            }

            if !session.draftImages.isEmpty {
                attachmentStrip
            }

            if session.composerMode != .chat {
                mediaModeStrip
            }

            if let attachError {
                Text(attachError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let status = session.mediaStatus {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if slashPaletteVisible && !slashMatches.isEmpty {
                SlashPalette(
                    commands: slashMatches,
                    selectedIndex: slashSelectedIndex,
                    onSelect: { completeSlash($0) }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            HStack(alignment: .bottom, spacing: 10) {
                plusMenu

                TextField(fieldPlaceholder,
                          text: $session.draftText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...10)
                    .focused($focused)
                    .onSubmit(send)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color.primary.opacity(0.05))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.1))
                    )

                if session.isStreaming {
                    Button(action: { session.abort() }) {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 26))
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                    .help(session.messageQueue.isEmpty ? "中止当前回复" : "中止并发送队首")
                }

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(canSend ? Color.accentColor : Color.secondary.opacity(0.4))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
            }

            responsiveStatus
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(.bar)
        .onDrop(of: [.image, .fileURL], isTargeted: nil, perform: handleDrop)
        .onAppear {
            focused = true
            pasteCatcher.focused = true
            pasteCatcher.onPasteImages = { images in
                session.draftImages.append(contentsOf: images)
                attachError = nil
            }
            pasteCatcher.start()

            slashKeyMonitor.onMove = { delta in
                guard !slashMatches.isEmpty else { return }
                let next = slashSelectedIndex + delta
                slashSelectedIndex = min(max(0, next), slashMatches.count - 1)
            }
            slashKeyMonitor.onEscape = {
                slashPaletteVisible = false
                refreshSlashKeyMonitorActive()
            }
            slashKeyMonitor.onTab = {
                guard slashPaletteVisible,
                      slashMatches.indices.contains(slashSelectedIndex) else { return }
                completeSlash(slashMatches[slashSelectedIndex])
            }
            slashKeyMonitor.onReturn = {
                guard slashPaletteVisible,
                      slashMatches.indices.contains(slashSelectedIndex) else { return false }
                executeSlash(slashMatches[slashSelectedIndex])
                return true
            }
            slashKeyMonitor.start()
            refreshSlashPalette()
            refreshSlashKeyMonitorActive()
        }
        .onChange(of: focused) { _, isFocused in
            pasteCatcher.focused = isFocused
            refreshSlashKeyMonitorActive()
        }
        .onChange(of: session.draftText) { _, _ in
            refreshSlashPalette()
        }
        .onChange(of: session.availableCommands) { _, _ in
            refreshSlashPalette()
        }
        .onChange(of: session.composerMode) { _, _ in
            refreshSlashPalette()
        }
        .onChange(of: session.draftImages.count) { _, _ in
            refreshSlashPalette()
        }
        .onDisappear {
            pasteCatcher.stop()
            slashKeyMonitor.stop()
        }
    }

    // MARK: - Queue strip

    private var queueStrip: some View {
        HStack(spacing: 10) {
            Image(systemName: "tray")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("排队 \(session.messageQueue.count) 条")
                    .font(.caption.weight(.semibold))
                if let preview = queuePreview {
                    Text(preview)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            HStack(spacing: 12) {
                Button("插队") {
                    session.cutInQueueHead()
                }
                .font(.caption.weight(.medium))
                .help("中止当前回复并发送队首")

                Button("撤回编辑") {
                    let restored = session.restoreQueueToDraft()
                    if session.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        session.draftText = restored.text
                    } else if !restored.text.isEmpty {
                        session.draftText = session.draftText + "\n\n" + restored.text
                    }
                    session.draftImages.append(contentsOf: restored.images)
                }
                .font(.caption.weight(.medium))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.accentColor.opacity(0.08))
        )
    }

    private var queuePreview: String? {
        guard let text = session.messageQueue.first?.text else { return nil }
        let firstLine = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? text
        let trimmed = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return session.messageQueue.first?.images.isEmpty == false ? "(图片)" : nil
        }
        if trimmed.count <= 40 { return "「\(trimmed)」" }
        return "「\(trimmed.prefix(40))…」"
    }

    // MARK: - Attachment strip

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(session.draftImages) { img in
                    ZStack(alignment: .topTrailing) {
                        // Enlarge OK; path unknown for drafts → reveal disabled via content match off.
                        ImageThumbnailView(
                            data: img.data,
                            mimeType: img.mimeType,
                            path: nil,
                            fillSize: CGSize(width: 64, height: 64),
                            projectURL: session.projectURL,
                            onFlash: { session.flash($0) },
                            allowContentMatch: false
                        )

                        Button {
                            session.draftImages.removeAll { $0.id == img.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.55))
                                .font(.system(size: 16))
                        }
                        .buttonStyle(.plain)
                        .offset(x: 6, y: -6)
                    }
                }
            }
            .padding(.vertical, 2)
            .padding(.trailing, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Plus menu & media mode

    private var plusMenu: some View {
        Menu {
            Button {
                pickFiles()
            } label: {
                Label("上传图片", systemImage: "photo.on.rectangle")
            }
            Divider()
            Button {
                session.composerMode = .generateImage
                if MediaModelCatalog.models(for: .generateImage).allSatisfy({ $0.id != session.imageMediaModel.id }) {
                    session.imageMediaModel = MediaModelCatalog.defaultModel(for: .generateImage)!
                }
            } label: {
                Label("生成图像", systemImage: "wand.and.stars")
            }
            Button {
                session.composerMode = .generateVideo
                if MediaModelCatalog.models(for: .generateVideo).allSatisfy({ $0.id != session.videoMediaModel.id }) {
                    session.videoMediaModel = MediaModelCatalog.defaultModel(for: .generateVideo)!
                }
            } label: {
                Label("生成视频", systemImage: "film")
            }
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 26))
                .foregroundStyle(session.composerMode == .chat ? Color.secondary.opacity(0.85) : Color.accentColor)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("上传图片 / 生成图像 / 生成视频")
        .disabled(session.mediaBusy)
    }

    private var mediaModeStrip: some View {
        HStack(spacing: 10) {
            Image(systemName: session.composerMode == .generateVideo ? "film" : "wand.and.stars")
                .foregroundStyle(Color.accentColor)
            Text(session.composerMode.label)
                .font(.caption.weight(.semibold))
            mediaModelMenu
            Spacer()
            if session.mediaBusy {
                ProgressView().controlSize(.mini)
            }
            Button {
                session.composerMode = .chat
                session.mediaStatus = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("退出生成模式，回到对话")
            .disabled(session.mediaBusy)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.accentColor.opacity(0.08))
        )
    }

    private var mediaModelMenu: some View {
        let models = MediaModelCatalog.models(for: session.composerMode)
        return Menu {
            ForEach(models) { m in
                Button {
                    if session.composerMode == .generateVideo {
                        session.videoMediaModel = m
                    } else {
                        session.imageMediaModel = m
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(m.name)
                            if currentMediaModel?.id == m.id {
                                Image(systemName: "checkmark")
                            }
                        }
                        Text(m.detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(currentMediaModel?.name ?? "选择模型")
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
        .disabled(session.mediaBusy)
        .help(currentMediaModel?.detail ?? "选择生成模型")
    }

    private var currentMediaModel: MediaModel? {
        switch session.composerMode {
        case .generateImage: return session.imageMediaModel
        case .generateVideo: return session.videoMediaModel
        case .chat: return nil
        }
    }

    private var fieldPlaceholder: String {
        if session.composerMode != .chat {
            return session.composerMode.placeholder
        }
        return session.isStreaming ? "输入将排队，完成后发送…" : "输入消息…"
    }

    // MARK: - Slash palette

    private func allSlashCommands() -> [SlashCommand] {
        BuiltinCommands.all + session.availableCommands
    }

    private func refreshSlashPalette() {
        // Non-chat media modes and drafts with attachments skip slash palette
        // so Return/send paths stay consistent (no builtin vs generateMedia / drop-images fork).
        guard session.composerMode == .chat, session.draftImages.isEmpty else {
            slashPaletteVisible = false
            slashMatches = []
            slashSelectedIndex = 0
            refreshSlashKeyMonitorActive()
            return
        }
        guard let query = SlashPaletteQuery.paletteQuery(from: session.draftText) else {
            slashPaletteVisible = false
            slashMatches = []
            slashSelectedIndex = 0
            refreshSlashKeyMonitorActive()
            return
        }
        let matches = SlashFuzzy.filter(commands: allSlashCommands(), query: query)
        slashMatches = matches
        slashPaletteVisible = !matches.isEmpty
        if slashSelectedIndex >= matches.count {
            slashSelectedIndex = max(0, matches.count - 1)
        }
        refreshSlashKeyMonitorActive()
    }

    private func refreshSlashKeyMonitorActive() {
        slashKeyMonitor.isActive = focused && slashPaletteVisible && !slashMatches.isEmpty
    }

    /// Tab / click: fill `/name ` and keep focus for args.
    private func completeSlash(_ cmd: SlashCommand) {
        session.draftText = "/\(cmd.name) "
        slashPaletteVisible = false
        slashMatches = []
        slashSelectedIndex = 0
        focused = true
        refreshSlashKeyMonitorActive()
    }

    /// Return while palette open: run command now.
    private func executeSlash(_ cmd: SlashCommand) {
        let args: String = {
            // If draft is `/name rest`, pass rest; if user selected different cmd, args empty.
            if let inv = BuiltinCommands.parseInvocation(session.draftText), inv.name == cmd.name {
                return inv.args
            }
            return ""
        }()
        session.draftText = ""
        session.draftImages = []
        slashPaletteVisible = false
        slashMatches = []
        slashSelectedIndex = 0
        refreshSlashKeyMonitorActive()
        // Builtin path or server prompt:
        if cmd.source == .builtin {
            _ = BuiltinCommands.execute(name: cmd.name, args: args, host: session)
        } else {
            let message: String
            if args.isEmpty {
                message = "/\(cmd.name)"
            } else {
                message = "/\(cmd.name) \(args)"
            }
            session.sendPrompt(message, images: [])
        }
    }

    // MARK: - Send

    private var canSend: Bool {
        if session.mediaBusy { return false }
        let hasText = !session.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasImages = !session.draftImages.isEmpty
        switch session.composerMode {
        case .generateImage, .generateVideo:
            // Media gen only needs text (refs optional); does not require pi process.
            return hasText
        case .chat:
            return session.processAlive && (hasText || hasImages)
        }
    }

    private func send() {
        // Belt-and-suspenders: palette Return must not double-fire via onSubmit.
        if slashPaletteVisible, !slashMatches.isEmpty,
           slashMatches.indices.contains(slashSelectedIndex) {
            executeSlash(slashMatches[slashSelectedIndex])
            return
        }
        guard canSend else { return }
        let images = session.draftImages
        let text = session.draftText
        session.draftText = ""
        session.draftImages = []
        attachError = nil
        session.sendPrompt(text, images: images)
    }

    // MARK: - Pick / paste / drop

    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image]
        panel.prompt = "添加"
        panel.message = "选择要发送的图片"
        guard panel.runModal() == .OK else { return }
        appendResults(panel.urls.map { ImageAttachment.make(from: $0) })
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var handled = false
        let group = DispatchGroup()
        var results: [Result<DraftImage, ImageAttachment.LoadError>] = []
        let lock = NSLock()

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                handled = true
                group.enter()
                provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                    defer { group.leave() }
                    let result: Result<DraftImage, ImageAttachment.LoadError>
                    if let data {
                        result = ImageAttachment.make(from: data)
                    } else {
                        result = .failure(.corrupt)
                    }
                    lock.lock(); results.append(result); lock.unlock()
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                handled = true
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    defer { group.leave() }
                    let result: Result<DraftImage, ImageAttachment.LoadError>
                    if let data = item as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        result = ImageAttachment.make(from: url)
                    } else if let url = item as? URL {
                        result = ImageAttachment.make(from: url)
                    } else {
                        result = .failure(.corrupt)
                    }
                    lock.lock(); results.append(result); lock.unlock()
                }
            }
        }

        guard handled else { return false }
        group.notify(queue: .main) {
            self.appendResults(results)
        }
        return true
    }

    private func appendResults(_ results: [Result<DraftImage, ImageAttachment.LoadError>]) {
        var lastError: String?
        for result in results {
            switch result {
            case .success(let img):
                session.draftImages.append(img)
            case .failure(let err):
                lastError = err.localizedDescription
            }
        }
        attachError = lastError
        if lastError != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                if attachError == lastError { attachError = nil }
            }
        }
    }

    // MARK: - Menus

    /// Candidates must report their *content* width. A candidate carrying
    /// `.frame(maxWidth: .infinity)` claims all available width, so "does this fit"
    /// depends on the width `ViewThatFits` is itself trying to pick — a circular
    /// dependency that SwiftUI reports as `AttributeGraph: cycle detected` and then
    /// re-evaluates forever (47M such lines in four minutes during one session, with
    /// the app unusable). The expansion belongs on the container, after the choice.
    private var responsiveStatus: some View {
        ViewThatFits(in: .horizontal) {
            // Wide: model + thinking glued left; activity/metrics on the trailing edge.
            // Inner fixedSize HStack prevents borderless Menu from claiming extra width.
            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    modelMenu
                        .fixedSize()
                    thinkingMenu
                        .fixedSize()
                }
                .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 12)

                activityStatus
                metricsStatus
            }

            VStack(spacing: 6) {
                HStack(spacing: 8) {
                    HStack(spacing: 8) {
                        modelMenu
                            .fixedSize()
                        thinkingMenu
                            .fixedSize()
                    }
                    .fixedSize(horizontal: true, vertical: false)

                    Spacer(minLength: 0)
                }
                HStack(spacing: 8) {
                    activityStatus
                    Spacer(minLength: 4)
                    metricsStatus
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var activityStatus: some View {
        if session.isStreaming {
            Text(session.messageQueue.isEmpty
                 ? "生成中…"
                 : "生成中 · \(session.messageQueue.count) 条排队")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        if !session.processAlive {
            Text("进程已退出")
                .font(.caption)
                .foregroundStyle(.red)
                .lineLimit(1)
        }
    }

    private var metricsStatus: some View {
        HStack(spacing: 8) {
            if let contextText = session.contextStatusText {
                let hot = (session.contextPercent ?? 0) > 80
                Text(contextText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(hot ? .orange : .secondary)
                    .help("上下文占用")
            }
            if let quota = session.quotaPercent, session.model?.shouldShowAccountQuota == true {
                let label = session.quotaPeriodLabel ?? "额"
                let help = session.quotaPeriodHelp ?? "额度"
                Text("\(label) \(Int(quota.rounded()))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(quota > 80 ? .orange : .secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.primary.opacity(0.06)))
                    .help(help)
                    .contentShape(Capsule())
                    .onTapGesture { showQuotaPopover.toggle() }
                    .popover(isPresented: $showQuotaPopover, arrowEdge: .bottom) {
                        quotaPopover
                            .frame(width: 264)
                            .padding(10)
                    }
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var quotaPopover: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(session.quotaProvider?.accountLabel ?? "账号额度")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            if session.quotaWindows.isEmpty {
                Text("暂无用量数据")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
            } else {
                ForEach(session.quotaWindows) { w in
                    quotaWindowRow(w)
                }
            }
        }
    }

    private func quotaWindowRow(_ w: QuotaWindow) -> some View {
        let selected = session.quotaSelectedWindowId == w.id
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .font(.caption)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(w.title).font(.caption.bold())
                    Spacer()
                    Text("\(Int(w.usedPercent.rounded()))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(w.usedPercent > 80 ? Color.orange : Color.secondary)
                }
                ProgressView(value: w.usedPercent, total: 100)
                    .tint(w.usedPercent > 80 ? Color.orange : Color.accentColor)
                if let reset = w.resetsAt {
                    Text("重置于 \(Self.quotaDateFmt.string(from: reset))")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary.opacity(0.7))
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { session.selectQuotaWindow(id: w.id) }
    }

    private static let quotaDateFmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        return f
    }()

    private var modelMenu: some View {
        // Read revision so toggles in Settings refresh this menu immediately.
        let _ = store.modelVisibilityRevision
        let visible = ModelVisibility.pickerModels(
            from: session.availableModels,
            selectedId: session.model?.id
        )
        let providers = ModelVisibility.pickerProviders(
            from: session.availableModels,
            selectedId: session.model?.id
        )
        return Menu {
            ForEach(providers, id: \.self) { provider in
                Section(provider) {
                    ForEach(visible.filter { $0.provider == provider }) { m in
                        Button {
                            session.setModel(m)
                        } label: {
                            if m.id == session.model?.id {
                                Label(m.name, systemImage: "checkmark")
                            } else {
                                Text(m.name)
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "cpu")
                Text(session.model?.name ?? "选择模型")
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
    }

    private var thinkingMenu: some View {
        Menu {
            ForEach(session.thinkingLevels, id: \.self) { level in
                Button {
                    session.setThinkingLevel(level)
                } label: {
                    if level == session.thinkingLevel {
                        Label(level, systemImage: "checkmark")
                    } else {
                        Text(level)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "brain")
                Text(session.thinkingLevel)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
        .disabled(session.thinkingLevels == ["off"])
    }

}
