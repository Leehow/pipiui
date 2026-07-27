import Foundation
import CoreGraphics

struct ComputerKeyChord: Equatable, Sendable {
    let keyCode: CGKeyCode
    let modifiers: CGEventFlags
    let displayName: String

    static func parse(keys: [String], fallbackText: String? = nil) throws -> ComputerKeyChord {
        var tokens = keys
        if tokens.isEmpty, let fallbackText {
            tokens = fallbackText
                .split(separator: "+")
                .map { String($0) }
        }
        tokens = tokens
            .flatMap { $0.split(separator: "+").map(String.init) }
            .map(normalize)
            .filter { !$0.isEmpty }
        guard !tokens.isEmpty else {
            throw ComputerKeyError.missingKey
        }

        var flags: CGEventFlags = []
        var primary: String?
        for token in tokens {
            if let modifier = modifierFlag(token) {
                flags.insert(modifier)
                continue
            }
            guard primary == nil else {
                throw ComputerKeyError.multiplePrimaryKeys
            }
            primary = token
        }

        // A modifier-only hold is useful for `hold_key`.
        if primary == nil, tokens.count == 1,
           let code = modifierKeyCode(tokens[0]) {
            return ComputerKeyChord(
                keyCode: code,
                modifiers: modifierFlag(tokens[0]) ?? [],
                displayName: tokens.joined(separator: "+")
            )
        }
        guard let primary, let keyCode = keyCodes[primary] else {
            throw ComputerKeyError.unknownKey(primary ?? tokens.joined(separator: "+"))
        }
        return ComputerKeyChord(
            keyCode: keyCode,
            modifiers: flags,
            displayName: tokens.joined(separator: "+")
        )
    }

    private static func normalize(_ value: String) -> String {
        let upper = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        switch upper {
        case "COMMAND", "META", "SUPER": return "CMD"
        case "CONTROL": return "CTRL"
        case "OPTION", "ALT": return "OPT"
        case "ESC": return "ESCAPE"
        case "RETURN": return "ENTER"
        case "BACKSPACE": return "DELETE"
        case "ARROWUP": return "UP"
        case "ARROWDOWN": return "DOWN"
        case "ARROWLEFT": return "LEFT"
        case "ARROWRIGHT": return "RIGHT"
        case "SPACEBAR": return "SPACE"
        default: return upper
        }
    }

    private static func modifierFlag(_ value: String) -> CGEventFlags? {
        switch value {
        case "CMD": return .maskCommand
        case "CTRL": return .maskControl
        case "OPT": return .maskAlternate
        case "SHIFT": return .maskShift
        case "FN": return .maskSecondaryFn
        default: return nil
        }
    }

    private static func modifierKeyCode(_ value: String) -> CGKeyCode? {
        switch value {
        case "CMD": return 55
        case "SHIFT": return 56
        case "OPT": return 58
        case "CTRL": return 59
        case "FN": return 63
        default: return nil
        }
    }

    /// US virtual-key positions. Text entry uses Unicode events instead.
    private static let keyCodes: [String: CGKeyCode] = [
        "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
        "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
        "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
        "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "O": 31, "U": 32, "[": 33, "I": 34, "P": 35,
        "ENTER": 36, "L": 37, "J": 38, "'": 39, "K": 40, ";": 41,
        "\\": 42, ",": 43, "/": 44, "N": 45, "M": 46, ".": 47,
        "TAB": 48, "SPACE": 49, "`": 50, "DELETE": 51, "ESCAPE": 53,
        "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
        "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
        "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121,
        "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126,
        "FORWARDDELETE": 117,
    ]
}

enum ComputerKeyError: LocalizedError, Equatable {
    case missingKey
    case multiplePrimaryKeys
    case unknownKey(String)

    var errorDescription: String? {
        switch self {
        case .missingKey: return "keypress requires at least one named key"
        case .multiplePrimaryKeys: return "keypress may contain only one non-modifier key"
        case .unknownKey(let key):
            return "unsupported named key \(key); use the type action for text"
        }
    }
}
