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

struct InputBar: View {
    @ObservedObject var session: ChatSession
    @State private var draft = ""
    @State private var draftImages: [DraftImage] = []
    @State private var attachError: String?
    @FocusState private var focused: Bool
    @State private var pasteCatcher = ComposerPasteCatcher()

    var body: some View {
        VStack(spacing: 8) {
            if !draftImages.isEmpty {
                attachmentStrip
            }

            if let attachError {
                Text(attachError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(alignment: .bottom, spacing: 10) {
                Button(action: pickFiles) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 26))
                }
                .buttonStyle(HoverButtonStyle(base: Color.secondary.opacity(0.85), hovered: .primary))
                .help("添加图片")
                .disabled(!session.processAlive)

                TextField(session.isStreaming ? "输入将作为 steer 消息插入…" : "输入消息…",
                          text: $draft, axis: .vertical)
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
                    .help("中止当前回复")
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

            HStack(spacing: 12) {
                modelMenu
                thinkingMenu
                Spacer()
                if session.isStreaming {
                    Text("生成中…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !session.processAlive {
                    Text("进程已退出")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if let percent = session.contextPercent {
                    Text("\(Int(percent))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(percent > 80 ? .orange : .secondary)
                        .help("上下文占用")
                }
                Text(String(format: "$%.4f", session.cost))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.primary.opacity(0.06)))
            }
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
                draftImages.append(contentsOf: images)
                attachError = nil
            }
            pasteCatcher.start()
        }
        .onChange(of: focused) { _, isFocused in
            pasteCatcher.focused = isFocused
        }
        .onDisappear {
            pasteCatcher.stop()
        }
    }

    // MARK: - Attachment strip

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(draftImages) { img in
                    ZStack(alignment: .topTrailing) {
                        Image(nsImage: img.preview)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Color.primary.opacity(0.12))
                            )

                        Button {
                            draftImages.removeAll { $0.id == img.id }
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

    // MARK: - Send

    private var canSend: Bool {
        session.processAlive &&
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !draftImages.isEmpty)
    }

    private func send() {
        guard canSend else { return }
        let images = draftImages
        let text = draft
        draft = ""
        draftImages = []
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
                draftImages.append(img)
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

    private var modelMenu: some View {
        Menu {
            ForEach(groupedProviders, id: \.self) { provider in
                Section(provider) {
                    ForEach(session.availableModels.filter { $0.provider == provider }) { m in
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
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
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
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .disabled(session.thinkingLevels == ["off"])
    }

    private var groupedProviders: [String] {
        var seen: Set<String> = []
        var result: [String] = []
        for m in session.availableModels where !seen.contains(m.provider) {
            seen.insert(m.provider)
            result.append(m.provider)
        }
        return result
    }
}
