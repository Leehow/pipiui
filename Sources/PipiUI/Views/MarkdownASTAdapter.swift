import AppKit
import Foundation
import Markdown
import SwiftUI

/// Converts swift-markdown's GFM AST into the existing selectable-message block contract.
/// The adapter deliberately keeps view/layout ownership in MarkdownView's single NSTextView.
enum MarkdownASTAdapter {
    typealias Block = MarkdownTextView.Block
    typealias InlineContent = MarkdownTextView.InlineContent
    typealias InlineRun = MarkdownTextView.InlineRun
    typealias ListItem = MarkdownTextView.ListItem
    typealias TableAlignment = MarkdownTextView.TableAlignment
    typealias TaskState = MarkdownTextView.TaskState

    static func blocks(from source: String) -> [Block] {
        guard !source.isEmpty else { return [] }
        let document = Markdown.Document(
            parsing: source,
            options: [.disableSmartOpts]
        )
        let blocks = document.children.flatMap(adaptBlock)
        // cmark-GFM is deliberately resilient, but keep a visible/copyable fallback for any
        // future node kind that carries no recognized children.
        return blocks.isEmpty ? [.paragraph(.plain(source))] : blocks
    }

    /// Used only by legacy inline call sites and tests. The active message renderer receives
    /// inline nodes directly from the settled document AST above.
    static func inlineContent(from source: String) -> InlineContent {
        let document = Markdown.Document(
            parsing: source,
            options: [.disableSmartOpts]
        )
        let contents = document.children.compactMap { markup -> InlineContent? in
            if let paragraph = markup as? Markdown.Paragraph {
                return inlineContent(from: paragraph)
            }
            if let heading = markup as? Markdown.Heading {
                return inlineContent(from: heading)
            }
            return nil
        }
        return joined(contents, separator: .hardBreak) ?? .plain(source)
    }

    private static func adaptBlock(_ markup: Markdown.Markup) -> [Block] {
        if let paragraph = markup as? Markdown.Paragraph {
            let content = inlineContent(from: paragraph)
            let plain = content.plainText
            return [MarkdownTextView.looksLikeAsciiArt(plain) ? .mono(plain) : .paragraph(content)]
        }
        if let heading = markup as? Markdown.Heading {
            return [.heading(heading.level, inlineContent(from: heading))]
        }
        if let code = markup as? Markdown.CodeBlock {
            return [.code(code.code, language: code.language)]
        }
        if let quote = markup as? Markdown.BlockQuote {
            let children = quote.children.flatMap(adaptBlock)
            return children.isEmpty ? [] : [.quote(children)]
        }
        if let unordered = markup as? Markdown.UnorderedList {
            return [.list(listItems(from: unordered, orderedStart: nil, indent: 0))]
        }
        if let ordered = markup as? Markdown.OrderedList {
            return [.list(listItems(from: ordered, orderedStart: ordered.startIndex, indent: 0))]
        }
        if markup is Markdown.ThematicBreak {
            return [.rule]
        }
        if let table = markup as? Markdown.Table {
            let header = Array(table.head.cells).map(inlineContent)
            let rows = Array(table.body.rows).map { row in
                Array(row.cells).map(inlineContent)
            }
            let alignments: [TableAlignment?] = table.columnAlignments.map { alignment in
                switch alignment {
                case .left?: return .left
                case .center?: return .center
                case .right?: return .right
                case nil: return nil
                }
            }
            return [.table(header: header, rows: rows, alignments: alignments)]
        }
        if let html = markup as? Markdown.HTMLBlock {
            return [.paragraph(.plain(html.rawHTML))]
        }

        // Directives/custom blocks are not a special transcript surface. Preserve recognized
        // descendants rather than discarding user-visible content.
        return markup.children.flatMap(adaptBlock)
    }

