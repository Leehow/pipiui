import Foundation

/// SettingsDataStore — 设置页数据的进程级缓存。
///
/// 解决「打开设置每次现加载/卡顿」：启动时由 `AppStore.init` 调 `warm()`
/// 在后台预热（auth 快照 + list-models + list-providers 子进程），常驻内存；
/// SettingsSheet 打开时先同步渲染缓存，再后台刷新并回写缓存。
/// 读写均经 NSLock 保护（缓存可能在后台线程写入、主线程读取）；
/// 不提供发布订阅——SettingsSheet 自己持有 @State 副本，缓存只作数据源。
final class SettingsDataStore: ObservableObject {
    static let shared = SettingsDataStore()

    private let lock = NSLock()
    private var _snapshot: SettingsSheet.ReloadSnapshot?
    private var _models: [ModelInfo]?
    private var _providers: [PiAuthHelper.LoginProvider]?
    /// warm 只跑一次。
    private var didWarm = false

    private init() {}

    var snapshot: SettingsSheet.ReloadSnapshot? {
        lock.lock(); defer { lock.unlock() }
        return _snapshot
    }

    var models: [ModelInfo]? {
        lock.lock(); defer { lock.unlock() }
        return _models
    }

    var providers: [PiAuthHelper.LoginProvider]? {
        lock.lock(); defer { lock.unlock() }
        return _providers
    }

    func update(snapshot: SettingsSheet.ReloadSnapshot) {
        lock.lock()
        _snapshot = snapshot
        lock.unlock()
    }

    /// 空列表不回写（失败/无凭据场景不应覆盖已有缓存）。
    func update(models: [ModelInfo]) {
        guard !models.isEmpty else { return }
        lock.lock()
        _models = models
        lock.unlock()
    }

    func update(providers: [PiAuthHelper.LoginProvider]) {
        guard !providers.isEmpty else { return }
        lock.lock()
        _providers = providers
        lock.unlock()
    }

    /// 启动调用一次：全程后台，失败 = 缓存为空，设置页退回原有现加载路径。
    func warm() {
        lock.lock()
        guard !didWarm else { lock.unlock(); return }
        didWarm = true
        lock.unlock()
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            let snapshot = SettingsSheet.loadReloadSnapshot()
            async let fetchedModels = try? PiAuthHelper.listModels()
            async let fetchedProviders = try? PiAuthHelper.listProviders()
            self.update(snapshot: snapshot)
            if let models = await fetchedModels { self.update(models: models) }
            if let providers = await fetchedProviders { self.update(providers: providers) }
        }
    }
}
