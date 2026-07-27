import AppKit
import PDFKit
import SwiftUI

/// 聊天文本 → 「在右侧文档面板打开这个文件」的环境钩子。
/// 由 ChatDetailView 注入，PathLinkedText（⌘+点击 / 右键菜单）消费。
private enum OpenDocumentKey: EnvironmentKey {
    static let defaultValue: ((URL) -> Void)? = nil
}

extension EnvironmentValues {
    var openDocument: ((URL) -> Void)? {
        get { self[OpenDocumentKey.self] }
        set { self[OpenDocumentKey.self] = newValue }
    }
}

/// 右侧文档面板：预览 Markdown / 纯文本文档。
/// Markdown 走聊天同款 MarkdownTextView（标题/表格/代码块/引用），
/// 纯文本走等宽可选中原文；头部提供访达 / 外部打开 / 刷新 / 关闭。
struct DocumentPanel: View {
    @ObservedObject var store: DocumentStore
    var onClose: () -> Void
    @Environment(\.chatTypography) private var chatTypography

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            content
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 8) {
            Image(systemName: headerIcon)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let subtitle = headerSubtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let url = store.currentURL {
                iconButton("folder", tip: "在访达中显示") {
                    _ = FileReveal.revealInFinder(url: url)
                }
                iconButton("arrow.up.forward.app", tip: "用默认应用打开") {
                    _ = FileReveal.open(path: url.path)
                }
                iconButton("arrow.clockwise", tip: "重新加载") {
                    store.reload()
                }
            }

            iconButton("xmark.circle.fill", tip: "关闭文档面板", action: onClose)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    /// 头部图标按钮：悬停加深+手型（HoverButtonStyle），提示文字放在 label 上——
    /// plain/自定义 style 按钮的 Button 级 .help 经常不弹出。
    private func iconButton(_ icon: String, tip: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
                .help(tip)
        }
        .buttonStyle(HoverButtonStyle())
    }

    private var headerIcon: String {
        switch store.loadState {
        case .loaded(let doc):
            switch doc.kind {
            case .markdown: return "doc.richtext"
            case .plain: return "doc.plaintext"
            case .pdf: return "doc"
            }
        case .empty:
            return "doc.text"
        case .missing, .unreadable, .tooLarge:
            return "doc.questionmark"
        }
    }

    private var headerTitle: String {
        switch store.loadState {
        case .loaded(let doc):
            return doc.url.lastPathComponent
        case .missing(let path), .unreadable(let path), .tooLarge(let path, _):
            return URL(fileURLWithPath: path).lastPathComponent
        case .empty:
            return "文档"
        }
    }

    private var headerSubtitle: String? {
        store.currentURL?.path
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch store.loadState {
        case .empty:
            placeholder(
                icon: "doc.text.magnifyingglass",
                title: "没有打开的文档",
                message: "在聊天中 ⌘+点击 Markdown / 文本文档路径，即可在此预览"
            )
        case .missing(let path):
            placeholder(
                icon: "doc.questionmark",
                title: "文件不存在",
                message: path
            )
        case .unreadable(let path):
            placeholder(
                icon: "lock.doc",
                title: "无法读取文件",
                message: path
            )
        case .tooLarge(let path, let size):
            VStack(spacing: 10) {
                placeholder(
                    icon: "doc.zipper",
                    title: "文件过大（\(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))）",
                    message: "超过文档预览上限，请使用默认应用打开"
                )
                Button("用默认应用打开") {
                    _ = FileReveal.open(path: path)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let doc):
            documentView(doc)
        }
    }

    private func placeholder(icon: String, title: String, message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.callout.weight(.medium))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
                .padding(.horizontal, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func documentView(_ doc: DocumentStore.Document) -> some View {
        switch doc.kind {
        case .pdf:
            PDFKitView(url: doc.url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .markdown, .plain:
            ScrollView {
                Group {
                    switch doc.kind {
                    case .markdown:
                        MarkdownTextView(text: doc.text)
                    case .plain:
                        Text(doc.text)
                            .font(Font(chatTypography.codeNSFont))
                            .lineSpacing(chatTypography.lineSpacing)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    case .pdf:
                        EmptyView()
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlayScrollers()
            }
            .scrollIndicators(.automatic)
        }
    }
}

/// PDFKit host for the document panel. The store performs an attribute-only 50 MB guard;
/// PDFKit then loads from the URL instead of decoding the file into a String.
private struct PDFKitView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.document = PDFDocument(url: url)
        return view
    }

    func updateNSView(_ nsView: PDFView, context: Context) {
        if nsView.document?.documentURL?.standardizedFileURL.path
            != url.standardizedFileURL.path {
            nsView.document = PDFDocument(url: url)
        }
    }
}
