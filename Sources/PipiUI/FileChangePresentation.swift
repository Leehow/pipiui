import Foundation

/// The only tool arguments retained for finished-group change presentation.
/// Payloads are capped during conversion so reopening a long session cannot make
/// the transcript retain arbitrarily large tool JSON.
enum FileChangePayload: Equatable {
    struct Replacement: Equatable {
        let oldText: String
        let newText: String
    }

    case write(path: String, content: String, isTruncated: Bool)
    case edit(path: String, replacements: [Replacement], isTruncated: Bool)

    static let characterLimit = 120_000

    static func parse(toolName: String, arguments: J) -> FileChangePayload? {
        guard toolName == "write" || toolName == "edit",
              let path = arguments["path"].string ?? arguments["file_path"].string,
              !path.isEmpty
        else {
            return nil
        }

        if toolName == "write" {
            guard let content = arguments["content"].string else { return nil }
            let bounded = bounded(content, remaining: characterLimit)
            return .write(path: path, content: bounded.text, isTruncated: bounded.truncated)
        }

        var source: [(String, String)] = arguments["edits"].array.compactMap { edit in
            guard let oldText = edit["oldText"].string,
                  let newText = edit["newText"].string
            else { return nil }
            return (oldText, newText)
        }
        if source.isEmpty,
           let oldText = arguments["oldText"].string,
           let newText = arguments["newText"].string {
            source = [(oldText, newText)]
        }
        guard !source.isEmpty else { return nil }

        var remaining = characterLimit
        var truncated = false
        var replacements: [Replacement] = []
        for (oldText, newText) in source {
            guard remaining > 0 else {
                truncated = true
                break
            }
            let old = bounded(oldText, remaining: remaining)
            remaining -= old.text.count
            let new = bounded(newText, remaining: remaining)
            remaining -= new.text.count
            truncated = truncated || old.truncated || new.truncated
            replacements.append(Replacement(oldText: old.text, newText: new.text))
        }
        return .edit(path: path, replacements: replacements, isTruncated: truncated)
    }

    var path: String {
        switch self {
        case .write(let path, _, _), .edit(let path, _, _):
            return path
        }
    }

    private static func bounded(_ text: String, remaining: Int) -> (text: String, truncated: Bool) {
        guard text.count > remaining else { return (text, false) }
        return (String(text.prefix(max(0, remaining))), true)
    }
}

struct FileChangeDiffLine: Equatable, Identifiable {
    enum Kind: Equatable {
        case addition
        case deletion
        case separator
    }

    let id: String
    let kind: Kind
    let oldLineNumber: Int?
    let newLineNumber: Int?
    let text: String
}

struct FileChangeFilePresentation: Equatable, Identifiable {
    let id: String
    let path: String
    let displayPath: String
    let callIDs: [String]
    let additions: Int
    let deletions: Int
    let lines: [FileChangeDiffLine]
    let qualityMessage: String?
    let operations: [FileChangeOperationPresentation]
}

struct FileChangeOperationPresentation: Equatable, Identifiable {
    /// Stable tool-call id, also used as the inspector scroll target.
    let id: String
    let toolName: String
    let path: String
    let additions: Int
    let deletions: Int
    let lines: [FileChangeDiffLine]
    let qualityMessage: String?
}

struct FileChangeGroupPresentation: Equatable {
    static let renderedLineLimit = 4_000
    /// `CollectionDifference` uses a bounded Myers-style diff. Larger replacement
    /// blocks fall back to operation-line accounting instead of risking quadratic work.
    static let lineDiffInputLimit = 4_000

    let files: [FileChangeFilePresentation]

    var additions: Int { files.reduce(0) { $0 + $1.additions } }
    var deletions: Int { files.reduce(0) { $0 + $1.deletions } }

    func file(forCallID callID: String) -> FileChangeFilePresentation? {
        files.first { $0.callIDs.contains(callID) }
    }