    private static func listItems<List: Markdown.ListItemContainer>(
        from list: List,
        orderedStart: UInt?,
        indent: Int
    ) -> [ListItem] {
        Array(list.listItems).enumerated().flatMap { offset, item in
            let marker: String
            if let orderedStart {
                marker = "\(orderedStart + UInt(offset))."
            } else {
                marker = "•"
            }
            return flattened(item: item, marker: marker, indent: indent)
        }
    }

    private static func flattened(
        item: Markdown.ListItem,
        marker: String,
        indent: Int
    ) -> [ListItem] {
        let directContent = item.children.compactMap { child -> InlineContent? in
            if let paragraph = child as? Markdown.Paragraph {
                return inlineContent(from: paragraph)
            }
            if let heading = child as? Markdown.Heading {
                return inlineContent(from: heading)
            }
            if let code = child as? Markdown.CodeBlock {
                return InlineContent(runs: [.code(code.code)])
            }
            if let html = child as? Markdown.HTMLBlock {
                return .plain(html.rawHTML)
            }
            return nil
        }
        let taskState: TaskState?
        switch item.checkbox {
        case .checked?: taskState = .checked
        case .unchecked?: taskState = .unchecked
        case nil: taskState = nil
        }

        var result = [
            ListItem(
                marker: marker,
                content: joined(directContent, separator: .hardBreak) ?? .plain(""),
                indent: indent,
                taskState: taskState
            )
        ]
        for child in item.children {
            if let unordered = child as? Markdown.UnorderedList {
                result += listItems(from: unordered, orderedStart: nil, indent: indent + 1)
            } else if let ordered = child as? Markdown.OrderedList {
                result += listItems(
                    from: ordered,
                    orderedStart: ordered.startIndex,
                    indent: indent + 1
                )
            }
        }
        return result
    }

    private static func inlineContent(from markup: Markdown.Markup) -> InlineContent {
        InlineContent(runs: markup.children.map(inlineRun))
    }

    private static func inlineRun(_ markup: Markdown.Markup) -> InlineRun {
        if let text = markup as? Markdown.Text {
            return .text(text.string)
        }
        if let code = markup as? Markdown.InlineCode {
            return .code(code.code)
        }
        if markup is Markdown.SoftBreak {
            return .softBreak
        }
        if markup is Markdown.LineBreak {
            return .hardBreak
        }
        if let emphasis = markup as? Markdown.Emphasis {
            return .emphasis(emphasis.children.map(inlineRun))
        }
        if let strong = markup as? Markdown.Strong {
            return .strong(strong.children.map(inlineRun))
        }
        if let strikethrough = markup as? Markdown.Strikethrough {
            return .strikethrough(strikethrough.children.map(inlineRun))
        }
        if let link = markup as? Markdown.Link {
            return .link(destination: link.destination, children: link.children.map(inlineRun))
        }
        if let image = markup as? Markdown.Image {
            return .image(source: image.source, alt: image.children.map(inlineRun))
        }
        if let symbol = markup as? Markdown.SymbolLink {
            let destination = symbol.destination ?? ""
            return .link(destination: symbol.destination, children: [.code(destination)])
        }
        if let html = markup as? Markdown.InlineHTML {
            return .text(html.rawHTML)
        }
        if let custom = markup as? Markdown.CustomInline {
            return .text(custom.text)
        }
        // InlineAttributes and future container nodes retain their visible children.
        let children = markup.children.map(inlineRun)
        if !children.isEmpty { return .text(children.map(\.plainText).joined()) }
        return .text("")
    }

    private static func joined(
        _ contents: [InlineContent],
        separator: InlineRun
    ) -> InlineContent? {
        guard let first = contents.first else { return nil }
        var runs = first.runs
        for content in contents.dropFirst() {
            runs.append(separator)
            runs += content.runs
        }
        return InlineContent(runs: runs)
    }
}

