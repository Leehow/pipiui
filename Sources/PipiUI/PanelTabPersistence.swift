import Combine
import Foundation

/// 面板 tab（浏览器页面 + 文档）的保留时长设置。
/// 默认 72 小时；0 = 永久保留。随会话落盘，超期快照在恢复时丢弃。
enum PanelTabSettings {
    static let retentionHoursKey = "pipiui.panelTabRetentionHours"
    static let defaultRetentionHours: Double = 72
    static let foreverHours: Double = 0

    static func retentionHours(defaults: UserDefaults = .standard) -> Double {
        guard let number = defaults.object(forKey: retentionHoursKey) as? NSNumber else {
            return defaultRetentionHours
        }
        let value = number.doubleValue
        guard value.isFinite, value >= 0 else { return defaultRetentionHours }
        return value
    }

    static func setRetentionHours(_ hours: Double, defaults: UserDefaults = .standard) {
        guard hours.isFinite, hours >= 0 else { return }
        defaults.set(hours, forKey: retentionHoursKey)
    }
}

/// 落盘快照：某会话打开过的浏览器页面 + 文档。`savedAtEpoch` 决定保留期是否过期。
struct PanelTabSnapshot: Codable, Equatable {
    var savedAtEpoch: Double
    var webTabURLs: [String]
    var selectedWebIndex: Int
    var documentPaths: [String]
    var selectedDocumentPath: String?

    var savedAt: Date { Date(timeIntervalSince1970: savedAtEpoch) }

    /// `retentionHours <= 0` 表示永久保留。
    func isExpired(retentionHours: Double, now: Date = Date()) -> Bool {
        guard retentionHours > 0 else { return false }
        return now.timeIntervalSince(savedAt) > retentionHours * 3600
    }

    /// 无任何可恢复内容（全新空 tab + 无文档）。
    var isEmpty: Bool {
        webTabURLs.allSatisfy { $0.isEmpty } && documentPaths.isEmpty
    }
}

/// 会话级面板 tab 持久化：会话文件确定后挂载 → 恢复历史（过期丢弃），
/// 此后随变更防抖落盘。文件与 subagent 树同目录风格（Application Support/PipiUI）。
final class PanelTabPersistence {
    private let webTabs: WebTabsStore
    private let documentTabs: DocumentTabsStore
    private var persistURL: URL?
    private var saveWork: DispatchWorkItem?
    private var cancellables: Set<AnyCancellable> = []
    private var restored = false

    /// 落盘前的防抖窗口（与 subagent 树同量级，避免打字期频繁写盘）。
    static let saveDebounce: TimeInterval = 1.0

    init(webTabs: WebTabsStore, documentTabs: DocumentTabsStore) {
        self.webTabs = webTabs
        self.documentTabs = documentTabs
    }

    static func persistenceURL(forSessionFile sessionFile: String) -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/panel-tabs")
        let name = URL(fileURLWithPath: sessionFile).deletingPathExtension().lastPathComponent + ".panel.json"
        return dir.appendingPathComponent(name)
    }

    func attach(sessionFile: String) {
        let url = Self.persistenceURL(forSessionFile: sessionFile)
        guard persistURL != url else { return }
        flushPendingSave()
        persistURL = url
        restored = false
        restore(from: url)
        subscribe()
        // 恢复后重写一次快照：savedAt 刷新为最近使用时间，保留期从最后一次打开起算。
        scheduleSave()
    }

    deinit {
        saveWork?.cancel()
    }

    // MARK: - Restore

    private func restore(from url: URL) {
        guard !restored else { return }
        restored = true
        guard let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(PanelTabSnapshot.self, from: data) else {
            return
        }
        if snapshot.isExpired(retentionHours: PanelTabSettings.retentionHours()) {
            try? FileManager.default.removeItem(at: url)
            return
        }
        webTabs.restore(urls: snapshot.webTabURLs, selectedIndex: snapshot.selectedWebIndex)
        documentTabs.restore(paths: snapshot.documentPaths, selectedPath: snapshot.selectedDocumentPath)
    }

    // MARK: - Save

    private func subscribe() {
        cancellables.removeAll()
        webTabs.objectWillChange
            .sink { [weak self] _ in self?.scheduleSave() }
            .store(in: &cancellables)
        documentTabs.objectWillChange
            .sink { [weak self] _ in self?.scheduleSave() }
            .store(in: &cancellables)
        // engine 内部 url/title 变化不经过容器 objectWillChange，单独转发。
        webTabs.changeHandler = { [weak self] in self?.scheduleSave() }
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.writeNow() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.saveDebounce, execute: work)
    }

    private func flushPendingSave() {
        guard saveWork != nil else { return }
        saveWork?.cancel()
        saveWork = nil
        writeNow()
    }

    private func writeNow() {
        guard let persistURL else { return }
        let web = webTabs.persistenceSnapshot()
        let docs = documentTabs.persistenceSnapshot()
        let snapshot = PanelTabSnapshot(
            savedAtEpoch: Date().timeIntervalSince1970,
            webTabURLs: web.urls,
            selectedWebIndex: web.selectedIndex,
            documentPaths: docs.paths,
            selectedDocumentPath: docs.selectedPath
        )
        if snapshot.isEmpty {
            // 没打开过任何东西就不留文件，保持磁盘干净。
            try? FileManager.default.removeItem(at: persistURL)
            return
        }
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? FileManager.default.createDirectory(
            at: persistURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: persistURL, options: .atomic)
    }
}
