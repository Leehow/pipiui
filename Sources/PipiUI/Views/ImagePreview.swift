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

    @State private var showLightbox = false
    @State private var hovering = false

    var body: some View {
        Group {
            if let ns = NSImage(data: data) {
                imageView(ns)
                    .contentShape(Rectangle())
                    .onTapGesture { showLightbox = true }
                    // macOS: fullScreenCover is unavailable — sheet + dark chrome approximates lightbox.
                    .sheet(isPresented: $showLightbox) {
                        ImageLightbox(image: ns, isPresented: $showLightbox)
                    }
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

/// Dimmed lightbox for a single image (presented as sheet on macOS).
struct ImageLightbox: View {
    let image: NSImage
    @Binding var isPresented: Bool

    var body: some View {
        ZStack {
            Color.black.opacity(0.92)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { dismiss() }

            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(40)
                // Absorb taps on the image so they don't dismiss via the background.
                .onTapGesture { /* keep open */ }

            VStack {
                HStack {
                    Spacer()
                    Button(action: dismiss) {
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
        .frame(minWidth: 640, minHeight: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .focusable()
        .onKeyPress(.escape) {
            dismiss()
            return .handled
        }
        .onExitCommand(perform: dismiss)
    }

    private func dismiss() {
        isPresented = false
    }
}
