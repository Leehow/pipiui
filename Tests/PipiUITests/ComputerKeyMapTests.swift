import XCTest
import CoreGraphics
@testable import PipiUI

final class ComputerKeyMapTests: XCTestCase {
    func testParsesNamedShortcutAndAliases() throws {
        let chord = try ComputerKeyChord.parse(keys: ["command", "shift", "p"])
        XCTAssertEqual(chord.keyCode, 35)
        XCTAssertTrue(chord.modifiers.contains(.maskCommand))
        XCTAssertTrue(chord.modifiers.contains(.maskShift))
    }

    func testParsesPlusDelimitedFallback() throws {
        let chord = try ComputerKeyChord.parse(keys: [], fallbackText: "ctrl+alt+escape")
        XCTAssertEqual(chord.keyCode, 53)
        XCTAssertTrue(chord.modifiers.contains(.maskControl))
        XCTAssertTrue(chord.modifiers.contains(.maskAlternate))
    }

    func testRejectsUnknownAndMultiplePrimaryKeys() {
        XCTAssertThrowsError(try ComputerKeyChord.parse(keys: ["MAGIC"]))
        XCTAssertThrowsError(try ComputerKeyChord.parse(keys: ["A", "B"]))
    }

    func testInputValidationAllowsAppSwitchAndDestructiveShortcuts() {
        let size = ComputerImageSize(width: 100, height: 100)
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        for keys in [["CMD", "TAB"], ["CMD", "SPACE"], ["CMD", "Q"], ["CMD", "DELETE"]] {
            let action = ComputerAction(
                kind: .key,
                coordinate: nil,
                startCoordinate: nil,
                text: nil,
                keys: keys,
                scrollDirection: nil,
                scrollAmount: nil,
                duration: nil
            )
            XCTAssertNoThrow(try ComputerInputSynth.shared.validate(
                actions: [action],
                imageSize: size,
                displayBounds: bounds
            ), "expected unrestricted shortcut \(keys)")
        }
    }
}
