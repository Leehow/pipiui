import AppKit
import Foundation

/// Run with `PIPIUI_SELF_TEST=1 swift run` — exits 0 on success.
enum SelfTest {
    static func runIfRequested() {
        guard ProcessInfo.processInfo.environment["PIPIUI_SELF_TEST"] == "1" else { return }
        var failures: [String] = []

        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            if ok {
                print("PASS  \(name)")
            } else {
                print("FAIL  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
                failures.append(name)
            }
        }

        // 1. Load PNG file
        let pngURL = URL(fileURLWithPath: "/tmp/pipiui-test.png")
        if !FileManager.default.fileExists(atPath: pngURL.path) {
            let img = NSImage(size: NSSize(width: 32, height: 32))
            img.lockFocus()
            NSColor.red.setFill()
            NSRect(x: 0, y: 0, width: 32, height: 32).fill()
            img.unlockFocus()
            if let tiff = img.tiffRepresentation,
               let rep = NSBitmapImageRep(data: tiff),
               let data = rep.representation(using: .png, properties: [:]) {
                try? data.write(to: pngURL)
            }
        }

        let fromFile = ImageAttachment.make(from: pngURL)
        var fileOK = false
        if case .success = fromFile { fileOK = true }
        check("make(from: url) succeeds", fileOK, "\(fromFile)")

        if case .success(let draft) = fromFile {
            check("mime is image/*", draft.mimeType.hasPrefix("image/"), draft.mimeType)
            check("preview non-empty",
                  draft.preview.size.width > 0 && draft.preview.size.height > 0,
                  "\(draft.preview.size)")
            check("data non-empty", !draft.data.isEmpty, "\(draft.data.count)")

            let payload = ImageAttachment.rpcPayload(from: [draft])
            check("rpc payload count 1", payload.count == 1)
            check("rpc type image", payload[0]["type"] as? String == "image")
            check("rpc has base64 data", (payload[0]["data"] as? String)?.isEmpty == false)
            check("rpc has mimeType",
                  (payload[0]["mimeType"] as? String)?.hasPrefix("image/") == true,
                  "\(payload[0]["mimeType"] ?? "nil")")

            let b64 = payload[0]["data"] as! String
            let mime = payload[0]["mimeType"] as! String
            let json: [String: Any] = [
                "type": "image",
                "data": b64,
                "mimeType": mime
            ]
            let block = ChatSession.parseImageBlock(J(json))
            check("parseImageBlock flat shape",
                  block != nil && block!.data == draft.data,
                  "\(String(describing: block?.data.count))")

            let nested: [String: Any] = [
                "type": "image",
                "source": [
                    "type": "base64",
                    "mediaType": mime,
                    "data": b64
                ] as [String: Any]
            ]
            let nestedBlock = ChatSession.parseImageBlock(J(nested))
            check("parseImageBlock nested source shape",
                  nestedBlock != nil && nestedBlock!.data == draft.data)
        }

        // 2. From NSImage
        let solid = NSImage(size: NSSize(width: 64, height: 48))
        solid.lockFocus()
        NSColor.blue.setFill()
        NSRect(x: 0, y: 0, width: 64, height: 48).fill()
        solid.unlockFocus()
        let fromImage = ImageAttachment.make(from: solid)
        var imageOK = false
        if case .success = fromImage { imageOK = true }
        check("make(from: NSImage) succeeds", imageOK, "\(fromImage)")

        // 3. Resize large image
        let big = NSImage(size: NSSize(width: 4000, height: 3000))
        big.lockFocus()
        NSColor.green.setFill()
        NSRect(x: 0, y: 0, width: 4000, height: 3000).fill()
        big.unlockFocus()
        switch ImageAttachment.make(from: big) {
        case .success(let resized):
            if let decoded = NSImage(data: resized.data) {
                let longest = max(decoded.size.width, decoded.size.height)
                check("large image longest edge ≤ 2000",
                      longest <= ImageAttachment.maxEdge + 1,
                      "longest=\(longest)")
            } else {
                check("decode resized", false)
            }
        case .failure(let err):
            check("resize large", false, "\(err)")
        }

        // 4. Reject empty
        var emptyFail = false
        if case .failure = ImageAttachment.make(from: Data()) { emptyFail = true }
        check("empty data fails", emptyFail)

        // 5. Pasteboard image detection
        let pb = NSPasteboard.withUniqueName()
        if case .success(let d) = fromFile {
            pb.clearContents()
            pb.setData(d.data, forType: .png)
            check("pasteboardHasImage after PNG write", ImageAttachment.pasteboardHasImage(pb))
            let imgs = ImageAttachment.imagesFromPasteboard(pb)
            check("imagesFromPasteboard non-empty", !imgs.isEmpty, "count=\(imgs.count)")
        }

        // 6. canSend logic equivalent
        func canSend(text: String, images: Int, alive: Bool) -> Bool {
            alive && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || images > 0)
        }
        check("canSend image-only", canSend(text: "", images: 1, alive: true))
        check("canSend text-only", canSend(text: "hi", images: 0, alive: true))
        check("canSend empty denied", !canSend(text: "  ", images: 0, alive: true))
        check("canSend dead process denied", !canSend(text: "hi", images: 1, alive: false))

