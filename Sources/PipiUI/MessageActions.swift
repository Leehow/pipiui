import Foundation

enum MessageActions {
    /// Runtime worker signals arrive with the user role, but must not be treated as
    /// user-authored prompts by transcript navigation or message actions.
    static func isUserAuthoredMessage(_ item: ChatItem) -> Bool {
        guard item.role == "user" else { return false }
        let displayText = copyableText(from: item)
        return !displayText.hasPrefix("[subagent-done]")
            && !displayText.hasPrefix("[worktree-merge-failed]")
    }

    static func copyableText(from item: ChatItem) -> String {
        let text = item.blocks.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        return item.role == "user"
            ? ImageAttachment.stripAttachmentPathsForDisplay(text)
            : text
    }

    static func copyableText(from segments: [AssistantBlockLayout.Segment]) -> String {
        segments.compactMap { seg -> String? in
            if case .text(let t) = seg { return t }
            return nil
        }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whether to show Edit/Branch chrome while idle. `entryId` is not required for
    /// visibility (missing ids sync on click); commit/branch still need a real entry id.
    static func showsMutatingActions(
        role: String,
        entryId: String?,
        displayText: String,
        isWorking: Bool
    ) -> Bool {
        _ = entryId
        guard !isWorking else { return false }
        guard role == "user" || role == "assistant" else { return false }
        if displayText.hasPrefix("[subagent-done]") { return false }
        if displayText.hasPrefix("[worktree-merge-failed]") { return false }
        return true
    }

    static func isEditDraftSendable(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    enum BranchOp: Equatable {
        case clone
        case fork(nextUserEntryId: String)
    }

    static func branchOp(
        runLastEntryId: String,
        leafId: String?,
        nextUserEntryId: String?
    ) -> BranchOp? {
        if leafId == runLastEntryId { return .clone }
        if let nextUserEntryId { return .fork(nextUserEntryId: nextUserEntryId) }
        return nil
    }

    /// `entries` = `get_entries` data.entries; `leafId` = data.leafId.
    /// Returns user/assistant message entries on the active branch, oldest → newest.
    static func activeBranchMessages(entries: [J], leafId: String?) -> [J] {
        guard let leafId else { return [] }
        var byId: [String: J] = [:]
        for entry in entries {
            if let id = entry["id"].string {
                byId[id] = entry
            }
        }

        var chain: [J] = []
        var current: String? = leafId
        var guardCount = 0
        while let id = current, let entry = byId[id], guardCount < 100_000 {
            guardCount += 1
            if entry["type"].string == "message",
               let role = entry["message"]["role"].string,
               role == "user" || role == "assistant" {
                chain.append(entry)
            }
            current = entry["parentId"].string
        }
        var visible: [J] = []
        var skipNextAssistant = false
        for entry in chain.reversed() {
            let message = entry["message"]
            switch message["role"].string {
            case "user":
                if ChatSession.contentText(message["content"])
                    .contains(ChatSession.sessionTitleJobMarker) {
                    skipNextAssistant = true
                    continue
                }
                skipNextAssistant = false
                if wouldProduceVisibleUserItem(message) {
                    visible.append(entry)
                }
            case "assistant":
                if skipNextAssistant {
                    skipNextAssistant = false
                    continue
                }
                // `convert` emits an assistant row even when content is empty.
                visible.append(entry)
            default:
                break
            }
        }
        return visible
    }

    /// Match active-branch messages onto transcript items after excluding app-only bubbles.
    /// Any role/content disagreement clears all ids instead of risking a silently wrong fork.
    static func applyingEntryIds(items: [ChatItem], branchMessages: [J]) -> [ChatItem] {
        let candidateIndices = items.indices.filter {
            let item = items[$0]
            return !item.isLocalOnly && (item.role == "user" || item.role == "assistant")
        }
        guard candidateIndices.count == branchMessages.count else {
            return clearingEntryIds(items)
        }

        for (itemIndex, entry) in zip(candidateIndices, branchMessages) {
            let item = items[itemIndex]
            guard item.role == entry["message"]["role"].string,
                  textMatches(item: item, entry: entry) else {
                return clearingEntryIds(items)
            }
        }

        var stamped = clearingEntryIds(items)
        for (itemIndex, entry) in zip(candidateIndices, branchMessages) {
            stamped[itemIndex].entryId = entry["id"].string
        }
        return stamped
    }

    /// First user entry id after `afterEntryId` on the branch list; nil if none.
    static func nextUserEntryId(after afterEntryId: String, branchMessages: [J]) -> String? {
        guard let index = branchMessages.firstIndex(where: { $0["id"].string == afterEntryId }) else {
            return nil
        }
        for entry in branchMessages.suffix(from: branchMessages.index(after: index)) {
            if entry["message"]["role"].string == "user", let id = entry["id"].string {
                return id
            }
        }
        return nil
    }

    static func shouldNoOpEdit(
        originalText: String,
        newText: String,
        itemEntryId: String,
        branchMessages: [J]
    ) -> Bool {
        guard originalText == newText,
              let index = branchMessages.firstIndex(where: { $0["id"].string == itemEntryId }) else {
            return false
        }
        return branchMessages.index(after: index) == branchMessages.endIndex
    }

    private static func wouldProduceVisibleUserItem(_ message: J) -> Bool {
        let content = message["content"]
        if let text = content.string {
            return !text.isEmpty
        }
        return content.array.contains { block in
            switch block["type"].string ?? "" {
            case "text":
                return !(block["text"].string ?? "").isEmpty
            case "thinking":
                return !(block["thinking"].string ?? "").isEmpty
            case "toolCall":
                return true
            case "image":
                let data = block["source"]["data"].string ?? block["data"].string
                let path = block["path"].string
                    ?? block["filePath"].string
                    ?? block["file_path"].string
                    ?? block["source"]["path"].string
                    ?? block["source"]["filePath"].string
                return data?.isEmpty == false
                    || path?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            default:
                return false
            }
        }
    }

    private static func textMatches(item: ChatItem, entry: J) -> Bool {
        let itemText = item.blocks.compactMap { block -> String? in
            if case .text(let text) = block { return text }
            return nil
        }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        let entryText = ChatSession.contentText(entry["message"]["content"])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return itemText == entryText
    }

    private static func clearingEntryIds(_ items: [ChatItem]) -> [ChatItem] {
        items.map { item in
            var copy = item
            copy.entryId = nil
            return copy
        }
    }
}
