import Foundation

/// Assembles a partial assistant message from pi 0.84+ `assistantMessageEvent` deltas.
///
/// `message_update` no longer carries a cumulative `message` snapshot. Clients must
/// rebuild content blocks by `contentIndex` between `message_start` and `message_end`.
/// Hot path: `apply` only mutates cheap buffers; full snapshots / ChatItems are built
/// at the 50 ms flush materialization point.
final class StreamingMessageAssembler {
    private struct ToolCallState {
        var id: String
        var name: String
        var argumentsJSON: String
        /// Set on `toolcall_end` (or when JSON first fully parses at materialize).
        var argumentsObject: [String: Any]?
        /// Presentation cache — invalidated when `argumentsJSON.count` changes.
        var cacheJSONCount: Int = -1
        var cachedSummary: String = "…"
        var cachedPayloadChars: Int = 0
        var cachedFileChange: FileChangePayload?
    }

    private enum Block {
        case text(String)
        case thinking(String)
        case toolCall(ToolCallState)
    }

    private var blocks: [Int: Block] = [:]
    /// Insertion-ordered indices so materialize avoids `keys.sorted()` each flush.
    private var orderedIndices: [Int] = []
    /// Incremental text + thinking character count (tool args excluded).
    private(set) var characterCount: Int = 0
    /// Body-text only count (thinking excluded). Used for TTFT parity with legacy `contentText`.
    private(set) var textCharacterCount: Int = 0
    /// True after any apply since the last `consumePending` / reset.
    private(set) var isDirty: Bool = false

    func reset() {
        blocks.removeAll(keepingCapacity: true)
        orderedIndices.removeAll(keepingCapacity: true)
        characterCount = 0
        textCharacterCount = 0
        isDirty = false
    }

    var isEmpty: Bool { blocks.isEmpty }

    /// Non-empty assistant body text has arrived (TTFT marker; thinking does not count).
    /// Matches legacy `markStreamFirstTokenIfNeeded` → `contentText` (type == "text" only).
    var hasVisibleText: Bool { textCharacterCount > 0 }

    func apply(_ event: J) {
        guard let type = event["type"].string else { return }
        let index = event["contentIndex"].int ?? 0
        isDirty = true

        switch type {
        case "text_start":
            replaceText(index, "")
        case "text_delta":
            let delta = event["delta"].string ?? ""
            if case .text(let existing) = blocks[index] {
                blocks[index] = .text(existing + delta)
                characterCount += delta.count
                textCharacterCount += delta.count
            } else {
                replaceText(index, delta)
            }
        case "text_end":
            if let content = event["content"].string {
                replaceText(index, content)
            } else if blocks[index] == nil {
                replaceText(index, "")
            }

        case "thinking_start":
            replaceThinking(index, "")
        case "thinking_delta":
            let delta = event["delta"].string ?? ""
            if case .thinking(let existing) = blocks[index] {
                blocks[index] = .thinking(existing + delta)
                characterCount += delta.count
            } else {
                replaceThinking(index, delta)
            }
        case "thinking_end":
            if let content = event["content"].string {
                replaceThinking(index, content)
            } else if blocks[index] == nil {
                replaceThinking(index, "")
            }

        case "toolcall_start":
            let id = event["id"].string
                ?? event["toolCall"]["id"].string
                ?? "pending-\(index)"
            let name = event["name"].string
                ?? event["toolCall"]["name"].string
                ?? "tool"
            setBlock(index, .toolCall(ToolCallState(
                id: id,
                name: name,
                argumentsJSON: "",
                argumentsObject: nil
            )))
        case "toolcall_delta":
            // Append only — never JSON-parse the growing buffer on the hot path.
            let delta = event["delta"].string ?? ""
            if case .toolCall(var state) = blocks[index] {
                state.argumentsJSON += delta
                blocks[index] = .toolCall(state)
            } else {
                setBlock(index, .toolCall(ToolCallState(
                    id: "pending-\(index)",
                    name: "tool",
                    argumentsJSON: delta,
                    argumentsObject: nil
                )))
            }
        case "toolcall_end":
            let tc = event["toolCall"]
            let previous: ToolCallState? = {
                if case .toolCall(let state) = blocks[index] { return state }
                return nil
            }()
            let id = tc["id"].string ?? previous?.id ?? "pending-\(index)"
            let name = tc["name"].string ?? previous?.name ?? "tool"
            var state = ToolCallState(
                id: id,
                name: name,
                argumentsJSON: previous?.argumentsJSON ?? "",
                argumentsObject: nil
            )
            if let dict = tc["arguments"].dict {
                state.argumentsJSON = tc["arguments"].compactJSON
                state.argumentsObject = dict
            } else if let raw = tc["arguments"].string {
                state.argumentsJSON = raw
                state.argumentsObject = Self.parseObject(raw)
            } else if let previous {
                state.argumentsJSON = previous.argumentsJSON
                state.argumentsObject = previous.argumentsObject ?? Self.parseObject(previous.argumentsJSON)
            } else {
                state.argumentsObject = [:]
            }
            // End is the natural point to materialize tool presentation once.
            Self.refreshToolCache(&state)
            setBlock(index, .toolCall(state))

        default:
            // Forward-compatible: ignore unknown delta types.
            break
        }
    }