        // 7. Transcript bubble path + multi-image prompt JSON
        if case .success(let draft) = fromFile {
            let imageBlock = ImageBlock(id: "t1", data: draft.data, mimeType: draft.mimeType)
            let item = ChatItem(id: "u1", role: "user", blocks: [
                .image(imageBlock),
                .text("caption")
            ])
            let imgs = item.blocks.compactMap { b -> ImageBlock? in
                if case .image(let i) = b { return i }
                return nil
            }
            let texts = item.blocks.compactMap { b -> String? in
                if case .text(let t) = b { return t }
                return nil
            }
            check("user item has image block", imgs.count == 1)
            check("user item has caption", texts == ["caption"])
            check("bubble can decode NSImage", NSImage(data: imgs[0].data) != nil)

            let payload2 = ImageAttachment.rpcPayload(from: [draft, draft])
            check("multi-image rpc payload", payload2.count == 2)

            let cmd: [String: Any] = [
                "type": "prompt",
                "message": "",
                "images": payload2
            ]
            let valid = JSONSerialization.isValidJSONObject(cmd)
            check("prompt+images JSON-serializable", valid)
            if valid, let data = try? JSONSerialization.data(withJSONObject: cmd),
               let parsed = J.parse(data) {
                check("serialized images count", parsed["images"].array.count == 2)
                check("serialized empty message allowed", parsed["message"].string == "")
            } else {
                check("serialized images count", false)
            }

            // Attachment disk + message annotation
            let tmpProject = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("pipiui-selftest-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: tmpProject, withIntermediateDirectories: true)
            let saved = ImageAttachment.saveToProjectAttachments([draft], projectURL: tmpProject)
            check("saveToProjectAttachments writes file", saved.count == 1 && FileManager.default.fileExists(atPath: saved[0].path))
            let annotated = ImageAttachment.messageWithAttachmentPaths(text: "看图", paths: saved)
            check("message includes real path", annotated.contains(saved[0].path))
            check("message discourages fake sandbox path", annotated.contains("/home/workdir/attachments"))

            // Display-only strip of attachment path footnotes
            let stripped = ImageAttachment.stripAttachmentPathsForDisplay(annotated)
            check("strip round-trip keeps user prose", stripped == "看图", "got: \(stripped)")

            let imageOnly = ImageAttachment.messageWithAttachmentPaths(text: "", paths: saved)
            let strippedEmpty = ImageAttachment.stripAttachmentPathsForDisplay(imageOnly)
            check("strip image-only yields empty", strippedEmpty.isEmpty, "got: \(strippedEmpty)")

            let multiPaths = [
                URL(fileURLWithPath: "/tmp/a.png"),
                URL(fileURLWithPath: "/tmp/b.png")
            ]
            let multiAnnotated = ImageAttachment.messageWithAttachmentPaths(text: "两张图", paths: multiPaths)
            let multiStripped = ImageAttachment.stripAttachmentPathsForDisplay(multiAnnotated)
            check("strip multi-path footer", multiStripped == "两张图", "got: \(multiStripped)")
            check("multi annotated still has paths for model", multiAnnotated.contains("/tmp/a.png") && multiAnnotated.contains("/tmp/b.png"))

            check("strip no-footer unchanged", ImageAttachment.stripAttachmentPathsForDisplay("普通文本") == "普通文本")

            let midAttached = "Please see Attached notes in the doc.\nMore text."
            check("strip mid-message Attached intact",
                  ImageAttachment.stripAttachmentPathsForDisplay(midAttached) == midAttached)

            // Restore-style flow: queue stores annotated text; restore strips for composer
            // (mirrors ChatSession.restoreQueueToDraft — avoid double path prep on resend)
            let annA = ImageAttachment.messageWithAttachmentPaths(text: "看图", paths: saved)
            let annB = ImageAttachment.messageWithAttachmentPaths(
                text: "第二", paths: [URL(fileURLWithPath: "/tmp/b-restore.png")]
            )
            let annImageOnly = ImageAttachment.messageWithAttachmentPaths(text: "", paths: saved)
            let restoreParts = [annA, annImageOnly, annB]
                .map { ImageAttachment.stripAttachmentPathsForDisplay($0) }
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            let restoreDisplay = SessionMessageQueue.joinTexts(restoreParts)
            check("restore-style strip multi keeps prose only",
                  restoreDisplay == "看图\n\n第二", "got: \(restoreDisplay)")
            check("restore-style image-only contributes no text",
                  ImageAttachment.stripAttachmentPathsForDisplay(annImageOnly).isEmpty)

            try? FileManager.default.removeItem(at: tmpProject)
        }

        // Thinking token estimate
        check("empty text → 0 tokens", ThinkingTokenEstimate.tokenCount(for: "") == 0)
        check("1 char → 1 token", ThinkingTokenEstimate.tokenCount(for: "a") == 1)
        check("4 chars → 1 token", ThinkingTokenEstimate.tokenCount(for: "abcd") == 1)
        check("5 chars → 1 token (round 1.25→1)", ThinkingTokenEstimate.tokenCount(for: "abcde") == 1)
        check("6 chars → 2 tokens (round 1.5→2)", ThinkingTokenEstimate.tokenCount(for: "abcdef") == 2)
        check("4000 chars → 1000 tokens", ThinkingTokenEstimate.tokenCount(for: String(repeating: "x", count: 4000)) == 1000)
        check("format 999", ThinkingTokenEstimate.formatCount(999) == "999")
        check("format 1000 → 1k", ThinkingTokenEstimate.formatCount(1000) == "1k")
        check("format 1200 → 1.2k", ThinkingTokenEstimate.formatCount(1200) == "1.2k")
        check("format 15400 → 15.4k", ThinkingTokenEstimate.formatCount(15400) == "15.4k")
        check("suffix empty nil", ThinkingTokenEstimate.labelSuffix(for: "") == nil)
        check("suffix sample", ThinkingTokenEstimate.labelSuffix(for: String(repeating: "x", count: 4800)) == "~1.2k tokens")

        // 8. Session message queue (follow-up / restore / intercept drain)
        var q = SessionMessageQueue()
        check("enqueue rejects empty", q.enqueue(text: "  ", images: []) == false)
        check("enqueue text", q.enqueue(text: "first"))
        check("enqueue second", q.enqueue(text: "second"))
        check("queue count 2", q.count == 2)

        // No drain while streaming
        check("no pop while streaming",
              q.popForIdleDrain(isStreaming: true, processAlive: true) == nil)
        check("still 2 after blocked pop", q.count == 2)

        // Idle drain FIFO
        let head = q.popForIdleDrain(isStreaming: false, processAlive: true)
        check("pop head first", head?.text == "first")
        check("one left", q.count == 1 && q.items.first?.text == "second")

        // Requeue front on failure
        if let head {
            q.requeueFront(head)
            check("requeue front", q.items.first?.text == "first" && q.count == 2)
            // pop again to restore single "second" scenario for later tests
            _ = q.popForIdleDrain(isStreaming: false, processAlive: true)
        }

        // Abort intercept flag (Stop / 插队 cut-in while streaming)
        q.noteAbort()
        check("abort sets intercept when non-empty", q.interceptSendFirst)
        let afterAbort = q.popForIdleDrain(isStreaming: false, processAlive: true)
        check("intercept pop sends remaining head", afterAbort?.text == "second")
        check("intercept cleared after pop", q.interceptSendFirst == false)
        check("queue empty", q.isEmpty)

        // Cut-in while idle: same drain path without needing streaming abort
        // (ChatSession.cutInQueueHead → drainQueueIfIdle → popForIdleDrain)
        _ = q.enqueue(text: "cut-a")
        _ = q.enqueue(text: "cut-b")
        let cutHead = q.popForIdleDrain(isStreaming: false, processAlive: true)
        check("cut-in idle pops head only", cutHead?.text == "cut-a")
        check("cut-in leaves FIFO tail", q.count == 1 && q.items.first?.text == "cut-b")
        _ = q.restoreAll()

        // noteAbort on empty is no-op
        q.noteAbort()
        check("abort empty no intercept", q.interceptSendFirst == false)

        // restoreAll join + clear
        _ = q.enqueue(text: "a")
        _ = q.enqueue(text: "b")
        q.noteAbort()
        let restored = q.restoreAll()
        check("restore join blank line", restored.text == "a\n\nb", "got: \(restored.text)")
        check("restore clears queue", q.isEmpty && q.interceptSendFirst == false)

        // dead process no pop
        _ = q.enqueue(text: "x")
        check("dead process no pop",
              q.popForIdleDrain(isStreaming: false, processAlive: false) == nil)
        _ = q.restoreAll()

        // joinTexts helper
        check("joinTexts single", SessionMessageQueue.joinTexts(["only"]) == "only")
        check("joinTexts multi", SessionMessageQueue.joinTexts(["a", "b"]) == "a\n\nb")

        // 9. 扩展撞名检测（pi 对同名工具是硬失败，必须在 spawn 前拦住）
        let fakeAgentDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("pipiui-ext-\(UUID().uuidString)", isDirectory: true)
        let extDir = fakeAgentDir.appendingPathComponent("extensions/subagent", isDirectory: true)
        try? FileManager.default.createDirectory(at: extDir, withIntermediateDirectories: true)
        let conflictEntry = extDir.appendingPathComponent("index.ts")
        try? #"pi.registerTool({\#n\tname: "subagent",\#n})"#.write(to: conflictEntry, atomically: true, encoding: .utf8)
        let innocent = fakeAgentDir.appendingPathComponent("extensions/other.ts")
        try? #"pi.registerTool({ name: "other" })"#.write(to: innocent, atomically: true, encoding: .utf8)

        let found = PiExtensionConflicts.scan(baseDir: fakeAgentDir, scopeLabel: "test")
        check("detects conflicting subagent extension", found.count == 1, "\(found.map(\.entryPath))")
        check("resolves dir to index.ts entry", found.first?.entryPath == conflictEntry.path,
              found.first?.entryPath ?? "nil")
        check("ignores unrelated extension", !found.contains { $0.entryPath == innocent.path })

        if let conflict = found.first {
            try? PiExtensionConflicts.disable(conflict)
            let after = PiExtensionConflicts.scan(baseDir: fakeAgentDir, scopeLabel: "test")
            check("disable clears the conflict", after.isEmpty, "\(after.map(\.entryPath))")
            let settings = fakeAgentDir.appendingPathComponent("settings.json")
            let text = (try? String(contentsOf: settings, encoding: .utf8)) ?? ""
            check("disable writes force-exclude pattern", text.contains("-\(conflictEntry.path)"), text)
            check("disable keeps files on disk", FileManager.default.fileExists(atPath: conflictEntry.path))
        }
        try? FileManager.default.removeItem(at: fakeAgentDir)

        // 10. WebViewStore: superseded navigation must respond old request (not hang).
        // Root cause regression: awaitNavigation used to overwrite navCompletion without
        // calling the previous respond, leaving browser_navigate fetch hung forever.
        do {
            let store = WebViewStore()
            var first: [String: Any]?
            var firstCalled = false
            store.handle(action: "navigate", request: J(["url": "about:blank"]), respond: { r in
                firstCalled = true
                first = r
            })
            // Immediately stack a second navigate — old request must be failed, not dropped.
            store.handle(action: "navigate", request: J(["url": "about:blank"]), respond: { _ in })
            check("superseded nav calls old respond immediately", firstCalled)
            check("superseded nav ok:false",
                  first?["ok"] as? Bool == false,
                  "\(String(describing: first))")
            let err = first?["error"] as? String ?? ""
            check("superseded nav error mentions superseded",
                  err.lowercased().contains("superseded"),
                  err)

            // Same path via reload stacking on an in-flight navigate.
            var reloadFirst: [String: Any]?
            var reloadFirstCalled = false
            store.handle(action: "navigate", request: J(["url": "about:blank"]), respond: { r in
                reloadFirstCalled = true
                reloadFirst = r
            })
            store.handle(action: "reload", request: J([:]), respond: { _ in })
            check("reload-supersedes-nav calls old respond", reloadFirstCalled)
            check("reload-supersedes-nav ok:false",
                  reloadFirst?["ok"] as? Bool == false,
                  "\(String(describing: reloadFirst))")

            // #12 invalid URL must fail immediately (no 20s awaitNavigation hang)
            var invalid: [String: Any]?
            store.handle(action: "navigate", request: J(["url": "not a valid url :::"]), respond: { invalid = $0 })
            check("invalid url fails immediately", invalid?["ok"] as? Bool == false,
                  "\(String(describing: invalid))")
            check("invalid url error text",
                  (invalid?["error"] as? String)?.contains("invalid") == true,
                  "\(String(describing: invalid?["error"]))")
            check("resolvedURL rejects garbage",
                  store.resolvedURL(from: "not a valid url :::") == nil)
            check("resolvedURL accepts example.com",
                  store.resolvedURL(from: "example.com")?.host == "example.com")

            // Follow-up A: stale cancel must not complete the *new* pending with ok:true.
            // Consecutive navigate supersedes the first; a synthetic NSURLErrorCancelled
            // with a non-matching (nil) WKNavigation must be ignored.
            var second: [String: Any]?
            var secondCount = 0
            store.handle(action: "navigate", request: J(["url": "about:blank"]), respond: { _ in })
            store.handle(action: "navigate", request: J(["url": "about:blank"]), respond: { r in
                secondCount += 1
                second = r
            })
            let cancelled = NSError(
                domain: NSURLErrorDomain,
                code: NSURLErrorCancelled,
                userInfo: [NSLocalizedDescriptionKey: "cancelled"]
            )
            store.webView(store.webView, didFailProvisionalNavigation: nil, withError: cancelled)
            store.webView(store.webView, didFail: nil, withError: cancelled)
            check("stale cancel does not complete new pending",
                  secondCount == 0,
                  "second respond fired early: \(String(describing: second))")

            // Real failure on the current load must report ok:false (not ok:true).
            // Fresh store; nonexistent file:// fails provisional reliably (localhost:1 can
            // spuriously didFinish about:blank under some WK builds).
            let failStore = WebViewStore()
            var failResp: [String: Any]?
            var failDone = false
            let missingFile = "file:///no/such/path/pipiui-selftest-\(UUID().uuidString).html"
            failStore.handle(
                action: "navigate",
                request: J(["url": missingFile]),
                respond: { r in
                    failResp = r
                    failDone = true
                }
            )
            let failDeadline = Date().addingTimeInterval(5)
            while !failDone && Date() < failDeadline {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
            }
            check("real nav failure settles",
                  failDone,
                  "completion never fired")
            check("real nav failure ok:false",
                  failResp?["ok"] as? Bool == false,
                  "\(String(describing: failResp))")
            let failErr = failResp?["error"] as? String ?? ""
            check("real nav failure has error text",
                  !failErr.isEmpty,
                  failErr)
        }

        // 11. PiProcess: request after death + pending failed on terminate (#6)
        // Callbacks arrive on main via async; SelfTest already runs on main → pump RunLoop.
        func pumpMain(until deadline: Date, isDone: () -> Bool) {
            while !isDone() && Date() < deadline {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
            }
        }

        let piCwd = URL(fileURLWithPath: NSTemporaryDirectory())
        if PiProcess.findPiExecutable() != nil {
            if let proc = PiProcess(cwd: piCwd, arguments: []) {
                check("pi process starts", proc.isRunning)

                var afterDeath: J?
                var afterDeathDone = false
                var exited = false
                proc.onExit = { _, _ in exited = true }
                proc.terminate()
                pumpMain(until: Date().addingTimeInterval(5)) { exited }
                check("pi process exits after terminate", exited && !proc.isRunning)

                proc.request(["type": "get_state"]) { resp in
                    afterDeath = resp
                    afterDeathDone = true
                }
                pumpMain(until: Date().addingTimeInterval(2)) { afterDeathDone }
                check("request after death completes", afterDeathDone,
                      "completion never fired")
                check("request after death success=false",
                      afterDeath?["success"].bool == false,
                      "\(afterDeath?.raw ?? "nil")")
                let deathErr = afterDeath?["error"].string ?? ""
                check("request after death has error",
                      deathErr.contains("not running") || deathErr.contains("exited"),
                      deathErr)
            } else {
                check("pi process starts", false, "PiProcess init returned nil")
            }

            // Pending request must settle when process is terminated mid-flight.
            if let proc = PiProcess(cwd: piCwd, arguments: []) {
                var midFlight: J?
                var midDone = false
                proc.request(["type": "get_state"]) { resp in
                    midFlight = resp
                    midDone = true
                }
                pumpMain(until: Date().addingTimeInterval(0.15)) { false }
                proc.terminate()
                pumpMain(until: Date().addingTimeInterval(5)) { midDone }
                check("pending request settles on process exit", midDone,
                      "completion never fired")
                let ok = midFlight?["success"].bool
                let err = midFlight?["error"].string ?? ""
                check("pending request settled with response or failure",
                      midFlight != nil && (ok == true || err.contains("exited") || err.contains("not running")),
                      "\(midFlight?.raw ?? "nil")")
            }

            // Follow-up B: terminate() must settle pending *synchronously* so releasing
            // the PiProcess before terminationHandler's main.async cannot drop completions.
            if let proc = PiProcess(cwd: piCwd, arguments: []) {
                var syncDone = false
                var syncResp: J?
                var syncCalls = 0
                proc.request(["type": "get_state"]) { resp in
                    syncCalls += 1
                    syncResp = resp
                    syncDone = true
                }
                // No RunLoop pump — pending is still in-flight (response arrives via main.async).
                proc.terminate()
                check("terminate settles pending synchronously", syncDone,
                      "completion never fired (would hang if only terminationHandler async)")
                check("terminate pending success=false",
                      syncResp?["success"].bool == false,
                      "\(syncResp?.raw ?? "nil")")
                let syncErr = syncResp?["error"].string ?? ""
                check("terminate pending error mentions exited",
                      syncErr.contains("exited") || syncErr.contains("not running"),
                      syncErr)

                // Drop last strong ref; deinit must not double-fire the already-settled completion.
                // (proc ends at end of this block after we nil out via local scope)
                pumpMain(until: Date().addingTimeInterval(0.5)) { false }
                check("terminate pending fires exactly once", syncCalls == 1, "calls=\(syncCalls)")
            }

            // Follow-up B: release without explicit terminate still settles pending in deinit.
            var deinitDone = false
            var deinitResp: J?
            var deinitCalls = 0
            autoreleasepool {
                guard let proc = PiProcess(cwd: piCwd, arguments: []) else {
                    check("pi process starts for deinit test", false, "PiProcess init returned nil")
                    return
                }
                proc.request(["type": "get_state"]) { resp in
                    deinitCalls += 1
                    deinitResp = resp
                    deinitDone = true
                }
                // Leave scope without terminate() — deinit must failAllPending.
            }
            check("deinit settles pending", deinitDone,
                  "completion never fired on release")
            check("deinit pending success=false",
                  deinitResp?["success"].bool == false,
                  "\(deinitResp?.raw ?? "nil")")
            check("deinit pending fires exactly once", deinitCalls == 1, "calls=\(deinitCalls)")
        } else {
            print("SKIP  pi process lifecycle tests (pi executable not found)")
        }

        // 12. Bridge rejects unknown session key (no currentSession fallback) (#4)
        do {
            let bridge = BridgeServer { request, respond, _ in
                // Mirror AppStore routing after the fix
                let key = request["sessionKey"].string ?? ""
                let open: [String: Bool] = ["alive-key": true]
                guard !key.isEmpty, open[key] == true else {
                    respond(["ok": false, "error": "unknown session key"])
                    return
                }
                respond(["ok": true])
            }
            if let bridge {
                let port = bridge.port
                func postRPC(_ body: [String: Any]) -> [String: Any]? {
                    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
                    var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/rpc")!)
                    req.httpMethod = "POST"
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    req.httpBody = data
                    let sem = DispatchSemaphore(value: 0)
                    var result: [String: Any]?
                    URLSession.shared.dataTask(with: req) { data, _, _ in
                        defer { sem.signal() }
                        if let data,
                           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            result = obj
                        }
                    }.resume()
                    _ = sem.wait(timeout: .now() + 3)
                    return result
                }

                let box = NSMutableDictionary()
                let group = DispatchGroup()

                group.enter()
                DispatchQueue.global().async {
                    if let r = postRPC(["sessionKey": "missing", "action": "info"]) {
                        box["r"] = r
                    }
                    group.leave()
                }
                var deadline = Date().addingTimeInterval(4)
                while group.wait(timeout: .now() + 0.05) == .timedOut, Date() < deadline {
                    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
                }
                let unknown = box["r"] as? [String: Any]
                check("bridge unknown key rejected",
                      unknown?["ok"] as? Bool == false,
                      "\(String(describing: unknown))")
                check("bridge unknown key error text",
                      (unknown?["error"] as? String)?.contains("unknown session key") == true,
                      "\(String(describing: unknown?["error"]))")

                box.removeObject(forKey: "r")
                group.enter()
                DispatchQueue.global().async {
                    if let r = postRPC(["sessionKey": "alive-key", "action": "info"]) {
                        box["r"] = r
                    }
                    group.leave()
                }
                deadline = Date().addingTimeInterval(4)
                while group.wait(timeout: .now() + 0.05) == .timedOut, Date() < deadline {
                    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
                }
                let known = box["r"] as? [String: Any]
                check("bridge known key accepted", known?["ok"] as? Bool == true,
                      "\(String(describing: known))")
                bridge.stop()
            } else {
                check("bridge server starts", false)
            }
        }

