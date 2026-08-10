import Foundation

/// 文档面板的多 tab 容器：每个 tab 一个独立 DocumentStore（读盘 / 监听互不干扰）。
/// UI mutations stay on main（same convention as `DocumentStore` / `ChatSession`）。
package final class DocumentTabsStore: ObservableObject {

    package struct Tab: Identifiable, Equatable {
        package let id: String
        package let url: URL
    }

    @Published package private(set) var tabs: [Tab] = []
    @Published package private(set) var selectedTabID: String?

    private var stores: [String: DocumentStore] = [:]
    /// Markdown-only reader state is owned per tab, alongside its independent loader.
    /// Keeping it here makes tab switches/reloads preserve reader context without touching chat.
    private var readerStates: [String: DocumentReaderState] = [:]

    package init() {}

    /// 当前选中 tab 的加载器；无 tab 时为 nil（面板占位态）。
    package var activeStore: DocumentStore? {
        guard let id = selectedTabID else { return nil }
        return stores[id]
    }

    package var selectedTab: Tab? {
        tabs.first { $0.id == selectedTabID }
    }

    /// Current tab's Markdown reader state. PDF/plain tabs leave this intentionally inert.
    package var activeReaderState: DocumentReaderState? {
        guard let id = selectedTabID else { return nil }
        return readerStates[id]
    }

    package func readerState(for id: String) -> DocumentReaderState? {
        readerStates[id]
    }

    /// 打开（或切换到）一个文档；同路径不重复开 tab。
    package func open(_ url: URL) {
        if let existing = tabs.first(where: { $0.url.path == url.path }) {
            selectedTabID = existing.id
            return
        }
        let tab = Tab(id: UUID().uuidString, url: url)
        tabs.append(tab)
        selectedTabID = tab.id
        let store = DocumentStore()
        stores[tab.id] = store
        readerStates[tab.id] = DocumentReaderState()
        store.open(url)
    }

    package func select(id: String) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        selectedTabID = id
    }

    package func closeTab(id: String) {
        stores[id] = nil
        readerStates[id] = nil
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: index)
        if selectedTabID == id {
            selectedTabID = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)].id
        }
    }

    // MARK: - Persistence

    package func persistenceSnapshot() -> (paths: [String], selectedPath: String?) {
        (tabs.map(\.url.path), selectedTab?.url.path)
    }

    /// 从持久化恢复：文件已不存在的直接跳过，避免恢复出一排「文件不存在」。
    package func restore(paths: [String], selectedPath: String?) {
        guard tabs.isEmpty else { return }
        for path in paths {
            guard FileManager.default.fileExists(atPath: path) else { continue }
            let url = URL(fileURLWithPath: path)
            guard !tabs.contains(where: { $0.url.path == url.path }) else { continue }
            let tab = Tab(id: UUID().uuidString, url: url)
            tabs.append(tab)
            let store = DocumentStore()
            stores[tab.id] = store
            readerStates[tab.id] = DocumentReaderState()
            store.open(url)
        }
        if let selectedPath, let hit = tabs.first(where: { $0.url.path == selectedPath }) {
            selectedTabID = hit.id
        } else {
            selectedTabID = tabs.first?.id
        }
    }
}
