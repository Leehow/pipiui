import Combine
import Foundation

/// 内嵌终端的多 tab 容器：每个 tab 一个独立 `TerminalSessionStore`（独立 PTY）。
/// 不持久化——PTY / 滚动缓冲无法可靠恢复；会话级内存即可。
/// UI mutations stay on main（same convention as `TerminalSessionStore` / `ChatSession`）。
final class TerminalTabsStore: ObservableObject {

    struct Tab: Identifiable, Equatable {
        let id: String
    }

    @Published private(set) var tabs: [Tab] = []
    @Published private(set) var selectedTabID: String?

    private let projectURL: URL
    private var sessions: [String: TerminalSessionStore] = [:]
    private var sessionCancellables: [String: AnyCancellable] = [:]

    init(projectURL: URL) {
        self.projectURL = projectURL
        _ = open()
    }

    // MARK: - Query

    var selectedTab: Tab? { tabs.first { $0.id == selectedTabID } }

    /// 选中 tab 的会话。容器恒有 ≥1 个 tab，故总是可取值。
    var active: TerminalSessionStore {
        session(for: selectedTabID ?? tabs[0].id)
    }

    func sessionOrNil(for id: String) -> TerminalSessionStore? {
        sessions[id]
    }

    func session(for id: String) -> TerminalSessionStore {
        if let hit = sessions[id] { return hit }
        let store = TerminalSessionStore(projectURL: projectURL)
        sessions[id] = store
        sessionCancellables[id] = store.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        return store
    }

    func displayTitle(for tab: Tab) -> String {
        if let store = sessions[tab.id] {
            let trimmed = store.title.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        return "终端"
    }

    // MARK: - Mutations

    /// 新建 tab 并选中；返回新 tab id。
    @discardableResult
    func open() -> String {
        let tab = Tab(id: UUID().uuidString)
        tabs.append(tab)
        selectedTabID = tab.id
        // 预创建 session，便于 tab 标题订阅立刻挂上。
        _ = session(for: tab.id)
        return tab.id
    }

    func select(id: String) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        selectedTabID = id
    }

    /// 选中最近一个 tab（右侧栏终端按钮打开时用）。
    func selectLatest() {
        guard let last = tabs.last else {
            _ = open()
            return
        }
        selectedTabID = last.id
    }

    /// 关掉最后一个 tab 时补一个全新空 tab，容器不出现空列表。
    func closeTab(id: String) {
        sessions[id] = nil
        sessionCancellables[id] = nil
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: index)
        if tabs.isEmpty {
            _ = open()
            return
        }
        if selectedTabID == id {
            selectedTabID = tabs[min(index, tabs.count - 1)].id
        }
    }
}