    /// Mark dirty state consumed after a successful flush materialization.
    func consumePending() {
        isDirty = false
    }

    /// Build a convert-compatible assistant message snapshot from accumulated blocks.
    /// Intended for the 50 ms materialize point — not per-delta.
    func buildPartialMessage() -> J {
        var content: [[String: Any]] = []
        content.reserveCapacity(orderedIndices.count)
        for index in orderedIndices {
            guard let block = blocks[index] else { continue }
            switch block {
            case .text(let text):
                content.append(["type": "text", "text": text])
            case .thinking(let thinking):
                content.append(["type": "thinking", "thinking": thinking])
            case .toolCall(let state):
                let arguments: Any
                if let object = state.argumentsObject {
                    arguments = object
                } else if !state.argumentsJSON.isEmpty {
                    // Keep partial JSON as a string so convert / scrape can use it.
                    arguments = state.argumentsJSON
                } else {
                    arguments = [String: Any]()
                }
                content.append([
                    "type": "toolCall",
                    "id": state.id,
                    "name": state.name,
                    "arguments": arguments,
                ])
            }
        }
        return J([
            "role": "assistant",
            "content": content,
        ] as [String: Any])
    }

    /// Materialize a live `ChatItem` with tool summary / file-change caches.
    /// Prefer this over `convert(buildPartialMessage())` on the stream flush path
    /// so growing `argumentsJSON` is not re-parsed into `FileChangePayload` every tick.
    func makeStreamingItem(id: String = "streaming") -> ChatItem {
        var chatBlocks: [ChatBlock] = []
        chatBlocks.reserveCapacity(orderedIndices.count)
        for index in orderedIndices {
            guard var block = blocks[index] else { continue }
            switch block {
            case .text(let text):
                if !text.isEmpty { chatBlocks.append(.text(text)) }
            case .thinking(let thinking):
                if !thinking.isEmpty { chatBlocks.append(.thinking(thinking)) }
            case .toolCall(var state):
                Self.refreshToolCache(&state)
                block = .toolCall(state)
                blocks[index] = block
                chatBlocks.append(.toolCall(ToolCallBlock(
                    id: state.id,
                    name: state.name,
                    argsSummary: state.cachedSummary,
                    payloadChars: state.cachedPayloadChars,
                    fileChangePayload: state.cachedFileChange
                )))
            }
        }
        return ChatItem(id: id, role: "assistant", blocks: chatBlocks)
    }

    // MARK: - Private

    private func replaceText(_ index: Int, _ text: String) {
        if case .text(let old) = blocks[index] {
            characterCount -= old.count
            textCharacterCount -= old.count
        } else if case .thinking(let old) = blocks[index] {
            characterCount -= old.count
        }
        characterCount += text.count
        textCharacterCount += text.count
        setBlock(index, .text(text))
    }

    private func replaceThinking(_ index: Int, _ text: String) {
        if case .text(let old) = blocks[index] {
            characterCount -= old.count
            textCharacterCount -= old.count
        } else if case .thinking(let old) = blocks[index] {
            characterCount -= old.count
        }
        characterCount += text.count
        setBlock(index, .thinking(text))
    }

    private func setBlock(_ index: Int, _ block: Block) {
        if blocks[index] == nil {
            orderedIndices.append(index)
            // contentIndex is normally dense ascending; keep ordered if a late index appears.
            if orderedIndices.count > 1,
               let last = orderedIndices.dropLast().last,
               index < last {
                orderedIndices.sort()
            }
        }
        blocks[index] = block
    }

    private static func refreshToolCache(_ state: inout ToolCallState) {
        let count = state.argumentsJSON.count
        // Only recompute when the buffered JSON grew (or cache is cold).
        guard state.cacheJSONCount != count else { return }

        if let object = state.argumentsObject {
            let args = J(object)
            let summary = ToolCallSummary.summarize(name: state.name, args: args)
            state.cachedSummary = summary.summary
            state.cachedPayloadChars = summary.payloadChars
            // Write/edit content is parsed once per JSON length — not every delta.
            state.cachedFileChange = FileChangePayload.parse(
                toolName: state.name,
                arguments: args
            )
        } else if !state.argumentsJSON.isEmpty {
            let summary = ToolCallSummary.summarize(name: state.name, argsJSON: state.argumentsJSON)
            state.cachedSummary = summary.summary
            state.cachedPayloadChars = summary.payloadChars
            // Partial JSON: attempt object parse once per length for file-change tools only.
            if state.name == "write" || state.name == "edit",
               let object = parseObject(state.argumentsJSON) {
                state.argumentsObject = object
                state.cachedFileChange = FileChangePayload.parse(
                    toolName: state.name,
                    arguments: J(object)
                )
            } else {
                state.cachedFileChange = nil
            }
        } else {
            state.cachedSummary = "…"
            state.cachedPayloadChars = 0
            state.cachedFileChange = nil
        }
        state.cacheJSONCount = count
    }

    private static func parseObject(_ raw: String) -> [String: Any]? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let dict = obj as? [String: Any]
        else {
            return nil
        }
        return dict
    }
}