    static func make(
        blocks: [ChatBlock],
        toolRuns: [String: ToolRun],
        projectURL: URL?
    ) -> FileChangeGroupPresentation {
        struct Accumulator {
            var path: String
            var displayPath: String
            var callIDs: [String] = []
            var additions = 0
            var deletions = 0
            var lines: [FileChangeDiffLine] = []
            var hasWriteWithoutPreimage = false
            var isTruncated = false
            var usesOperationAccounting = false
            var knownWrittenContent: String?
            var operations: [FileChangeOperationPresentation] = []
        }

        var order: [String] = []
        var accumulators: [String: Accumulator] = [:]

        for block in blocks {
            guard case .toolCall(let call) = block,
                  let payload = call.fileChangePayload,
                  let run = toolRuns[call.id],
                  !run.isRunning,
                  !run.isError
            else { continue }

            let normalized = normalizedPath(payload.path, projectURL: projectURL)
            if accumulators[normalized] == nil {
                order.append(normalized)
                accumulators[normalized] = Accumulator(
                    path: normalized,
                    displayPath: displayPath(normalized, projectURL: projectURL)
                )
            }
            guard var accumulator = accumulators[normalized] else { continue }
            accumulator.callIDs.append(call.id)
            accumulator.operations.append(
                operationPresentation(call: call, payload: payload)
            )

            switch payload {
            case .write(_, let content, let isTruncated):
                let lines = logicalLines(content)
                // A successful write establishes the only defensible state we know.
                // It supersedes earlier operation hunks, but its preimage remains unknown.
                accumulator.additions = lines.count
                accumulator.deletions = 0
                accumulator.hasWriteWithoutPreimage = true
                accumulator.isTruncated = isTruncated
                accumulator.usesOperationAccounting = false
                accumulator.knownWrittenContent = isTruncated ? nil : content
                accumulator.lines = writtenContentLines(content, callID: call.id)
            case .edit(_, let replacements, let isTruncated):
                accumulator.isTruncated = accumulator.isTruncated || isTruncated
                if !isTruncated,
                   let knownContent = accumulator.knownWrittenContent,
                   let finalContent = applying(replacements, to: knownContent) {
                    // The group's preimage is still unknown, so show the final known
                    // written state once rather than counting write + edit operations.
                    accumulator.knownWrittenContent = finalContent
                    accumulator.additions = logicalLines(finalContent).count
                    accumulator.deletions = 0
                    accumulator.lines = writtenContentLines(finalContent, callID: call.id)
                } else {
                    if accumulator.hasWriteWithoutPreimage {
                        accumulator.usesOperationAccounting = true
                    }
                    accumulator.knownWrittenContent = nil
                    var editLines: [FileChangeDiffLine] = []
                    var editAdditions = 0
                    var editDeletions = 0
                    var usedFallback = false
                    for (replacementIndex, replacement) in replacements.enumerated() {
                        let diff = lineDiff(
                            oldText: replacement.oldText,
                            newText: replacement.newText,
                            idPrefix: "\(call.id):edit:\(replacementIndex)"
                        )
                        editLines.append(contentsOf: diff.lines)
                        editAdditions += diff.additions
                        editDeletions += diff.deletions
                        usedFallback = usedFallback || diff.usedOperationFallback
                    }
                    accumulator.usesOperationAccounting =
                        accumulator.usesOperationAccounting || usedFallback
                    if !editLines.isEmpty, !accumulator.lines.isEmpty {
                        accumulator.lines.append(FileChangeDiffLine(
                            id: "\(call.id):separator",
                            kind: .separator,
                            oldLineNumber: nil,
                            newLineNumber: nil,
                            text: "••• edit •••"
                        ))
                    }
                    accumulator.lines.append(contentsOf: editLines)
                    accumulator.additions += editAdditions
                    accumulator.deletions += editDeletions
                }
            }
            accumulators[normalized] = accumulator
        }

        let files = order.compactMap { path -> FileChangeFilePresentation? in
            guard let accumulator = accumulators[path] else { return nil }
            let renderedLines = Array(accumulator.lines.prefix(renderedLineLimit))
            let renderWasTruncated = renderedLines.count < accumulator.lines.count
            var qualityParts: [String] = []
            if accumulator.hasWriteWithoutPreimage {
                qualityParts.append("显示写入内容；缺少写入前版本")
            }
            if accumulator.usesOperationAccounting {
                qualityParts.append("部分变更按操作行统计，可能包含未变行")
            }
            if accumulator.isTruncated || renderWasTruncated {
                qualityParts.append("变更内容过长，以下差异已截断")
            }
            let quality = qualityParts.isEmpty ? nil : qualityParts.joined(separator: "；")
            return FileChangeFilePresentation(
                id: path,
                path: accumulator.path,
                displayPath: accumulator.displayPath,
                callIDs: accumulator.callIDs,
                additions: accumulator.additions,
                deletions: accumulator.deletions,
                lines: renderedLines,
                qualityMessage: quality,
                operations: accumulator.operations
            )
        }
        return FileChangeGroupPresentation(files: files)
    }

