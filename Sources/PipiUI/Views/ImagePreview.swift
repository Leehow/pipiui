import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Interactive image thumbnail: tap for lightbox; context menu for Finder / open / save.
struct ImageThumbnailView: View {
    let data: Data
    var mimeType: String = "image/png"
    var path: String? = nil
    var maxWidth: CGFloat = 280
    var maxHeight: CGFloat = 200
    /// When set, uses fill + fixed frame (composer draft strip).
    var fillSize: CGSize? = nil
    var projectURL: URL? = nil
    var footnotePaths: [String] = []
    var imageIndex: Int = 0
    var onFlash: ((String) -> Void)? = nil
    /// Composer drafts: reveal only when path is known (no attachment scan required).
    var allowContentMatch: Bool = true

    @State private var hovering = false

    var body: some View {
        Group {
            if let ns = ImageDecodeCache.shared.image(for: data) {
                imageView(ns)
                    .contentShape(Rectangle())
                    .onTapGesture { ImageLightboxPresenter.present(image: ns) }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel("图片预览")
                    .accessibilityHint("点击放大")
            } else {
                decodeFailedPlaceholder
                    .accessibilityLabel("无法预览")
            }
        }
        .contextMenu { contextMenuItems }
        .onHover { isHovering in
            hovering = isHovering
            if isHovering {
                NSCursor.pointingHand.push()
            } else {
                NSCursor.pop()
            }
        }
    }

    @ViewBuilder
    private func imageView(_ ns: NSImage) -> some View {
        let img = Image(nsImage: ns)
            .resizable()
            .aspectRatio(contentMode: fillSize != nil ? .fill : .fit)

        if let fillSize {
            img
                .frame(width: fillSize.width, height: fillSize.height)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.12))
                )
        } else {
            img
                .frame(maxWidth: maxWidth, maxHeight: maxHeight)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private var decodeFailedPlaceholder: some View {
        HStack(spacing: 8) {
            Image(systemName: "photo")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("无法预览")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                if let path, !path.isEmpty {
                    Text((path as NSString).lastPathComponent)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: fillSize?.width ?? maxWidth, minHeight: fillSize?.height ?? 64, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1))
        )
    }

    @ViewBuilder
    private var contextMenuItems: some View {
        Button("在访达中显示") {
            reveal()
        }
        Button("打开") {
            openFile()
        }
        Divider()
        Button("存储…") {
            saveToDisk()
        }
    }

    private func resolvedPath() -> String? {
        if allowContentMatch {
            return ImagePathResolver.resolve(
                data: data,
                knownPath: path,
                footnotePaths: footnotePaths,
                imageIndex: imageIndex,
                projectURL: projectURL
            )
        }
        if let path, FileManager.default.fileExists(atPath: path) {
            return path
        }
        return path
    }

    private func reveal() {
        if let p = resolvedPath() {
            if FileReveal.revealInFinder(path: p) { return }
            onFlash?(FileReveal.missingPathMessage(p))
            return
        }
        if let path, !path.isEmpty {
            onFlash?(FileReveal.missingPathMessage(path))
            return
        }
        onFlash?("无法定位图片文件，请使用「存储…」")
    }

    private func openFile() {
        if let p = resolvedPath() {
            if FileReveal.open(path: p) { return }
            onFlash?(FileReveal.missingPathMessage(p))
            return
        }
        if let path, !path.isEmpty {
            onFlash?(FileReveal.missingPathMessage(path))
            return
        }
        onFlash?("无法定位图片文件，请使用「存储…」")
    }

    private func saveToDisk() {
        guard !data.isEmpty else {
            onFlash?("没有可存储的图片数据")
            return
        }
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = defaultFileName()
        if let type = utType(for: mimeType) {
            panel.allowedContentTypes = [type]
        }
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url, options: .atomic)
                _ = FileReveal.revealInFinder(url: url)
            } catch {
                DispatchQueue.main.async {
                    onFlash?("存储失败：\(error.localizedDescription)")
                }
            }
        }
    }

    private func defaultFileName() -> String {
        if let path, !path.isEmpty {
            return (path as NSString).lastPathComponent
        }
        switch mimeType.lowercased() {
        case "image/jpeg", "image/jpg": return "image.jpg"
        case "image/gif": return "image.gif"
        case "image/webp": return "image.webp"
        default: return "image.png"
        }
    }

    private func utType(for mime: String) -> UTType? {
        switch mime.lowercased() {
        case "image/jpeg", "image/jpg": return .jpeg
        case "image/png": return .png
        case "image/gif": return .gif
        case "image/webp": return .webP
        default: return UTType(mimeType: mime)
        }
    }
}

// MARK: - Borderless NSPanel lightbox

