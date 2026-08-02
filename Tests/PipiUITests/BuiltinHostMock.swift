import Foundation
import PipiUI

final class BuiltinHostMock: BuiltinCommandHost {
    var flashMessages: [String] = []
    var compactCount = 0
    var reloadCount = 0
    var setNames: [String] = []
    var showStatsCount = 0
    var exportCount = 0
    var copyCount = 0
    var setModels: [String] = []
    var newCount = 0
    var quitCount = 0
    var schedulePrompts: [String] = []

    var onRequestNewSession: (() -> Void)?
    var onRequestClose: (() -> Void)?

    func flash(_ message: String) { flashMessages.append(message) }
    func runCompact() { compactCount += 1 }
    func runReload() { reloadCount += 1 }
    func runSetSessionName(_ name: String) { setNames.append(name) }
    func runShowSessionStats() { showStatsCount += 1 }
    func runExportHTML() { exportCount += 1 }
    func runCopyLastAssistant() { copyCount += 1 }
    func runSetModel(providerSlashId: String) { setModels.append(providerSlashId) }
    func runScheduleDraft(_ prompt: String) { schedulePrompts.append(prompt) }

    func enableNew() {
        onRequestNewSession = { [weak self] in self?.newCount += 1 }
    }
    func enableQuit() {
        onRequestClose = { [weak self] in self?.quitCount += 1 }
    }
}
