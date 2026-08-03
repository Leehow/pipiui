import Foundation

/// Translates jcode api-bridge events into pi-compatible `J` events that
/// ChatSession.handleEvent already understands (UI/state machine reused as-is).
/// `text_delta` accumulates into pi's snapshot-style `message_update`.
struct JcodeEventTranslator {
    private var accumulated = ""

    /// Returns 0..N pi-compatible J events for one jcode event. Unknown events → empty.
    mutating func translate(event: [String: Any]) -> [J] {
        guard let ev = event["ev"] as? String else { return [] }
        switch ev {
        case "text_delta":
            var out: [J] = []
            if accumulated.isEmpty {
                // First delta of a turn: pi's handleEvent expects agent_start to set
                // isStreaming/agentTurnActive before the stream flushes. jcode never
                // emits a "busy" status, so we synthesize agent_start on first text.
                out.append(J(["type": "agent_start"]))
            }
            accumulated += (event["text"] as? String) ?? ""
            out.append(J(["type":"message_update","message":["role":"assistant",
                        "content":[["type":"text","text":accumulated]]]]))
            return out
        case "tool_start":
            return [J(["type":"tool_execution_start",
                       "toolCallId": event["call_id"] as? String ?? ""])]
        case "tool_done":
            let output = event["output"] as? String ?? ""
            let isError = (event["error"] as? String) != nil
            return [J(["type":"tool_execution_end",
                       "toolCallId": event["call_id"] as? String ?? "",
                       "isError": isError,
                       "result":["content":[["type":"text","text":output]]]])]
        case "turn_done":
            // pi expects message_end (final) then agent_settled.
            let endMsg = J(["type":"message_end","message":["role":"assistant",
                            "content":[["type":"text","text":accumulated]]]])
            accumulated = ""   // reset for next turn
            return [endMsg, J(["type":"agent_settled"])]
        // session_status busy/idle, model_info, etc. handled in JcodeBackend
        default:
            return []   // protocol v1: unknown events ignored
        }
    }
}

/// AgentSessionBackend backed by `jcode api-bridge`. Spawns a JcodeBridge, handshakes,
/// creates one session, and translates events via JcodeEventTranslator.
final class JcodeBackend: AgentSessionBackend {
    var onEvent: ((J) -> Void)?
    var onExit: ((Int32, String) -> Void)?
    private(set) var isRunning = false

    private let bridge: JcodeBridge
    private var translator = JcodeEventTranslator()
    private var sessionID: String?
    // pending RPCs awaiting reply_to
    private var pending: [Int: (J) -> Void] = [:]

    init?(cwd: URL, provider: String? = nil, extraEnv: [String: String] = [:]) {
        guard let b = JcodeBridge(cwd: cwd, provider: provider, extraEnv: extraEnv) else { return nil }
        bridge = b
        b.onEvent = { [weak self] frame in self?.handleBridgeFrame(frame) }
        b.onExit = { [weak self] code, stderr in
            self?.isRunning = false
            self?.onExit?(code, stderr)
        }
    }

    /// Must be called after init: connect + handshake + create_session.
    func start(completion: @escaping (Bool) -> Void) {
        bridge.connectAndHandshake { [weak self] ok in
            guard let self, ok else { completion(false); return }
            self.bridge.request(["req":"create_session","working_dir": self.cwd.path]) { resp in
                // attached reply carries session info
                if let s = resp["session"] as? [String:Any], let id = s["session_id"] as? String {
                    self.sessionID = id
                    self.isRunning = true
                    completion(true)
                } else { completion(false) }
            }
        }
    }
    private var cwd: URL { bridge.workingDir }   // expose from JcodeBridge

    private func handleBridgeFrame(_ frame: [String: Any]) {
        // Translate jcode event → pi J events. The translator owns agent_start
        // emission (synthesized on the first text_delta of each turn), since real
        // jcode never emits session_status{status:"busy"}. session_status
        // {attached,idle} doesn't map cleanly to pi's turn lifecycle; turn end is
        // handled by the translator's turn_done → agent_settled.
        var t = translator
        for j in t.translate(event: frame) { onEvent?(j) }
        translator = t
    }

    // MARK: AgentSessionBackend
    func send(_ object: [String: Any], failure: (() -> Void)?) {
        // ChatSession.abort() sends ["type":"abort"]; map to jcode's cancel.
        // Without this, Stop doesn't interrupt the in-flight LLM call until the
        // multi-second escalation reaches Tier-3 (kill bridge), wasting tokens.
        if (object["type"] as? String) == "abort", let sid = sessionID {
            bridge.request(["req": "cancel", "session_id": sid]) { _ in }
            return
        }
        // Other pi-generic sends have no direct jcode equivalent; no-op.
    }
    func request(_ object: [String: Any], completion: ((J) -> Void)?) {
        // Map pi RPC types to jcode. Only the ones handleEvent/loadInitialState use.
        let type = object["type"] as? String
        switch type {
        case "prompt":
            sendPrompt(object["message"] as? String ?? "", images: [], completion: { _ in completion?(J(["success":true])) })
        case "get_messages":
            loadHistory(completion: { items in completion?(J(["success":true,"data":["messages":[]]])) })  // Task 4 refines
        case "get_state":
            completion?(J(["success":true,"data":[:]]))  // Task 4 fills from runtime_info
        default:
            completion?(J(["success":true]))  // ack for pi-only RPCs jcode doesn't have
        }
    }
    func terminate() { bridge.terminate() }
    func signalDescendants(_ sig: Int32) { /* jcode swarm is internal; best-effort: terminate */ }
    func forceKill() { bridge.terminate() }

    // Higher-level methods used by ChatSession.loadInitialState etc. (Task 4 wires these).
    func sendPrompt(_ message: String, images: [[String]], completion: @escaping (Bool) -> Void) {
        guard let sid = sessionID else { completion(false); return }
        var req: [String: Any] = ["req":"send_message","session_id":sid,"content":message]
        if !images.isEmpty { req["images"] = images }
        bridge.request(req) { resp in completion(resp["ev"] as? String != "error") }
    }
    func loadHistory(completion: @escaping ([Any]) -> Void) {
        guard let sid = sessionID else { completion([]); return }
        bridge.request(["req":"get_history","session_id":sid]) { resp in
            completion((resp["messages"] as? [[String:Any]])?.map { $0["content"] ?? "" } ?? [])
        }
    }
}