/// Presents a single borderless dimmed overlay panel (no sheet chrome).
enum ImageLightboxPresenter {
    private static var activePanel: NSPanel?
    private static var activeMonitor: Any?
    /// On-screen frame of the centered aspect-fit image (global screen coords,
    /// origin bottom-left — same space as `NSEvent.mouseLocation`). Used to
    /// hit-test backdrop clicks; clicks inside it keep the lightbox open.
    private static var activeImageFrame: CGRect = .zero

    static func present(image: NSImage) {
        dismiss()

        let panel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .modalPanel
        panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.animationBehavior = .utilityWindow

        let chrome = ImageLightboxChrome(image: image) {
            dismiss()
        }
        let hosting = NSHostingView(rootView: chrome)
        hosting.autoresizingMask = [.width, .height]
        panel.contentView = hosting

        let screenFrame = positionAndShow(panel)
        activePanel = panel

        // On-screen frame of the centered aspect-fit image, in the same
        // coordinate space as NSEvent.mouseLocation (screen/global, bottom-left).
        let fitted = ImageLightboxChrome.fittedSize(
            imageSize: image.size,
            in: CGSize(
                width: max(0, screenFrame.width - 64),
                height: max(0, screenFrame.height - 64)
            )
        )
        activeImageFrame = CGRect(
            x: screenFrame.midX - fitted.width / 2,
            y: screenFrame.midY - fitted.height / 2,
            width: fitted.width,
            height: fitted.height
        )

        // Local Esc + backdrop-click dismissal at the NSEvent level (the SwiftUI
        // backdrop .onTapGesture is unreliable in this borderless panel).
        activeMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { event in
            switch event.type {
            case .keyDown:
                if event.keyCode == 53 { // Escape
                    dismiss()
                    return nil
                }
                return event
            case .leftMouseDown:
                // Only act on clicks that land on our panel.
                guard event.window === activePanel else { return event }
                if activeImageFrame.contains(NSEvent.mouseLocation) {
                    // Click on the image itself: keep the lightbox open.
                    return event
                }
                // Click on the dimmed backdrop: dismiss. Return the event
                // unchanged so the SwiftUI X button keeps working; dismiss() is
                // idempotent.
                dismiss()
                return event
            default:
                return event
            }
        }
    }

    static func dismiss() {
        if let monitor = activeMonitor {
            NSEvent.removeMonitor(monitor)
            activeMonitor = nil
        }
        activeImageFrame = .zero
        guard let panel = activePanel else { return }
        activePanel = nil
        panel.orderOut(nil)
        panel.contentView = nil
    }

    private static func positionAndShow(_ panel: NSPanel) -> NSRect {
        let screenFrame: NSRect
        if let key = NSApp.keyWindow, let screen = key.screen {
            // Cover the screen that hosts the key window for a true lightbox feel.
            screenFrame = screen.frame
        } else if let main = NSScreen.main {
            screenFrame = main.frame
        } else {
            screenFrame = NSRect(x: 0, y: 0, width: 1280, height: 800)
        }

        panel.setFrame(screenFrame, display: true)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return screenFrame
    }
}

/// Soft-dimmed chrome inside the borderless panel.
struct ImageLightboxChrome: View {
    let image: NSImage
    let onDismiss: () -> Void

    private let margin: CGFloat = 32

    var body: some View {
        GeometryReader { geo in
            let fitted = Self.fittedSize(
                imageSize: image.size,
                in: CGSize(
                    width: max(0, geo.size.width - margin * 2),
                    height: max(0, geo.size.height - margin * 2)
                )
            )
            ZStack {
                // Full-screen hit target — must sit under a tightly-sized image frame
                // or letterboxed Image bounds swallow backdrop taps.
                Color.black.opacity(0.52)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture(perform: onDismiss)

                Image(nsImage: image)
                    .resizable()
                    .frame(width: fitted.width, height: fitted.height)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: .black.opacity(0.35), radius: 24, y: 8)
                    // Only the drawn image absorbs taps; surrounding dim dismisses.
                    .onTapGesture { /* keep open */ }

                VStack {
                    HStack {
                        Spacer()
                        Button(action: onDismiss) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 28))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .white.opacity(0.35))
                        }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.cancelAction)
                        .padding(20)
                        .help("关闭 (Esc)")
                    }
                    Spacer()
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .focusable()
        .onKeyPress(.escape) {
            onDismiss()
            return .handled
        }
        .onExitCommand(perform: onDismiss)
    }

    /// Aspect-fit size that matches the visible image (not the letterboxed layout frame).
    static func fittedSize(imageSize: CGSize, in bounds: CGSize) -> CGSize {
        let iw = max(imageSize.width, 1)
        let ih = max(imageSize.height, 1)
        let bw = max(bounds.width, 0)
        let bh = max(bounds.height, 0)
        guard bw > 0, bh > 0 else { return .zero }
        let scale = min(bw / iw, bh / ih)
        return CGSize(width: iw * scale, height: ih * scale)
    }
}
