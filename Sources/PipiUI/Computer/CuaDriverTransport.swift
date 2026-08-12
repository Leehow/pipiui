import Foundation

struct CuaToolResult: @unchecked Sendable {
    let content: [[String: Any]]
    let structuredContent: [String: Any]
    let isError: Bool

    init(
        content: [[String: Any]] = [],
        structuredContent: [String: Any] = [:],
        isError: Bool = false
    ) {
        self.content = content
        self.structuredContent = structuredContent
        self.isError = isError
    }

    var text: String {
        content.compactMap { item in
            guard item["type"] as? String == "text" else { return nil }
            return item["text"] as? String
        }.joined(separator: "\n")
    }

    var image: (data: String, mimeType: String)? {
        for item in content {
            guard item["type"] as? String == "image",
                  let data = item["data"] as? String else { continue }
            let mimeType = item["mimeType"] as? String
                ?? item["mime_type"] as? String
                ?? "image/png"
            return (data, mimeType)
        }
        return nil
    }
}

enum CuaDriverError: LocalizedError, Equatable {
    case helperMissing(String)
    case helperNotExecutable(String)
    case startupTimedOut(String)
    case processExited(String)
    case protocolFailure(String)
    case permissionAttribution(String)
    case startupContract(String)
    case toolFailure(tool: String, message: String)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .helperMissing(let path):
            return "Cua Driver helper is missing at \(path). Repackage PipiUI or set PIPIUI_CUA_DRIVER_PATH for swift-run development."
        case .helperNotExecutable(let path):
            return "Cua Driver helper is not executable at \(path). Repackage PipiUI."
        case .startupTimedOut(let socket):
            return "Cua Driver did not become ready on its private socket: \(socket)"
        case .processExited(let process):
            return "Cua Driver \(process) exited unexpectedly."
        case .protocolFailure(let message):
            return "Cua Driver JSON-RPC failure: \(message)"
        case .permissionAttribution(let attribution):
            return "Cua Driver embedded permission attribution is \(attribution), expected host. Fully quit and use the packaged PipiUI helper."
        case .startupContract(let message):
            return "Cua Driver embedded startup contract failed: \(message)"
        case .toolFailure(let tool, let message):
            return "Cua Driver \(tool) failed: \(message)"
        case .cancelled:
            return "Cua Driver request was cancelled."
        }
    }

    var isGenerationFatal: Bool {
        switch self {
        case .toolFailure:
            return false
        case .helperMissing, .helperNotExecutable, .startupTimedOut,
             .processExited, .protocolFailure, .permissionAttribution,
             .startupContract, .cancelled:
            return true
        }
    }
}

protocol CuaDriverTransport: AnyObject {
    func call(tool: String, arguments: [String: Any]) async throws -> CuaToolResult
    func cancelAndStop()
    /// App-termination boundary. Implementations that own child processes
    /// override this to return only after those children are reaped.
    func shutdownAndWait()
}

extension CuaDriverTransport {
    func shutdownAndWait() {
        cancelAndStop()
    }
}
