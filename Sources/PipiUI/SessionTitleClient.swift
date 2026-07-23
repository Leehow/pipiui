import Foundation

/// Ephemeral side-channel `pi --mode rpc` for one-shot session title generation.
/// No Boss prompt, no PipiUI extensions, no shared session file — never touches the main ChatSession process.
package enum SessionTitleClient {
    /// Truncate user text for the title prompt (character prefix, whitespace-trimmed).
    package static func truncateUserMessageForPrompt(_ message: String, maxChars: Int = 500) -> String {
        let t = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count > maxChars else { return t }
        return String(t.prefix(maxChars))
    }

    /// One-shot: spawn pi rpc in `projectURL`, optionally set model + thinking off, prompt for title, return parsed title or nil.
    /// Internal (uses module-internal `ModelInfo`); not part of the package test surface.
    static func generateTitle(
        from userMessage: String,
        projectURL: URL,
        model: ModelInfo?,
        timeoutSeconds: TimeInterval = 45
    ) async -> String? {
        let body = truncateUserMessageForPrompt(userMessage)
        guard !body.isEmpty else { return nil }
        if Task.isCancelled { return nil }

        let state = TitleGenerationState()

        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
                state.attach(continuation)

                let timeoutItem = DispatchWorkItem {
                    state.complete(nil)
                }
                state.setTimeoutItem(timeoutItem)
                DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: timeoutItem)

                DispatchQueue.main.async {
                    state.start(userMessage: body, projectURL: projectURL, model: model)
                }
            }
        } onCancel: {
            state.complete(nil)
        }
    }

    fileprivate static func contentText(_ content: J) -> String {
        if let s = content.string { return s }
        return content.array
            .compactMap { $0["type"].string == "text" ? $0["text"].string : nil }
            .joined(separator: "\n")
    }

    /// Fingerprint of the side-channel title prompt (first line). Used to detect orphan title sessions on disk.
    package static let titlePromptFingerprint = "Write a short session title for this user message"

    fileprivate static func titlePrompt(userMessage: String) -> String {
        """
        \(titlePromptFingerprint).
        Rules: 8–16 characters if Chinese (or a short English phrase); same language as the user; no quotes; no prefix; output ONLY the title line.

        User message:
        \"\"\"
        \(userMessage)
        \"\"\"
        """
    }
}

/// Main-thread pi lifecycle + single-resume continuation for one title generation.
private final class TitleGenerationState: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String?, Never>?
    private var done = false
    private var proc: PiProcess?
    private var buffer = ""
    private var timeoutItem: DispatchWorkItem?

    func attach(_ continuation: CheckedContinuation<String?, Never>) {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
    }

    func setTimeoutItem(_ item: DispatchWorkItem) {
        lock.lock()
        timeoutItem = item
        lock.unlock()
    }

    func complete(_ value: String?) {
        lock.lock()
        guard !done else {
            lock.unlock()
            return
        }
        done = true
        timeoutItem?.cancel()
        timeoutItem = nil
        let p = proc
        proc = nil
        let cont = continuation
        continuation = nil
        lock.unlock()

        if let p {
            // terminate() is safe from any thread; settles pending + SIGTERM.
            if Thread.isMainThread {
                p.terminate()
            } else {
                DispatchQueue.main.async { p.terminate() }
            }
        }
        cont?.resume(returning: value)
    }

    func start(userMessage: String, projectURL: URL, model: ModelInfo?) {
        // Caller schedules this on main.
        lock.lock()
        if done {
            lock.unlock()
            return
        }
        lock.unlock()

        // Ephemeral RPC only: never write a session jsonl, never load tools/extensions/skills.
        guard let proc = PiProcess(
            cwd: projectURL,
            arguments: [
                "--no-session",      // CRITICAL: no jsonl on disk
                "--no-tools",        // title only, no tools
                "--no-extensions",   // don't load ~/.pi extensions
                "--no-skills",
                "--no-prompt-templates",
                "--thinking", "off",
            ],
            extraEnv: [:]
        ) else {
            complete(nil)
            return
        }

        lock.lock()
        if done {
            lock.unlock()
            proc.terminate()
            return
        }
        self.proc = proc
        lock.unlock()

        proc.onEvent = { [weak self] e in
            guard let self else { return }
            let type = e["type"].string ?? ""
            switch type {
            case "message_start", "message_update", "message_end":
                if e["message"]["role"].string == "assistant" {
                    let text = SessionTitleClient.contentText(e["message"]["content"])
                    if !text.isEmpty {
                        self.lock.lock()
                        self.buffer = text
                        self.lock.unlock()
                    }
                }
            case "agent_settled":
                self.lock.lock()
                let raw = self.buffer
                self.lock.unlock()
                let parsed = SessionTitleLogic.parseModelTitle(raw)
                self.complete(parsed)
            default:
                break
            }
        }

        proc.onExit = { [weak self] _, _ in
            guard let self else { return }
            self.lock.lock()
            let already = self.done
            let raw = self.buffer
            self.lock.unlock()
            if already { return }
            // Died before settle — accept buffer only if it already parses cleanly.
            self.complete(SessionTitleLogic.parseModelTitle(raw))
        }

        let sendPrompt = { [weak self] in
            guard let self else { return }
            let message = SessionTitleClient.titlePrompt(userMessage: userMessage)
            proc.request(["type": "prompt", "message": message]) { [weak self] resp in
                if resp["success"].bool != true {
                    self?.complete(nil)
                }
            }
        }

        // Thinking is already off via CLI `--thinking off`; still set_model when provided.
        if let model {
            proc.request([
                "type": "set_model",
                "provider": model.provider,
                "modelId": model.modelId,
            ]) { _ in
                sendPrompt()
            }
        } else {
            sendPrompt()
        }
    }
}