        // 13. SubagentStore.saveNow without attach must not crash (closeSession path) (#8)
        do {
            let agents = SubagentStore()
            agents.handle(J([
                "kind": "start",
                "agentId": "a1",
                "name": "explore",
                "task": "t",
                "depth": 1,
                "worktreePath": "/tmp/fake-wt",
                "worktreeBranch": "pipiui/a1",
            ] as [String: Any]))
            agents.saveNow()
            check("saveNow without attach is safe", true)
            check("subagent recorded", agents.agents.count == 1)
            check("worktree lifecycle active on start",
                  agents.agents.first?.worktreeLifecycle == .active)
            agents.handle(J([
                "kind": "end",
                "agentId": "a1",
                "ok": true,
                "aborted": false,
                "worktreePath": "/tmp/fake-wt",
                "worktreeBranch": "pipiui/a1",
            ] as [String: Any]))
            check("worktree lifecycle pendingReview on end",
                  agents.agents.first?.worktreeLifecycle == .pendingReview
                  && agents.agents.first?.canReviewWorktree == true)
            // Resume same agentId → active again
            agents.handle(J([
                "kind": "start",
                "agentId": "a1",
                "name": "explore",
                "task": "continue",
                "depth": 1,
                "worktreePath": "/tmp/fake-wt",
                "worktreeBranch": "pipiui/a1",
            ] as [String: Any]))
            check("worktree lifecycle resume active",
                  agents.agents.count == 1
                  && agents.agents.first?.state == .running
                  && agents.agents.first?.worktreeLifecycle == .active)
        }

