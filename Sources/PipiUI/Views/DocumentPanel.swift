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

/// 右侧文档面板：多 tab 预览 Markdown / 纯文本 / PDF 文档。
/// 顶部 tab 条切换已打开的文档（⌘+点击聊天中的文档路径追加 tab），
/// 内容区沿用单文档视图：访达 / 外部打开 / 刷新。
struct DocumentPanel: View {
    @ObservedObject var store: DocumentTabsStore

    var body: some View {
        VStack(spacing: 0) {
            if !store.tabs.isEmpty {
                tabStrip
                Divider()
            }
            if let active = store.activeStore,
               let readerState = store.activeReaderState {
                DocumentTabContent(
                    store: active,
                    readerState: readerState,
                    onOpenDocument: { url in
                        store.open(url)
                    }
                )
            } else {
                emptyState
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    // MARK: - Tab strip

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(store.tabs) { tab in
                    PanelTabChip(
                        icon: tabIcon(for: tab.url),
                        title: tab.url.lastPathComponent,
                        isSelected: tab.id == store.selectedTabID,
                        onSelect: { store.select(id: tab.id) },
                        onClose: { store.closeTab(id: tab.id) }
                    )
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func tabIcon(for url: URL) -> String {
        switch DocumentDetector.kind(for: url) {
        case .markdown: return "doc.richtext"
        case .plain: return "doc.plaintext"
        case .pdf: return "doc"
        case nil: return "doc.text"
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(.tertiary)
                Text("没有打开的文档")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                Text("在聊天中 ⌘+点击 Markdown / 文本文档路径，即可在此预览")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .padding(.horizontal, 20)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// 单个文档 tab 的内容：Markdown 复用聊天同一 AST/TextKit 渲染，装入原生阅读器；
/// 纯文本走等宽可选中原文；头部提供访达 / 外部打开 / 刷新。
struct DocumentTabContent: View {
    @ObservedObject var store: DocumentStore
    @ObservedObject var readerState: DocumentReaderState
    /// Relative Markdown links return through this tab container so document files open as tabs.
    let onOpenDocument: (URL) -> Void
    @Environment(\.chatTypography) private var chatTypography
    @FocusState private var findFieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            readerControls
            Divider()
            content
        }
        .onChange(of: readerState.findFocusGeneration) { _, _ in
            guard markdownDocument != nil else { return }
            findFieldFocused = true
        }
        .onExitCommand {
            guard readerState.isFindVisible else { return }
            readerState.dismissFind()
            findFieldFocused = false
        }
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

            if markdownDocument != nil {
                iconButton("magnifyingglass", tip: "在文档中查找（⌘F）") {
                    readerState.showFind()
                }
                if !markdownHeadings.isEmpty {
                    iconButton(
                        readerState.isTableOfContentsVisible ? "list.bullet.indent" : "list.bullet",
                        tip: readerState.isTableOfContentsVisible ? "隐藏目录" : "显示目录"
                    ) {
                        readerState.toggleTableOfContents()
                    }
                }
            }

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
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
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

    private var markdownDocument: DocumentStore.Document? {
        guard case .loaded(let doc) = store.loadState, doc.kind == .markdown else {
            return nil
        }
        return doc
    }

    /// Reuses MarkdownTextView's cached AST; no line-oriented outline parser is introduced.
    private var markdownHeadings: [MarkdownDocumentHeading] {
        guard let doc = markdownDocument else { return [] }
        return MarkdownDocumentOutline.headings(from: doc.text)
    }

    private var findBinding: Binding<String> {
        Binding(
            get: { readerState.findQuery },
            set: { readerState.updateFindQuery($0) }
        )
    }

    @ViewBuilder
    private var readerControls: some View {
        if markdownDocument != nil {
            if readerState.isFindVisible {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("查找", text: findBinding)
                        .textFieldStyle(.roundedBorder)
                        .focused($findFieldFocused)
                        .onSubmit { readerState.findNext() }
                        .accessibilityLabel("在文档中查找")
                    Button {
                        readerState.findPrevious()
                    } label: {
                        Image(systemName: "chevron.up")
                    }
                    .buttonStyle(HoverButtonStyle())
                    .help("上一个匹配（⇧⌘G）")
                    Button {
                        readerState.findNext()
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                    .buttonStyle(HoverButtonStyle())
                    .help("下一个匹配（⌘G）")
                    Button {
                        readerState.dismissFind()
                        findFieldFocused = false
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(HoverButtonStyle())
                    .help("关闭查找")
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 7)
            }

            if readerState.isTableOfContentsVisible, !markdownHeadings.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(markdownHeadings) { heading in
                            Button {
                                readerState.requestHeadingJump(to: heading.id)
                            } label: {
                                Text(heading.title)
                                    .font(.caption)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                    .foregroundStyle(
                                        readerState.activeHeadingID == heading.id
                                            ? Color.accentColor
                                            : Color.primary
                                    )
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.leading, CGFloat(max(0, heading.level - 1)) * 10)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                            }
                            .buttonStyle(HoverButtonStyle())
                            .accessibilityLabel("跳转到 \(heading.title)")
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 7)
                }
                .frame(maxHeight: 132)
            }
        }
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
        let renderContext = MarkdownRenderContext.document(documentURL: doc.url)
        switch doc.kind {
        case .pdf:
            PDFKitView(url: doc.url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .markdown:
            DocumentMarkdownReaderView(
                markdownText: doc.text,
                headings: markdownHeadings,
                readerState: readerState,
                typography: chatTypography,
                renderContext: renderContext,
                onOpenDocument: onOpenDocument,
                onFlash: nil
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .plain:
            let renderStyle = MarkdownRenderStyle(
                typography: chatTypography,
                context: renderContext
            )
            ScrollView {
                Text(doc.text)
                    .font(Font(renderStyle.codeNSFont))
                    .lineSpacing(renderStyle.lineSpacing)
                    .textSelection(.enabled)
                    .frame(maxWidth: MarkdownRenderContext.documentReaderMaximumMeasure, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, MarkdownRenderContext.documentReaderHorizontalInset)
                    .padding(.vertical, MarkdownRenderContext.documentReaderVerticalInset)
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