    private static func operationPresentation(
        call: ToolCallBlock,
        payload: FileChangePayload
    ) -> FileChangeOperationPresentation {
        let path = payload.path
        switch payload {
        case .write(_, let content, let isTruncated):
            let allLines = writtenContentLines(content, callID: call.id)
            let renderedLines = Array(allLines.prefix(renderedLineLimit))
            var qualityParts = ["显示写入内容；缺少写入前版本"]
            if isTruncated || renderedLines.count < allLines.count {
                qualityParts.append("变更内容过长，以下差异已截断")
            }
            return FileChangeOperationPresentation(
                id: call.id,
                toolName: call.name,
                path: path,
                additions: logicalLines(content).count,
                deletions: 0,
                lines: renderedLines,
                qualityMessage: qualityParts.joined(separator: "；")
            )
        case .edit(_, let replacements, let isTruncated):
            var allLines: [FileChangeDiffLine] = []
            var additions = 0
            var deletions = 0
            var usedFallback = false
            for (replacementIndex, replacement) in replacements.enumerated() {
                let diff = lineDiff(
                    oldText: replacement.oldText,
                    newText: replacement.newText,
                    idPrefix: "\(call.id):operation:\(replacementIndex)"
                )
                allLines.append(contentsOf: diff.lines)
                additions += diff.additions
                deletions += diff.deletions
                usedFallback = usedFallback || diff.usedOperationFallback
            }
            let renderedLines = Array(allLines.prefix(renderedLineLimit))
            var qualityParts: [String] = []
            if usedFallback {
                qualityParts.append("部分变更按操作行统计，可能包含未变行")
            }
            if isTruncated || renderedLines.count < allLines.count {
                qualityParts.append("变更内容过长，以下差异已截断")
            }
            return FileChangeOperationPresentation(
                id: call.id,
                toolName: call.name,
                path: path,
                additions: additions,
                deletions: deletions,
                lines: renderedLines,
                qualityMessage: qualityParts.isEmpty
                    ? nil
                    : qualityParts.joined(separator: "；")
            )
        }
    }

    private struct LineDiffResult {
        let additions: Int
        let deletions: Int
        let lines: [FileChangeDiffLine]
        let usedOperationFallback: Bool
    }