        // 14. SessionTitleLogic + SessionTitleClient pure helpers
        check("title parse strips quotes",
              SessionTitleLogic.parseModelTitle("「侧栏品牌与会话标题」") == "侧栏品牌与会话标题")
        check("title parse strips label + first line",
              SessionTitleLogic.parseModelTitle("Title: Hello\nmore") == "Hello")
        check("title parse rejects empty",
              SessionTitleLogic.parseModelTitle("   ") == nil)
        check("title parse rejects too long",
              SessionTitleLogic.parseModelTitle(String(repeating: "字", count: 41)) == nil)
        check("title placeholder name",
              SessionTitleLogic.isPlaceholderName(nil)
              && SessionTitleLogic.isPlaceholderName("新会话")
              && SessionTitleLogic.isPlaceholderName("  ")
              && !SessionTitleLogic.isPlaceholderName("侧栏标题"))
        let provCJK = SessionTitleLogic.provisionalTitle(
            from: "修复会话自动标题显示ISO日期文件名而不是真实标题的问题需要尽快处理")
        check("provisional CJK length",
              provCJK != nil && provCJK!.count <= 16
              && "修复会话自动标题显示ISO日期文件名而不是真实标题的问题需要尽快处理".hasPrefix(provCJK!))
        check("provisional CJK break at punct",
              SessionTitleLogic.provisionalTitle(from: "侧栏品牌与会话标题。继续很长的说明") == "侧栏品牌与会话标题")
        let provEn = SessionTitleLogic.provisionalTitle(
            from: "Fix session auto title showing ISO date filenames instead of real titles please")
        check("provisional English cap",
              provEn != nil && provEn!.count <= 24)
        check("provisional rejects internal",
              SessionTitleLogic.provisionalTitle(from: "[PipiUI internal — x]") == nil)
        check("junk rejects ISO filename",
              SessionTitleLogic.isJunkAutoTitle("2026-07-23T15-31-40-489Z_019f8f9a-abc"))
        check("junk rejects path and markdown",
              SessionTitleLogic.isJunkAutoTitle("foo/bar")
              && SessionTitleLogic.isJunkAutoTitle("# Heading")
              && SessionTitleLogic.isJunkAutoTitle("**x**")
              && SessionTitleLogic.isJunkAutoTitle("Write a short session title"))
        check("junk allows real title",
              !SessionTitleLogic.isJunkAutoTitle("侧栏标题")
              && !SessionTitleLogic.isJunkAutoTitle("Fix auto title"))
        check("parse rejects junk titles",
              SessionTitleLogic.parseModelTitle("2026-07-23T15-31-40-489Z_x") == nil
              && SessionTitleLogic.parseModelTitle("# not a title") == nil
              && SessionTitleLogic.parseModelTitle("好标题") == "好标题")
        let longPrompt = String(repeating: "a", count: 600)
        check("title prompt truncate 500",
              SessionTitleClient.truncateUserMessageForPrompt(longPrompt).count == 500
              && SessionTitleClient.truncateUserMessageForPrompt("  hi  ") == "hi")

