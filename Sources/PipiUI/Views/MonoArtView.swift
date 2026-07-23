import SwiftUI
import AppKit

/// 终端式逐字符网格排版：全角（CJK 等）占两格、半角占一格，
/// 用于渲染混排中文的 ASCII 框线图，保证竖线/箭头严格对齐。
struct MonoArtView: View {
    let text: String
    private static let fontSize: CGFloat = 12

    var body: some View {
        let lines = text.components(separatedBy: "\n")
        let cell = Self.cellSize
        let cols = lines.map(Self.columns).max() ?? 1
        Canvas { context, _ in
            for (row, line) in lines.enumerated() {
                var col = 0
                for ch in line {
                    let width = Self.isFullWidth(ch) ? 2 : 1
                    if ch != " " {
                        let point = CGPoint(
                            x: (CGFloat(col) + CGFloat(width) / 2) * cell.width,
                            y: (CGFloat(row) + 0.5) * cell.height
                        )
                        context.draw(
                            Text(String(ch)).font(.system(size: Self.fontSize, design: .monospaced)),
                            at: point, anchor: .center
                        )
                    }
                    col += width
                }
            }
        }
        .frame(
            width: CGFloat(max(cols, 1)) * cell.width,
            height: CGFloat(max(lines.count, 1)) * cell.height
        )
    }

    private static func columns(_ line: String) -> Int {
        line.reduce(0) { $0 + (isFullWidth($1) ? 2 : 1) }
    }

    private static let cellSize: CGSize = {
        let font = NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        let width = ("M" as NSString).size(withAttributes: [.font: font]).width
        let height = (font.ascender - font.descender + font.leading).rounded(.up) + 2
        return CGSize(width: width, height: height)
    }()

    /// 近似 Unicode East Asian Width：Wide/Fullwidth 判两格。
    static func isFullWidth(_ ch: Character) -> Bool {
        guard let scalar = ch.unicodeScalars.first else { return false }
        switch scalar.value {
        case 0x1100...0x115F,       // Hangul Jamo
             0x2E80...0x303E,       // CJK 部首、符号、标点（含全角空格前段）
             0x3041...0x33FF,       // 假名、CJK 兼容
             0x3400...0x4DBF,       // CJK 扩展 A
             0x4E00...0x9FFF,       // CJK 统一表意
             0xA000...0xA4CF,       // 彝文
             0xAC00...0xD7A3,       // 谚文音节
             0xF900...0xFAFF,       // CJK 兼容表意
             0xFE30...0xFE4F,       // CJK 兼容形式
             0xFF00...0xFF60,       // 全角 ASCII/标点
             0xFFE0...0xFFE6,       // 全角符号
             0x1F300...0x1F9FF,     // Emoji（多数按两格）
             0x20000...0x3FFFD:     // CJK 扩展 B+
            return true
        default:
            return false
        }
    }

    /// 是否包含框线/制表字符（判断代码块要不要走网格渲染）。
    static func hasBoxDrawing(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            (0x2500...0x257F).contains(scalar.value)      // Box Drawing
            || (0x2580...0x259F).contains(scalar.value)   // Block Elements
            || "▼▲◄►◆●".unicodeScalars.map(\.value).contains(scalar.value)
        }
    }
}
