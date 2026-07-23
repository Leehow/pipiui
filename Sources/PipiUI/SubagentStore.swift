import Foundation
import Combine

/// subagent 工作流水里的一条记录（文本/思考/工具调用/工具结果）。
struct AgentLogItem: Identifiable, Equatable, Codable {
    let id: Int
    let kind: String // text / thinking / tool / toolResult
    let name: String
    let text: String
    let isError: Bool
}

/// 一个被派出的 subagent 的实时状态（由扩展通过桥接上报）。
struct SubagentInfo: Identifiable, Equatable, Codable {
    enum State: String, Equatable, Codable {
        case running, ok, failed, aborted
        /// App 重启时仍在运行的 agent：进程已不在，标记为中断
        case interrupted
    }

    let id: String
    let parentId: String?
    /// 派出它的主会话 subagent 工具调用 id（用于主界面卡片归属匹配）
    var toolCallId: String?
    let name: String
    let task: String
    let depth: Int
    let model: String?
    var state: State = .running
    var output = ""
    var activity = ""
    var log: [AgentLogItem] = []
    var cost: Double = 0
    var turns = 0
    var started = Date()
    var ended: Date?
}

/// 每个会话一棵 subagent 树；agent_event 桥接事件在主线程进来。
final class SubagentStore: ObservableObject {
    @Published private(set) var agents: [SubagentInfo] = []
    @Published var selectedId: String?
    private var logCounter = 0
    private var persistURL: URL?
    private var saveScheduled = false

    // MARK: - 持久化（跟随 pi 会话文件，App 崩溃/重启后恢复 agent 树）

    /// 会话文件路径已知后挂载持久化：加载历史 agent 树，此后每次事件防抖落盘。
    func attachPersistence(sessionFile: String) {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
        let name = URL(fileURLWithPath: sessionFile).deletingPathExtension().lastPathComponent + ".agents.json"
        let url = dir.appendingPathComponent(name)
        guard persistURL != url else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        persistURL = url

        if agents.isEmpty,
           let data = try? Data(contentsOf: url),
           var loaded = try? JSONDecoder().decode([SubagentInfo].self, from: data) {
            // 上次退出时还在跑的 agent：进程已不存在，如实标记为中断
            for i in loaded.indices where loaded[i].state == .running {
                loaded[i].state = .interrupted
                loaded[i].activity = ""
                loaded[i].ended = loaded[i].ended ?? Date()
            }
            agents = loaded
            logCounter = loaded.flatMap(\.log).map(\.id).max() ?? 0
            if selectedId == nil { selectedId = agents.last?.id }
        }
    }

    private func scheduleSave() {
        guard persistURL != nil, !saveScheduled else { return }
        saveScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.saveScheduled = false
            self?.saveNow()
        }
    }

    func saveNow() {
        guard let persistURL, let data = try? JSONEncoder().encode(agents) else { return }
        try? data.write(to: persistURL, options: .atomic)
    }

    var runningCount: Int {
        agents.lazy.filter { $0.state == .running }.count
    }

    var totalCost: Double {
        agents.reduce(0) { $0 + $1.cost }
    }

    /// 打开 Subagents 面板时选中最近启动的 agent；不会在面板已打开时抢走用户的手动选择。
    func selectLatest() {
        selectedId = agents.max(by: { $0.started < $1.started })?.id
    }

    func handle(_ e: J) {
        guard let id = e["agentId"].string, !id.isEmpty else { return }
        switch e["kind"].string ?? "" {
        case "start":
            guard !agents.contains(where: { $0.id == id }) else { return }
            agents.append(SubagentInfo(
                id: id,
                parentId: e["parentId"].string,
                toolCallId: e["toolCallId"].string,
                name: e["name"].string ?? "agent",
                task: e["task"].string ?? "",
                depth: max(1, e["depth"].int ?? 1),
                model: e["model"].string
            ))
            if selectedId == nil { selectedId = id }
        case "update":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = e["activity"].string ?? agents[i].activity
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
        case "log":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            for item in e["items"].array {
                logCounter += 1
                agents[i].log.append(AgentLogItem(
                    id: logCounter,
                    kind: item["itemType"].string ?? "text",
                    name: item["name"].string ?? "",
                    text: item["text"].string ?? "",
                    isError: item["isError"].bool ?? false
                ))
            }
            if agents[i].log.count > 800 {
                agents[i].log.removeFirst(agents[i].log.count - 800)
            }
        case "end":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            if e["aborted"].bool == true {
                agents[i].state = .aborted
            } else {
                agents[i].state = (e["ok"].bool == true) ? .ok : .failed
            }
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = ""
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
            agents[i].ended = Date()
        default:
            break
        }
        scheduleSave()
    }

    /// 按树序展开（父节点后紧跟其子孙），用于列表显示。
    var displayOrder: [SubagentInfo] {
        var byParent: [String?: [SubagentInfo]] = [:]
        for agent in agents {
            byParent[agent.parentId, default: []].append(agent)
        }
        // 根：parentId 为空，或父节点不在本树里（例如更上层是主会话）
        let knownIds = Set(agents.map(\.id))
        var result: [SubagentInfo] = []
        func append(_ node: SubagentInfo) {
            result.append(node)
            for child in byParent[node.id] ?? [] { append(child) }
        }
        for agent in agents where agent.parentId == nil || !knownIds.contains(agent.parentId!) {
            append(agent)
        }
        return result
    }

    func clearFinished() {
        agents.removeAll { $0.state != .running }
        if let selected = selectedId, !agents.contains(where: { $0.id == selected }) {
            selectedId = agents.first?.id
        }
        scheduleSave()
    }
}