        // 15. SubagentDoneMessage parse (collapsed bubble input)
        do {
            let sample = """
                [subagent-done] agentId=a1 name=explore ok=true aborted=false cost=0.0123 turns=4

                Task: dig into SidebarView
                Result:
                fixed the indicator
                more lines here
                """.trimmingCharacters(in: .whitespacesAndNewlines)
            let p = SubagentDoneMessage.parse(sample)
            check("subagent-done parse ok", p != nil)
            check("subagent-done fields",
                  p?.name == "explore"
                  && p?.ok == true
                  && p?.aborted == false
                  && p?.cost == "0.0123"
                  && p?.outcome == .ok
                  && p?.task == "dig into SidebarView"
                  && (p?.result.contains("fixed the indicator") == true),
                  "\(String(describing: p))")

            let failSample = "[subagent-done] agentId=x name=worker ok=false aborted=false cost=1 turns=2\n\nTask: t\nResult:\nbad"
            check("subagent-done fail outcome",
                  SubagentDoneMessage.parse(failSample)?.outcome == .fail)

            let abortSample = "[subagent-done] agentId=x name=worker ok=false aborted=true cost=0 turns=0\n\nTask: t\nResult:\nstopped"
            check("subagent-done aborted outcome",
                  SubagentDoneMessage.parse(abortSample)?.outcome == .aborted)

            check("subagent-done rejects plain user text",
                  SubagentDoneMessage.parse("hello world") == nil)

            // Prefix only / broken body still parses header for collapse title
            let bare = "[subagent-done] name=z ok=true aborted=false"
            let bareP = SubagentDoneMessage.parse(bare)
            check("subagent-done bare header",
                  bareP?.name == "z" && bareP?.task.isEmpty == true && bareP?.result.isEmpty == true)
        }

        print("---")
        if failures.isEmpty {
            print("ALL PASSED")
            exit(0)
        } else {
            print("FAILED \(failures.count): \(failures.joined(separator: ", "))")
            exit(1)
        }
    }
}