    private static func lineDiff(
        oldText: String,
        newText: String,
        idPrefix: String
    ) -> LineDiffResult {
        let oldLines = logicalLines(oldText)
        let newLines = logicalLines(newText)
        if oldLines == newLines {
            return LineDiffResult(
                additions: 0,
                deletions: 0,
                lines: [],
                usedOperationFallback: false
            )
        }

        guard oldLines.count + newLines.count <= lineDiffInputLimit else {
            let deletions = oldLines.enumerated().map { index, text in
                FileChangeDiffLine(
                    id: "\(idPrefix):fallback-old:\(index)",
                    kind: .deletion,
                    oldLineNumber: index + 1,
                    newLineNumber: nil,
                    text: text
                )
            }
            let additions = newLines.enumerated().map { index, text in
                FileChangeDiffLine(
                    id: "\(idPrefix):fallback-new:\(index)",
                    kind: .addition,
                    oldLineNumber: nil,
                    newLineNumber: index + 1,
                    text: text
                )
            }
            return LineDiffResult(
                additions: additions.count,
                deletions: deletions.count,
                lines: deletions + additions,
                usedOperationFallback: true
            )
        }

        let difference = newLines.difference(from: oldLines)
        var removals: [(offset: Int, text: String)] = []
        var insertions: [(offset: Int, text: String)] = []
        for change in difference {
            switch change {
            case .remove(let offset, let text, _):
                removals.append((offset, text))
            case .insert(let offset, let text, _):
                insertions.append((offset, text))
            }
        }
        removals.sort { $0.offset < $1.offset }
        insertions.sort { $0.offset < $1.offset }
        let deletionLines = removals.enumerated().map { index, removal in
            FileChangeDiffLine(
                id: "\(idPrefix):old:\(index)",
                kind: .deletion,
                oldLineNumber: removal.offset + 1,
                newLineNumber: nil,
                text: removal.text
            )
        }
        let additionLines = insertions.enumerated().map { index, insertion in
            FileChangeDiffLine(
                id: "\(idPrefix):new:\(index)",
                kind: .addition,
                oldLineNumber: nil,
                newLineNumber: insertion.offset + 1,
                text: insertion.text
            )
        }
        return LineDiffResult(
            additions: additionLines.count,
            deletions: deletionLines.count,
            lines: deletionLines + additionLines,
            usedOperationFallback: false
        )
    }

    private static func writtenContentLines(
        _ content: String,
        callID: String
    ) -> [FileChangeDiffLine] {
        logicalLines(content).enumerated().map { index, text in
            FileChangeDiffLine(
                id: "\(callID):write-state:\(index)",
                kind: .addition,
                oldLineNumber: nil,
                newLineNumber: index + 1,
                text: text
            )
        }
    }

    /// Apply replacements only when every oldText occurs exactly once in the
    /// evolving known state. Empty or ambiguous matches are not position-defensible.
    private static func applying(
        _ replacements: [FileChangePayload.Replacement],
        to content: String
    ) -> String? {
        var result = content
        for replacement in replacements {
            guard !replacement.oldText.isEmpty,
                  let match = result.range(of: replacement.oldText),
                  result.range(
                    of: replacement.oldText,
                    range: match.upperBound..<result.endIndex
                  ) == nil
            else {
                return nil
            }
            result.replaceSubrange(match, with: replacement.newText)
        }
        return result
    }

    private static func logicalLines(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var lines = text.components(separatedBy: "\n")
        if text.hasSuffix("\n") { lines.removeLast() }
        return lines
    }

    private static func normalizedPath(_ path: String, projectURL: URL?) -> String {
        let expanded = (path as NSString).expandingTildeInPath
        if (expanded as NSString).isAbsolutePath {
            return URL(fileURLWithPath: expanded).standardizedFileURL.path
        }
        if let projectURL {
            return projectURL.appendingPathComponent(expanded).standardizedFileURL.path
        }
        return (expanded as NSString).standardizingPath
    }

    private static func displayPath(_ path: String, projectURL: URL?) -> String {
        guard let root = projectURL?.standardizedFileURL.path else { return path }
        let prefix = root.hasSuffix("/") ? root : root + "/"
        guard path.hasPrefix(prefix) else { return path }
        return String(path.dropFirst(prefix.count))
    }
}
