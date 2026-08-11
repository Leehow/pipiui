import Combine
import Foundation

/// 内置浏览器的多 tab 容器：每个 tab 一个独立 WebViewStore（WKWebView）。
/// pi 的 browser 工具仍经 `active`（选中 tab）驱动；恢复回来的 tab 只在
/// 被选中 / 被桥接触达时才创建 webview 并加载，避免启动即发网络请求。
final class WebTabsStore: ObservableObject {

    struct Tab: Identifiable, Equatable {
        let id: String
    }

    @Published private(set) var tabs: [Tab] = []
    @Published private(set) var selectedTabID: String?

    private var engines: [String: WebViewStore] = [:]
    /// 恢复出的待加载 URL。不放进 `Tab`：消费它不产生 published 变更，
    /// 视图 body 里惰性建 engine 时不会触发 SwiftUI 更新期写状态。
    private var pendingURLs: [String: String] = [:]
    private var engineCancellables: [String: AnyCancellable] = [:]
    /// 持久化层订阅：tab 结构变化 + 各 engine 内部（url / title）变化。
    var changeHandler: (() -> Void)?

    init() {
        addTab()
    }

    // MARK: - Query

    var selectedTab: Tab? { tabs.first { $0.id == selectedTabID } }

    /// 用户打开过网页时显示全部标签数；初始的空白默认 tab 不计入活动数。
    var activityCount: Int { isFresh ? 0 : tabs.count }

    /// 选中 tab 的 engine。容器恒有 ≥1 个 tab，故总是可取值。
    var active: WebViewStore {
        engine(for: selectedTabID ?? tabs[0].id)
    }

    func engineOrNil(for id: String) -> WebViewStore? {
        engines[id]
    }

    /// 惰性建 engine：首次取用时才 new WebViewStore（并消费待加载 URL）。
    func engine(for id: String) -> WebViewStore {
        if let hit = engines[id] { return hit }
        let engine = WebViewStore()
        engines[id] = engine
        engineCancellables[id] = engine.objectWillChange.sink { [weak self] _ in
            self?.changeHandler?()
        }
        if let pending = pendingURLs.removeValue(forKey: id) {
            _ = engine.navigate(pending)
        }
        return engine
    }

    func displayTitle(for tab: Tab) -> String {
        if let engine = engines[tab.id] {
            if !engine.title.isEmpty { return engine.title }
            if !engine.urlString.isEmpty, let url = URL(string: engine.urlString), let host = url.host {
                return host
            }
            if !engine.urlString.isEmpty { return engine.urlString }
        }
        if let pending = pendingURLs[tab.id] {
            if let url = URL(string: pending), let host = url.host { return host }
            return pending
        }
        return "新标签页"
    }

    // MARK: - Mutations

    @discardableResult
    func addTab(url: String? = nil) -> String {
        let tab = Tab(id: UUID().uuidString)
        tabs.append(tab)
        selectedTabID = tab.id
        if let url, !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            _ = engine(for: tab.id).navigate(url)
        }
        return tab.id
    }

    func select(id: String) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        selectedTabID = id
    }

    /// 关掉最后一个 tab 时补一个全新空 tab，容器不出现空列表。
    func closeTab(id: String) {
        engines[id] = nil
        engineCancellables[id] = nil
        pendingURLs[id] = nil
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: index)
        if tabs.isEmpty {
            let fresh = Tab(id: UUID().uuidString)
            tabs = [fresh]
            selectedTabID = fresh.id
            return
        }
        if selectedTabID == id {
            selectedTabID = tabs[min(index, tabs.count - 1)].id
        }
    }

    // MARK: - Persistence

    struct Snapshot: Equatable {
        var urls: [String]
        var selectedIndex: Int
    }

    func persistenceSnapshot() -> Snapshot {
        let urls = tabs.map { tab -> String in
            if let engine = engines[tab.id], !engine.urlString.isEmpty {
                return engine.urlString
            }
            return pendingURLs[tab.id] ?? ""
        }
        let selectedIndex = tabs.firstIndex { $0.id == selectedTabID } ?? 0
        return Snapshot(urls: urls, selectedIndex: selectedIndex)
    }

    /// 初始态：仅一个未加载内容的空 tab（可安全恢复）。
    var isFresh: Bool {
        guard tabs.count == 1, pendingURLs.isEmpty else { return false }
        let id = tabs[0].id
        guard let engine = engines[id] else { return true }
        return engine.urlString.isEmpty && !engine.isLoading
    }

    /// 从持久化恢复：全部以 pendingURL 形式挂回，取用时才加载。
    func restore(urls: [String], selectedIndex: Int) {
        guard isFresh else { return }
        let valid = urls.filter { !$0.isEmpty }
        guard !valid.isEmpty else { return }
        engines.removeAll()
        engineCancellables.removeAll()
        tabs = valid.map { _ in Tab(id: UUID().uuidString) }
        for (index, tab) in tabs.enumerated() {
            pendingURLs[tab.id] = valid[index]
        }
        let clamped = min(max(selectedIndex, 0), tabs.count - 1)
        selectedTabID = tabs[clamped].id
    }
}