/// Builds attributed inline runs directly from the AST adapter. It replaces Foundation's
/// `AttributedString(markdown:)` on active assistant-message content, so AST semantics are
/// stable for links, task content, GFM strikethrough, and image alt text.
enum MarkdownASTInlineRenderer {
    typealias InlineContent = MarkdownTextView.InlineContent
    typealias InlineRun = MarkdownTextView.InlineRun

    private struct Traits {
        var intent: InlinePresentationIntent = []
    }

    static func attributed(
        _ content: InlineContent,
        includeFormatting: Bool = true,
        context: MarkdownRenderContext = .chat
    ) -> AttributedString {
        guard includeFormatting else {
            return AttributedString(content.plainText)
        }
        var result = AttributedString()
        append(content.runs, to: &result, traits: Traits(), context: context)
        return FileReveal.injectPathLinks(into: result, cache: !context.isDocument)
    }

    private static func append(
        _ runs: [InlineRun],
        to result: inout AttributedString,
        traits: Traits,
        context: MarkdownRenderContext
    ) {
        for run in runs {
            switch run {
            case .text(let text):
                appendText(text, to: &result, traits: traits)
            case .softBreak, .hardBreak:
                appendText("\n", to: &result, traits: traits)
            case .code(let code):
                var codeTraits = traits
                codeTraits.intent.insert(.code)
                appendText(code, to: &result, traits: codeTraits)
            case .emphasis(let children):
                var emphasisTraits = traits
                emphasisTraits.intent.insert(.emphasized)
                append(children, to: &result, traits: emphasisTraits, context: context)
            case .strong(let children):
                var strongTraits = traits
                strongTraits.intent.insert(.stronglyEmphasized)
                append(children, to: &result, traits: strongTraits, context: context)
            case .strikethrough(let children):
                var strikeTraits = traits
                strikeTraits.intent.insert(.strikethrough)
                append(children, to: &result, traits: strikeTraits, context: context)
            case .link(let destination, let children):
                let start = result.endIndex
                append(children, to: &result, traits: traits, context: context)
                applyLink(
                    destination,
                    from: start,
                    to: result.endIndex,
                    in: &result,
                    context: context
                )
            case .image(let source, let alt):
                if context.isDocument,
                   let imageURL = MarkdownDocumentResourceResolver.localImageURL(
                       for: source,
                       context: context
                   ),
                   let attachment = MarkdownDocumentImageAttachment(sourceURL: imageURL) {
                    appendAttachment(attachment, to: &result)
                } else {
                    let start = result.endIndex
                    appendText("[Image: ", to: &result, traits: traits)
                    if alt.isEmpty {
                        appendText("image", to: &result, traits: traits)
                    } else {
                        append(alt, to: &result, traits: traits, context: context)
                    }
                    appendText("]", to: &result, traits: traits)
                    applyLink(
                        source,
                        from: start,
                        to: result.endIndex,
                        in: &result,
                        context: context
                    )
                }
            }
        }
    }

    private static func appendText(
        _ text: String,
        to result: inout AttributedString,
        traits: Traits
    ) {
        guard !text.isEmpty else { return }
        var value = AttributedString(text)
        if !traits.intent.isEmpty {
            value.inlinePresentationIntent = traits.intent
        }
        result.append(value)
    }

    private static func appendAttachment(
        _ attachment: MarkdownDocumentImageAttachment,
        to result: inout AttributedString
    ) {
        result.append(AttributedString(NSAttributedString(attachment: attachment)))
    }

    private static func applyLink(
        _ destination: String?,
        from start: AttributedString.Index,
        to end: AttributedString.Index,
        in result: inout AttributedString,
        context: MarkdownRenderContext
    ) {
        guard start < end, let destination else { return }
        if context.isDocument {
            guard let target = MarkdownDocumentResourceResolver.target(
                for: destination,
                context: context
            ) else { return }
            result[start..<end].link = target.url
            return
        }
        guard let url = URL(string: destination) else { return }
        result[start..<end].link = url
    }
}
