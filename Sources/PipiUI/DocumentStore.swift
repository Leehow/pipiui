import Foundation

/// 文档面板可渲染的文档类型。
package enum DocumentKind: Equatable, Sendable {
    /// Markdown（.md / .markdown …）→ MarkdownTextView 渲染。
    case markdown
    /// 纯文本（.txt / .log / 无扩展的 README 等）→ 等宽可选中原文。
    case plain
    /// PDF → PDFKit 按 URL 分页渲染，不解码为文本。
    case pdf
}

/// 判定哪些本地文件进右侧文档面板（其余维持访达显示）。
/// 白名单制：只对明确的文档扩展名 / 知名无扩展文档名开放，
/// 代码文件（.swift / .py …）仍然 ⌘+点击 → 访达。
package enum DocumentDetector {
    /// 渲染为 Markdown 的扩展名（小写，不含点）。
    package static let markdownExtensions: Set<String> = [
        "md", "markdown", "mdx", "mdown", "mkd",
    ]
    /// 渲染为纯文本的扩展名（小写，不含点）。
    package static let plainTextExtensions: Set<String> = [
        "txt", "text", "log",
    ]
    /// PDFKit 渲染的扩展名（小写，不含点）。
    package static let pdfExtensions: Set<String> = [
        "pdf",
    ]
    /// 知名无扩展文档名 → 纯文本（无标记散文按 markdown 猜会误伤下划线等）。
    package static let docBasenames: Set<String> = [
        "readme", "license", "licence", "copying", "changelog", "changes",
        "notice", "authors", "contributors", "todo", "notes",
    ]

    /// 返回面板渲染方式；nil = 不是文档 → 调用方回退到访达显示。
    package static func kind(for url: URL) -> DocumentKind? {
        let ext = url.pathExtension.lowercased()
        if !ext.isEmpty {
            if markdownExtensions.contains(ext) { return .markdown }
            if plainTextExtensions.contains(ext) { return .plain }
            if pdfExtensions.contains(ext) { return .pdf }
            return nil
        }
        if docBasenames.contains(url.lastPathComponent.lowercased()) { return .plain }
        return nil
    }

    /// 便捷判断（click 路由用）。
    package static func isDocument(_ url: URL) -> Bool {
        kind(for: url) != nil
    }
}

/// 每个会话一份的文档面板状态：加载文本文件、监听磁盘变化自动刷新
///（pi / 编辑器 atomic save 安全），超大文件拒绝渲染并转外部打开。
/// UI mutations stay on main (same convention as `ChatSession`); not `@MainActor`
/// so `ChatSession.lazy` can construct it without isolation errors.
package final class DocumentStore: ObservableObject {

    package init() {}

    package struct Document: Equatable {
        package let url: URL
        package let kind: DocumentKind
        package let text: String
        package let fileSize: Int
        package let modifiedAt: Date?
    }

    package enum LoadState: Equatable {
        /// 尚未打开任何文档（面板占位态）。
        case empty
        case loaded(Document)
        /// 路径曾经有效、现已不存在。
        case missing(path: String)
        /// 超过 maxFileSize，拒绝渲染。
        case tooLarge(path: String, size: Int)
        /// 存在但读不出来（权限等）。
        case unreadable(path: String)
    }

    /// 渲染上限：超过则提示改用外部应用，避免一个巨型 log 卡死面板。
    package static let maxFileSize = 2 * 1024 * 1024
    /// PDFKit 按 URL 分页，不整文件读成 String；只用文件属性执行独立的大小保护。
    package static let pdfMaxFileSize = 50 * 1024 * 1024

    @Published package private(set) var loadState: LoadState = .empty
    /// 当前目标文件（含 missing / tooLarge 等失败态），供头部按钮使用。
    @Published package private(set) var currentURL: URL?
    /// T25: 磁盘读取在后台进行时置 true；主线程只负责状态切换。
    ///（`LoadState` 未新增 case：DocumentPanel 对 loadState 做穷尽 switch，
    ///  加 case 会破坏其编译，故 loading 以独立标志表达。）
    @Published package private(set) var isLoading = false

    private var watcher: DispatchSourceFileSystemObject?
    private var reloadWork: DispatchWorkItem?
    /// 递增令牌：快速连续 open/reload 时，过期后台读的结果直接丢弃。
    private var loadGeneration = 0

    deinit {
        reloadWork?.cancel()
        // Avoid calling MainActor `stopWatching()` from nonisolated deinit.
        watcher?.cancel()
        watcher = nil
    }

    /// 打开（或切换到）一个文档，总是从磁盘重新加载。
    package func open(_ url: URL) {
        load(url)
    }

    /// 手动刷新当前文档。
    package func reload() {
        guard let url = currentURL else { return }
        load(url)
    }

    /// 清空面板（回到占位态）。
    package func close() {
        reloadWork?.cancel()
        stopWatching()
        loadGeneration += 1
        isLoading = false
        currentURL = nil
        loadState = .empty
    }

    // MARK: - Loading

    private func load(_ url: URL) {
        reloadWork?.cancel()
        stopWatching()
        currentURL = url
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true

        let kind = DocumentDetector.kind(for: url) ?? .plain
        // T25: fileExists + attributesOfItem + Data(contentsOf:) 全部挪后台，
        // 主线程不再为 ⌘+点击阻塞读盘（上限 2 MB）。
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Self.readFromDisk(url: url, kind: kind)
            DispatchQueue.main.async {
                guard let self, self.loadGeneration == generation else { return }
                self.isLoading = false
                self.loadState = result
                if case .loaded = result {
                    self.startWatching(url)
                }
            }
        }
    }

    /// 纯磁盘读取，无任何 UI 状态；可在任意队列调用。
    private static func readFromDisk(url: URL, kind: DocumentKind) -> LoadState {
        let path = url.path
        guard FileManager.default.fileExists(atPath: path) else {
            return .missing(path: path)
        }
        if kind == .pdf {
            do {
                let attrs = try FileManager.default.attributesOfItem(atPath: path)
                let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
                guard size <= pdfMaxFileSize else {
                    return .tooLarge(path: path, size: size)
                }
                return .loaded(Document(
                    url: url,
                    kind: .pdf,
                    text: "",
                    fileSize: size,
                    modifiedAt: attrs[.modificationDate] as? Date
                ))
            } catch {
                return .unreadable(path: path)
            }
        }
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: path)
            let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
            guard size <= maxFileSize else {
                return .tooLarge(path: path, size: size)
            }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            // 有损 UTF-8：扩展名已白名单，乱码好过直接打不开。
            let text = String(decoding: data, as: UTF8.self)
            let doc = Document(
                url: url,
                kind: kind,
                text: text,
                fileSize: size,
                modifiedAt: attrs[.modificationDate] as? Date
            )
            return .loaded(doc)
        } catch {
            return .unreadable(path: path)
        }
    }

    // MARK: - File watching（agent 实时改文档 → 面板跟随）

    private func startWatching(_ url: URL) {
        stopWatching()
        let fd = Darwin.open(url.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename, .delete],
            queue: .main
        )
        source.setEventHandler { [weak self] in
            self?.scheduleReload()
        }
        source.setCancelHandler {
            Darwin.close(fd)
        }
        source.resume()
        watcher = source
    }

    private func stopWatching() {
        watcher?.cancel()
        watcher = nil
    }

    /// 去抖 reload：编辑器 / atomic save 常一连串事件。
    private func scheduleReload() {
        reloadWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.reload()
        }
        reloadWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }
}
