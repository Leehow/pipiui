import XCTest
import WebKit
@testable import PipiUI

private final class BrowserFixtureSchemeTask: @unchecked Sendable {
    let task: WKURLSchemeTask
    let response: URLResponse
    let data: Data

    init(task: WKURLSchemeTask, response: URLResponse, data: Data) {
        self.task = task
        self.response = response
        self.data = data
    }
}

private final class BrowserFixtureSchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
    private let pages: [String: String]
    private let preCommitDelays: [String: TimeInterval]
    private let completionDelays: [String: TimeInterval]

    init(
        pages: [String: String],
        preCommitDelays: [String: TimeInterval] = [:],
        completionDelays: [String: TimeInterval] = [:]
    ) {
        self.pages = pages
        self.preCommitDelays = preCommitDelays
        self.completionDelays = completionDelays
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        if url.path == "/slow" {
            // Intentionally remain pending until WebKit cancels the scheme task.
            return
        }
        guard let html = pages[url.path] else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let data = Data(html.utf8)
        let response = URLResponse(
            url: url,
            mimeType: "text/html",
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        let fixture = BrowserFixtureSchemeTask(task: urlSchemeTask, response: response, data: data)
        let deliver = { [self] in
            fixture.task.didReceive(fixture.response)
            fixture.task.didReceive(fixture.data)
            if let delay = completionDelays[url.path], delay > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    fixture.task.didFinish()
                }
            } else {
                fixture.task.didFinish()
            }
        }
        if let delay = preCommitDelays[url.path], delay > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: deliver)
        } else {
            deliver()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

@MainActor
final class BrowserDOMControllerTests: XCTestCase {
    override func setUpWithError() throws {
        guard ProcessInfo.processInfo.environment["PIPIUI_RUN_BROWSER_DOM_TESTS"] == "1" else {
            throw XCTSkip(
                "opt-in: WKWebView initializes NSApplication and must run in an isolated focused test process"
            )
        }
    }

    private func loadFixture(in store: WebViewStore) throws {
        let html = #"""
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Browser fixture</title>
          <style>
            body { margin: 0; width: 1000px; min-height: 2400px; }
            button, input, select, h1, nav, #editable, iframe { display: block; width: 320px; height: 40px; margin: 8px; }
          </style>
        </head>
        <body>
          <nav aria-label="Fixture navigation"><a href="#end">Jump</a></nav>
          <h1>Structured browser fixture</h1>
          <label for="name">Full name</label>
          <input id="name" value="private initial value">
          <input id="hidden" aria-label="Hidden input" hidden>
          <button id="disabled" disabled>Disabled button</button>
          <button id="action">Run action</button>
          <label for="choice">Choice</label>
          <select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
          <div id="editable" contenteditable="true" aria-label="Editable note">Old</div>
          <div id="scrollbox" tabindex="0" aria-label="Scrollable region" style="display:block;width:320px;height:100px;overflow:auto">
            <div style="height:800px">Scrollable contents</div>
          </div>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" value="NEVER_EXPOSE_PASSWORD">
          <label for="card">Card number</label>
          <input id="card" autocomplete="section-checkout billing cc-number" value="4111111111111111">
          <div id="shadow-host"></div>
          <iframe id="same-origin" title="Same origin frame" srcdoc="&lt;button id='frame-button'&gt;Frame action&lt;/button&gt;"></iframe>
          <iframe id="opaque-frame" title="Opaque frame" sandbox srcdoc="&lt;button&gt;Opaque action&lt;/button&gt;"></iframe>
          <canvas width="20" height="20"></canvas>
          <div id="end" style="margin-top:1600px">End</div>
          <script>
            window.fixtureEvents = [];
            for (const id of ['name', 'choice', 'action', 'editable']) {
              const element = document.getElementById(id);
              for (const event of ['input', 'change', 'click']) {
                element.addEventListener(event, () => window.fixtureEvents.push(id + ':' + event));
              }
            }
            const shadow = document.getElementById('shadow-host').attachShadow({mode:'open'});
            shadow.innerHTML = '<button id="shadow-action">Shadow action</button>';
          </script>
        </body>
        </html>
        """#
        try loadHTML(html, in: store, expectedTitle: "Browser fixture")
    }

    private func loadHTML(
        _ html: String,
        in store: WebViewStore,
        expectedTitle: String
    ) throws {
        store.webView.loadHTMLString(html, baseURL: URL(string: "https://fixture.example/"))
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if !store.webView.isLoading,
               store.webView.title == expectedTitle {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        XCTFail("WKWebView fixture did not finish loading")
    }

    private func call(
        _ store: WebViewStore,
        action: String,
        request: [String: Any] = [:],
        timeout: TimeInterval = 5
    ) throws -> [String: Any] {
        let expectation = expectation(description: "browser \(action)")
        var response: [String: Any]?
        var body = request
        body["requestID"] = body["requestID"] ?? UUID().uuidString
        store.handle(action: action, request: J(body)) {
            response = $0
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: timeout)
        return try XCTUnwrap(response)
    }

    private func elements(_ response: [String: Any]) -> [[String: Any]] {
        response["elements"] as? [[String: Any]] ?? []
    }

    private func serialized(_ response: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
    }

    private func foundationUTF16Length(_ response: [String: Any]) throws -> Int {
        let data = try JSONSerialization.data(withJSONObject: response)
        return try XCTUnwrap(String(data: data, encoding: .utf8)).utf16.count
    }

    private func element(
        named name: String,
        tag: String? = nil,
        in response: [String: Any]
    ) throws -> [String: Any] {
        try XCTUnwrap(elements(response).first {
            $0["name"] as? String == name && (tag == nil || $0["tag"] as? String == tag)
        })
    }

    func testBundledControllerAndStructuredObservation() throws {
        let source = try BrowserDOMControllerResource.bundledSource()
        XCTAssertTrue(source.contains("MAX_ELEMENTS = 256"))
        XCTAssertTrue(source.contains("MAX_UTF16_UNITS = 20000"))
        XCTAssertTrue(source.contains("user_handoff_required"))

        let store = WebViewStore()
        try loadFixture(in: store)
        let response = try call(store, action: "observe")
        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertNotNil(response["snapshotID"] as? String)
        XCTAssertEqual((response["viewport"] as? [String: Any])?["width"] as? Int, 1024)

        let names = Set(elements(response).compactMap { $0["name"] as? String })
        XCTAssertTrue(names.contains("Structured browser fixture"))
        XCTAssertTrue(names.contains("Full name"))
        XCTAssertTrue(names.contains("Run action"))
        XCTAssertTrue(names.contains("Shadow action"))
        XCTAssertTrue(names.contains("Frame action"))
        XCTAssertFalse(names.contains("Hidden input"))
        XCTAssertFalse(names.contains("Disabled button"))
        let limitations = response["limitations"] as? [String] ?? []
        XCTAssertTrue(limitations.contains { $0.contains("cross_origin_iframe") })
        XCTAssertTrue(limitations.contains { $0.contains("canvas_or_webgl") })
        XCTAssertTrue(limitations.contains { $0.contains("closed_shadow_roots") })
        XCTAssertTrue(limitations.contains { $0.contains("js_dialogs_not_handled") })
        XCTAssertTrue(limitations.contains { $0.contains("file_input_paths_not_supported") })

        let password = try element(named: "Password", tag: "input", in: response)
        XCTAssertEqual(password["valueHint"] as? String, "sensitive value hidden")
        let card = try element(named: "Card number", tag: "input", in: response)
        XCTAssertEqual(card["valueHint"] as? String, "sensitive value hidden")
        let encoded = try JSONSerialization.data(withJSONObject: response)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("NEVER_EXPOSE_PASSWORD"))
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("4111111111111111"))
    }

    func testTypedActionsEventsStaleDetectionAndNoInputEcho() throws {
        let store = WebViewStore()
        try loadFixture(in: store)
        let first = try call(store, action: "observe")
        let firstSnapshot = try XCTUnwrap(first["snapshotID"] as? String)
        let nameInput = try element(named: "Full name", tag: "input", in: first)

        let input = try call(store, action: "input", request: [
            "snapshot_id": firstSnapshot,
            "element_token": try XCTUnwrap(nameInput["token"] as? String),
            "text": "SECRET_TYPED_VALUE",
        ])
        XCTAssertEqual(input["ok"] as? Bool, true)
        XCTAssertEqual((input["action"] as? [String: Any])?["characterCount"] as? Int, 18)
        let inputJSON = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
        XCTAssertFalse(inputJSON.contains("SECRET_TYPED_VALUE"))

        let oldTarget = try element(named: "Run action", in: first)
        let stale = try call(store, action: "click", request: [
            "snapshot_id": firstSnapshot,
            "element_token": try XCTUnwrap(oldTarget["token"] as? String),
        ])
        XCTAssertEqual(stale["ok"] as? Bool, false)
        XCTAssertEqual(stale["code"] as? String, "stale_browser_snapshot")
        XCTAssertEqual(stale["requiresObservation"] as? Bool, true)

        let refreshed = try call(store, action: "observe")
        let secondSnapshot = try XCTUnwrap(refreshed["snapshotID"] as? String)
        let choice = try element(named: "Choice", tag: "select", in: refreshed)
        let selected = try call(store, action: "select", request: [
            "snapshot_id": secondSnapshot,
            "element_index": try XCTUnwrap(choice["index"] as? Int),
            "option": "Beta",
        ])
        XCTAssertEqual(selected["ok"] as? Bool, true, "\(selected)")
        XCTAssertEqual((selected["action"] as? [String: Any])?["selected"] as? String, "Beta")

        let thirdSnapshot = try XCTUnwrap(selected["snapshotID"] as? String)
        let actionButton = try element(named: "Run action", in: selected)
        let clicked = try call(store, action: "click", request: [
            "snapshot_id": thirdSnapshot,
            "element_token": try XCTUnwrap(actionButton["token"] as? String),
        ])
        XCTAssertEqual(clicked["ok"] as? Bool, true)

        let fourthSnapshot = try XCTUnwrap(clicked["snapshotID"] as? String)
        let editable = try element(named: "Editable note", tag: "div", in: clicked)
        let edited = try call(store, action: "input", request: [
            "snapshot_id": fourthSnapshot,
            "element_token": try XCTUnwrap(editable["token"] as? String),
            "text": "EDITED_CONTENT",
        ])
        XCTAssertEqual(edited["ok"] as? Bool, true)
        XCTAssertEqual((edited["action"] as? [String: Any])?["characterCount"] as? Int, 14)
        let editedJSON = String(decoding: try JSONSerialization.data(withJSONObject: edited), as: UTF8.self)
        XCTAssertFalse(editedJSON.contains("EDITED_CONTENT"))

        let scrollRegion = try element(named: "Scrollable region", tag: "div", in: edited)
        let targetedScroll = try call(store, action: "scroll", request: [
            "snapshot_id": try XCTUnwrap(edited["snapshotID"] as? String),
            "element_token": try XCTUnwrap(scrollRegion["token"] as? String),
            "direction": "down",
            "amount": 0.5,
        ])
        XCTAssertEqual(targetedScroll["ok"] as? Bool, true)
        let scrollTop = try call(store, action: "eval", request: [
            "js": "document.getElementById('scrollbox').scrollTop",
        ])
        XCTAssertGreaterThan(Int(scrollTop["result"] as? String ?? "0") ?? 0, 0)

        let scrolled = try call(store, action: "scroll", request: [
            "direction": "down",
            "amount": 0.5,
        ])
        XCTAssertEqual(scrolled["ok"] as? Bool, true)
        XCTAssertEqual((scrolled["action"] as? [String: Any])?["direction"] as? String, "down")
        XCTAssertGreaterThan((scrolled["scroll"] as? [String: Any])?["pixelsAbove"] as? Int ?? 0, 0)

        let events = try call(store, action: "eval", request: ["js": "JSON.stringify(window.fixtureEvents)"])
        let eventText = events["result"] as? String ?? ""
        XCTAssertTrue(eventText.contains("name:input"))
        XCTAssertTrue(eventText.contains("name:change"))
        XCTAssertTrue(eventText.contains("choice:input"))
        XCTAssertTrue(eventText.contains("choice:change"))
        XCTAssertTrue(eventText.contains("action:click"))
        XCTAssertTrue(eventText.contains("editable:input"))
        XCTAssertTrue(eventText.contains("editable:change"))
    }

    func testSensitiveInputRequiresUserHandoffAndDOMReplacementIsStale() throws {
        let store = WebViewStore()
        try loadFixture(in: store)
        let first = try call(store, action: "observe")
        let password = try element(named: "Password", tag: "input", in: first)
        let handoff = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(first["snapshotID"] as? String),
            "element_token": try XCTUnwrap(password["token"] as? String),
            "text": "ATTEMPTED_SECRET",
        ])
        XCTAssertEqual(handoff["ok"] as? Bool, false)
        XCTAssertEqual(handoff["code"] as? String, "user_handoff_required")
        XCTAssertEqual(handoff["requiresUserInput"] as? Bool, true)
        let handoffJSON = String(decoding: try JSONSerialization.data(withJSONObject: handoff), as: UTF8.self)
        XCTAssertFalse(handoffJSON.contains("ATTEMPTED_SECRET"))
        XCTAssertFalse(handoffJSON.contains("NEVER_EXPOSE_PASSWORD"))

        let observed = try call(store, action: "observe")
        let button = try element(named: "Run action", in: observed)
        _ = try call(store, action: "eval", request: [
            "js": "document.getElementById('action').replaceWith(document.getElementById('action').cloneNode(true)); true",
        ])
        let stale = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(observed["snapshotID"] as? String),
            "element_token": try XCTUnwrap(button["token"] as? String),
        ])
        XCTAssertEqual(stale["code"] as? String, "stale_browser_snapshot")
        XCTAssertEqual(stale["requiresObservation"] as? Bool, true)

        let routeSnapshot = try call(store, action: "observe")
        let routeButton = try element(named: "Run action", in: routeSnapshot)
        _ = try call(store, action: "eval", request: [
            "js": "history.pushState({}, '', '/changed-route'); true",
        ])
        let routeStale = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(routeSnapshot["snapshotID"] as? String),
            "element_token": try XCTUnwrap(routeButton["token"] as? String),
        ])
        XCTAssertEqual(routeStale["code"] as? String, "stale_browser_snapshot")
        XCTAssertTrue((routeStale["error"] as? String ?? "").contains("URL changed"))
    }

    func testCancellationRespondsOnceAndClearsActivity() throws {
        let store = WebViewStore()
        try loadFixture(in: store)
        let requestID = UUID().uuidString
        let responseExpectation = expectation(description: "cancel response")
        var responses: [[String: Any]] = []
        store.handle(action: "observe", request: J(["requestID": requestID])) {
            responses.append($0)
            responseExpectation.fulfill()
        }
        XCTAssertEqual(store.browserActivity, .observing)
        store.cancelRequest(requestID: requestID, reason: "test cancellation")
        wait(for: [responseExpectation], timeout: 2)
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))

        XCTAssertEqual(responses.count, 1)
        XCTAssertEqual(responses.first?["code"] as? String, "request_cancelled")
        XCTAssertEqual(store.browserActivity, .idle)
    }

    func testSessionStoresKeepIndependentSnapshots() throws {
        let firstStore = WebViewStore()
        let secondStore = WebViewStore()
        try loadFixture(in: firstStore)
        try loadFixture(in: secondStore)
        let first = try call(firstStore, action: "observe")
        let second = try call(secondStore, action: "observe")
        XCTAssertNotEqual(first["snapshotID"] as? String, second["snapshotID"] as? String)

        let firstButton = try element(named: "Run action", in: first)
        let crossSession = try call(secondStore, action: "click", request: [
            "snapshot_id": try XCTUnwrap(first["snapshotID"] as? String),
            "element_token": try XCTUnwrap(firstButton["token"] as? String),
        ])
        XCTAssertEqual(crossSession["code"] as? String, "stale_browser_snapshot")
    }

    func testObservationBudgetsAreEnforced() throws {
        let buttons = (0..<400).map {
            "<button style='display:block;width:500px;height:30px'>Button \($0) \(String(repeating: "x", count: 180))</button>"
        }.joined()
        let store = WebViewStore()
        try loadHTML(
            "<title>Budget fixture</title><body style='min-height:20000px'>\(buttons)</body>",
            in: store,
            expectedTitle: "Budget fixture"
        )
        let response = try call(store, action: "observe", request: ["scope": "page"])
        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(response["truncated"] as? Bool, true)
        XCTAssertLessThanOrEqual(elements(response).count, 256)
        let encoded = try JSONSerialization.data(withJSONObject: response)
        XCTAssertLessThanOrEqual(String(decoding: encoded, as: UTF8.self).utf16.count, 20_000)
    }

    func testComposedHiddenSubtreesAreSkippedAndOrderIsDeterministic() throws {
        let store = WebViewStore()
        let html = #"""
        <title>Composed hidden fixture</title>
        <style>button,iframe { display:block; width:240px; height:40px }</style>
        <div hidden><button>Hidden light button</button></div>
        <div aria-hidden="true"><button>Aria hidden button</button></div>
        <div id="hidden-shadow" hidden></div>
        <iframe hidden srcdoc="<button>Hidden frame button</button>"></iframe>
        <h1>Visible heading</h1><button>Visible button</button>
        <script>
          const root = document.getElementById('hidden-shadow').attachShadow({mode:'open'});
          root.innerHTML = '<button>Hidden shadow button</button>';
        </script>
        """#
        try loadHTML(html, in: store, expectedTitle: "Composed hidden fixture")
        let first = try call(store, action: "observe", request: ["scope": "page"])
        let second = try call(store, action: "observe", request: ["scope": "page"])
        let firstOrder = elements(first).map { "\($0["tag"] ?? "")|\($0["name"] ?? "")|\($0["frame"] ?? "")" }
        let secondOrder = elements(second).map { "\($0["tag"] ?? "")|\($0["name"] ?? "")|\($0["frame"] ?? "")" }
        XCTAssertEqual(firstOrder, secondOrder)
        XCTAssertTrue(firstOrder.contains { $0.contains("Visible button") })
        for hidden in ["Hidden light", "Aria hidden", "Hidden shadow", "Hidden frame"] {
            XCTAssertFalse(firstOrder.contains { $0.contains(hidden) })
        }
    }

    func testFingerprintOwnershipAndImmediateStateRevalidation() throws {
        let store = WebViewStore()
        let html = #"""
        <title>Stale semantics fixture</title>
        <style>a,button,iframe { display:block; width:300px; height:40px }</style>
        <div id="wrapper"><button id="hide">Hide target</button></div>
        <button id="disable">Disable target</button>
        <a id="link" href="#first" onclick="window.fired += 1">Stable link name</a>
        <form id="form" action="/first" method="get"><button id="submit">Submit stable name</button></form>
        <div id="editable" contenteditable="true" aria-label="Editable semantics">Edit</div>
        <iframe id="frame" srcdoc="<button id='migrate'>Migrating node</button>"></iframe>
        <script>window.fired = 0; form.addEventListener('submit', () => window.fired += 1)</script>
        """#
        try loadHTML(html, in: store, expectedTitle: "Stale semantics fixture")

        func expectStale(named name: String, tag: String? = nil, mutation: String) throws {
            let observation = try call(store, action: "observe", request: ["scope": "page"])
            let target = try element(named: name, tag: tag, in: observation)
            _ = try call(store, action: "eval", request: ["js": mutation])
            let result = try call(store, action: "click", request: [
                "snapshot_id": try XCTUnwrap(observation["snapshotID"] as? String),
                "element_token": try XCTUnwrap(target["token"] as? String),
            ])
            XCTAssertEqual(result["code"] as? String, "stale_browser_snapshot", "\(name): \(result)")
        }

        try expectStale(named: "Hide target", mutation: "document.getElementById('wrapper').hidden=true; true")
        _ = try call(store, action: "eval", request: ["js": "document.getElementById('wrapper').hidden=false; true"])
        try expectStale(named: "Disable target", mutation: "document.getElementById('disable').disabled=true; true")
        _ = try call(store, action: "eval", request: ["js": "document.getElementById('disable').disabled=false; true"])
        try expectStale(named: "Stable link name", mutation: "document.getElementById('link').href='#second'; true")
        try expectStale(named: "Submit stable name", tag: "button", mutation: "document.getElementById('form').action='/second'; true")
        try expectStale(named: "Editable semantics", mutation: "document.getElementById('editable').contentEditable='false'; true")
        try expectStale(
            named: "Migrating node",
            mutation: "const f=document.getElementById('frame'); document.body.appendChild(document.adoptNode(f.contentDocument.getElementById('migrate'))); true"
        )
        let fired = try call(store, action: "eval", request: ["js": "window.fired"])
        XCTAssertEqual(fired["result"] as? String, "0")
    }

    func testFocusReentrancyCannotBypassStaleOrSensitiveGates() throws {
        let store = WebViewStore()
        let html = #"""
        <title>Focus reentrancy fixture</title>
        <style>button,a,input,select,h1 { display:block; width:360px; height:40px }</style>
        <h1 id="mirror">Safe mirror</h1>
        <button id="hide">Focus hides button</button>
        <a id="link" href="#first">Focus mutates href</a>
        <form id="form" action="/first"><button id="submit" type="submit">Focus mutates form</button></form>
        <label for="choice">Focus disables select</label>
        <select id="choice"><option>Alpha</option><option>Beta</option></select>
        <label for="detach">Focus detaches input</label><input id="detach">
        <label for="convert">Focus becomes password</label><input id="convert" value="PRE_FOCUS_VALUE">
        <script>
          window.actionEvents = [];
          for (const id of ['hide','link','submit','choice','detach','convert']) {
            for (const type of ['click','input','change','submit']) {
              document.getElementById(id).addEventListener(type, () => actionEvents.push(id + ':' + type));
            }
          }
          form.addEventListener('submit', () => actionEvents.push('form:submit'));
          hide.addEventListener('focus', () => { hide.hidden = true; });
          link.addEventListener('focus', () => { link.href = '#second'; });
          submit.addEventListener('focus', () => { form.action = '/second'; });
          choice.addEventListener('focus', () => { choice.disabled = true; });
          detach.addEventListener('focus', () => { detach.remove(); });
          convert.addEventListener('focus', () => {
            convert.type = 'password';
            convert.autocomplete = 'current-password';
            convert.value = 'POST_FOCUS_SECRET';
            mirror.textContent = 'PRE_FOCUS_VALUE POST_FOCUS_SECRET';
            document.title = 'POST_FOCUS_SECRET';
          });
        </script>
        """#
        try loadHTML(html, in: store, expectedTitle: "Focus reentrancy fixture")

        func act(_ action: String, name: String, tag: String? = nil, extra: [String: Any] = [:]) throws -> [String: Any] {
            let observation = try call(store, action: "observe", request: ["scope": "page"])
            let target = try element(named: name, tag: tag, in: observation)
            var request: [String: Any] = [
                "snapshot_id": try XCTUnwrap(observation["snapshotID"] as? String),
                "element_token": try XCTUnwrap(target["token"] as? String),
            ]
            request.merge(extra) { _, replacement in replacement }
            return try call(store, action: action, request: request)
        }

        XCTAssertEqual(try act("click", name: "Focus hides button")["code"] as? String, "stale_browser_snapshot")
        XCTAssertEqual(try act("click", name: "Focus mutates href")["code"] as? String, "stale_browser_snapshot")
        XCTAssertEqual(try act("click", name: "Focus mutates form", tag: "button")["code"] as? String, "stale_browser_snapshot")
        XCTAssertEqual(try act("select", name: "Focus disables select", tag: "select", extra: ["option": "Beta"])["code"] as? String, "stale_browser_snapshot")
        XCTAssertEqual(try act("input", name: "Focus detaches input", tag: "input", extra: ["text": "DETACHED_WRITE"])["code"] as? String, "stale_browser_snapshot")

        let handoff = try act(
            "input",
            name: "Focus becomes password",
            tag: "input",
            extra: ["text": "SUPPLIED_FOCUS_SECRET"]
        )
        XCTAssertEqual(handoff["code"] as? String, "user_handoff_required")
        let handoffJSON = try serialized(handoff)
        for secret in ["PRE_FOCUS_VALUE", "POST_FOCUS_SECRET", "SUPPLIED_FOCUS_SECRET"] {
            XCTAssertFalse(handoffJSON.contains(secret), secret)
        }
        let events = try call(store, action: "eval", request: ["js": "JSON.stringify(window.actionEvents)"])
        XCTAssertEqual(events["result"] as? String, "[]")
    }

    func testSemanticSensitiveControlsRequireHandoffWhilePromoCodeRemainsUsable() throws {
        let store = WebViewStore()
        let html = #"""
        <title>Semantic sensitive fixture</title>
        <style>input,select,h1 { display:block; width:420px; height:40px }</style>
        <h1 id="mirror">Safe mirror</h1>
        <label for="otp">Authentication code</label>
        <input id="otp" name="verificationCode" inputmode="numeric" value="OTP_PRESET_928341">
        <label for="cardNumber">Credit card number</label>
        <input id="cardNumber" inputmode="numeric" value="4111111111111111">
        <label for="cvv">CVV</label><input id="cvv" inputmode="numeric" value="951">
        <label for="expiry">Card expiry</label><input id="expiry" value="12/39">
        <label for="cnCard">银行卡号</label><input id="cnCard" value="6222020000000000">
        <label for="expMonth">Expiry month</label>
        <select id="expMonth" autocomplete="cc-exp-month">
          <option value="07" selected>Month Seven</option><option value="08">Month Eight</option>
        </select>
        <label for="converted">Billing cycle</label>
        <select id="converted">
          <option value="PRE_SELECT_VALUE" selected>Initial cycle</option><option value="FOCUS_SELECT_SECRET">November</option>
        </select>
        <label for="promo">Promo code</label><input id="promo" name="promoCode">
        <script>
          window.semanticEvents = [];
          for (const id of ['otp','cardNumber','cvv','expiry','cnCard','expMonth','converted','promo']) {
            const control = document.getElementById(id);
            for (const event of ['click','input','change']) {
              control.addEventListener(event, () => semanticEvents.push(id + ':' + event));
            }
          }
          converted.addEventListener('focus', () => {
            converted.setAttribute('autocomplete', 'cc-exp-month');
            converted.value = 'FOCUS_SELECT_SECRET';
            mirror.textContent = 'FOCUS_SELECT_SECRET';
            document.title = 'FOCUS_SELECT_SECRET';
          }, { once: true });
        </script>
        """#
        try loadHTML(html, in: store, expectedTitle: "Semantic sensitive fixture")

        let initial = try call(store, action: "observe", request: ["scope": "page"])
        for (name, tag) in [
            ("Authentication code", "input"), ("Credit card number", "input"), ("CVV", "input"),
            ("Card expiry", "input"), ("银行卡号", "input"), ("Expiry month", "select"),
        ] {
            let control = try element(named: name, tag: tag, in: initial)
            XCTAssertEqual(control["valueHint"] as? String, "sensitive value hidden", name)
        }
        XCTAssertNotEqual(
            try element(named: "Promo code", tag: "input", in: initial)["valueHint"] as? String,
            "sensitive value hidden"
        )

        func current(_ name: String, tag: String? = nil) throws -> ([String: Any], [String: Any]) {
            let observation = try call(store, action: "observe", request: ["scope": "page"])
            return (observation, try element(named: name, tag: tag, in: observation))
        }

        let (otpObservation, otp) = try current("Authentication code", tag: "input")
        let clickedOTP = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(otpObservation["snapshotID"] as? String),
            "element_token": try XCTUnwrap(otp["token"] as? String),
        ])
        XCTAssertEqual(clickedOTP["code"] as? String, "user_handoff_required")

        for (name, text) in [
            ("Credit card number", "4000000000000002"),
            ("CVV", "737"),
            ("Card expiry", "08/41"),
            ("银行卡号", "6222029999999999"),
        ] {
            let (observation, control) = try current(name, tag: "input")
            let result = try call(store, action: "input", request: [
                "snapshot_id": try XCTUnwrap(observation["snapshotID"] as? String),
                "element_token": try XCTUnwrap(control["token"] as? String),
                "text": text,
            ])
            XCTAssertEqual(result["code"] as? String, "user_handoff_required", name)
        }

        let (monthObservation, month) = try current("Expiry month", tag: "select")
        let selectedMonth = try call(store, action: "select", request: [
            "snapshot_id": try XCTUnwrap(monthObservation["snapshotID"] as? String),
            "element_token": try XCTUnwrap(month["token"] as? String),
            "option": "Month Eight",
        ])
        XCTAssertEqual(selectedMonth["code"] as? String, "user_handoff_required")

        let (convertedObservation, converted) = try current("Billing cycle", tag: "select")
        let convertedResult = try call(store, action: "select", request: [
            "snapshot_id": try XCTUnwrap(convertedObservation["snapshotID"] as? String),
            "element_token": try XCTUnwrap(converted["token"] as? String),
            "option": "November",
        ])
        XCTAssertEqual(convertedResult["code"] as? String, "user_handoff_required")

        let (promoObservation, promo) = try current("Promo code", tag: "input")
        let promoResult = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(promoObservation["snapshotID"] as? String),
            "element_token": try XCTUnwrap(promo["token"] as? String),
            "text": "SAVE20",
        ])
        XCTAssertEqual(promoResult["ok"] as? Bool, true)

        let state = try call(store, action: "eval", request: [
            "js": "[otp.value,cardNumber.value,cvv.value,expiry.value,cnCard.value,expMonth.value,converted.value,promo.value,semanticEvents.join(',')].join('|')",
        ])
        let parts = (state["result"] as? String ?? "").split(separator: "|", omittingEmptySubsequences: false)
        XCTAssertEqual(parts[0], "OTP_PRESET_928341")
        XCTAssertEqual(parts[1], "4111111111111111")
        XCTAssertEqual(parts[2], "951")
        XCTAssertEqual(parts[3], "12/39")
        XCTAssertEqual(parts[4], "6222020000000000")
        XCTAssertEqual(parts[5], "07")
        XCTAssertEqual(parts[6], "FOCUS_SELECT_SECRET")
        XCTAssertEqual(parts[7], "SAVE20")
        let eventLog = String(parts[8])
        XCTAssertFalse(eventLog.contains("otp:click"))
        for id in ["cardNumber", "cvv", "expiry", "cnCard", "expMonth", "converted"] {
            XCTAssertFalse(eventLog.contains("\(id):click"), id)
            XCTAssertFalse(eventLog.contains("\(id):input"), id)
            XCTAssertFalse(eventLog.contains("\(id):change"), id)
        }
        XCTAssertTrue(eventLog.contains("promo:input"))
        XCTAssertTrue(eventLog.contains("promo:change"))

        let later = try call(store, action: "observe", request: ["scope": "page"])
        let laterJSON = try serialized(later)
        for secret in [
            "OTP_PRESET_928341", "4111111111111111", "12/39", "6222020000000000",
            "4000000000000002", "08/41", "6222029999999999", "PRE_SELECT_VALUE", "FOCUS_SELECT_SECRET",
        ] {
            XCTAssertFalse(laterJSON.contains(secret), secret)
        }
    }

    func testHostileMirrorsCannotEchoOrdinaryOrSensitiveInput() throws {
        let store = WebViewStore()
        let html = #"""
        <title>Hostile mirror fixture</title>
        <style>input,textarea,h1,h2,h3 { display:block; width:500px; height:40px }</style>
        <h1 id="mirror">Safe heading</h1>
        <h2 id="plusMirror">Safe plus mirror</h2>
        <h3 id="lowerMirror">Safe lower mirror</h3>
        <label for="ordinary">Ordinary field</label><input id="ordinary">
        <label for="secret">Secret field</label><input id="secret" type="password" value="PREEXISTING_PASSWORD">
        <label for="otp">OTP textarea</label><textarea id="otp" autocomplete="one-time-code">OTP_TEXTAREA_SECRET</textarea>
        <script>
          ordinary.addEventListener('input', () => {
            mirror.textContent = ordinary.value;
            plusMirror.textContent = new URLSearchParams({q: ordinary.value}).toString();
            lowerMirror.textContent = encodeURIComponent(ordinary.value).replace(/%[0-9A-F]{2}/g, x => x.toLowerCase());
            document.title = ordinary.value;
            history.replaceState({}, '', '/q/' + encodeURIComponent(ordinary.value));
          });
          secret.addEventListener('focus', () => {
            secret.value = 'FOCUS_REPLACED_PASSWORD';
            mirror.textContent = 'PREEXISTING_PASSWORD FOCUS_REPLACED_PASSWORD';
            document.title = 'FOCUS_REPLACED_PASSWORD';
          });
        </script>
        """#
        try loadHTML(html, in: store, expectedTitle: "Hostile mirror fixture")
        let first = try call(store, action: "observe")
        let ordinary = try element(named: "Ordinary field", tag: "input", in: first)
        let typed = "TOP SECRET ✓ VALUE"
        let input = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(first["snapshotID"] as? String),
            "element_token": try XCTUnwrap(ordinary["token"] as? String),
            "text": typed,
        ])
        let inputJSON = try serialized(input)
        XCTAssertFalse(inputJSON.contains(typed))
        XCTAssertFalse(inputJSON.contains("TOP%20SECRET%20%E2%9C%93%20VALUE"))
        XCTAssertFalse(inputJSON.contains("TOP+SECRET+%E2%9C%93+VALUE"))
        XCTAssertFalse(inputJSON.contains("TOP%20SECRET%20%e2%9c%93%20VALUE"))
        XCTAssertEqual((input["action"] as? [String: Any])?["characterCount"] as? Int, typed.count)

        let second = try call(store, action: "observe")
        let secondJSON = try serialized(second)
        XCTAssertFalse(secondJSON.contains(typed))
        XCTAssertFalse(secondJSON.contains("TOP%20SECRET%20%E2%9C%93%20VALUE"))
        XCTAssertFalse(secondJSON.contains("TOP+SECRET+%E2%9C%93+VALUE"))
        XCTAssertFalse(secondJSON.contains("TOP%20SECRET%20%e2%9c%93%20VALUE"))
        let secret = try element(named: "Secret field", tag: "input", in: second)
        let handoff = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(second["snapshotID"] as? String),
            "element_token": try XCTUnwrap(secret["token"] as? String),
            "text": "ATTEMPTED_PASSWORD",
        ])
        let handoffJSON = try serialized(handoff)
        XCTAssertEqual(handoff["code"] as? String, "user_handoff_required")
        XCTAssertLessThanOrEqual(try foundationUTF16Length(handoff), 20_000)
        for value in [
            typed, "TOP%20SECRET%20%E2%9C%93%20VALUE", "ATTEMPTED_PASSWORD",
            "PREEXISTING_PASSWORD", "FOCUS_REPLACED_PASSWORD",
        ] {
            XCTAssertFalse(handoffJSON.contains(value), value)
        }

        let afterPassword = try call(store, action: "observe")
        let afterPasswordJSON = try serialized(afterPassword)
        for value in [typed, "PREEXISTING_PASSWORD", "FOCUS_REPLACED_PASSWORD", "ATTEMPTED_PASSWORD"] {
            XCTAssertFalse(afterPasswordJSON.contains(value), value)
        }
        let otp = try element(named: "OTP textarea", tag: "textarea", in: afterPassword)
        let otpHandoff = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(afterPassword["snapshotID"] as? String),
            "element_token": try XCTUnwrap(otp["token"] as? String),
            "text": "SUPPLIED_OTP_SECRET",
        ])
        XCTAssertEqual(otpHandoff["code"] as? String, "user_handoff_required")
        XCTAssertLessThanOrEqual(try foundationUTF16Length(otpHandoff), 20_000)
        let otpJSON = try serialized(otpHandoff)
        for value in [typed, "OTP_TEXTAREA_SECRET", "SUPPLIED_OTP_SECRET", "FOCUS_REPLACED_PASSWORD"] {
            XCTAssertFalse(otpJSON.contains(value), value)
        }
        let finalObservation = try call(store, action: "observe")
        let finalJSON = try serialized(finalObservation)
        for value in [typed, "OTP_TEXTAREA_SECRET", "SUPPLIED_OTP_SECRET", "PREEXISTING_PASSWORD", "FOCUS_REPLACED_PASSWORD"] {
            XCTAssertFalse(finalJSON.contains(value), value)
        }
    }

    func testNativePrototypeSetterAndIsolatedWorldResistPageTampering() throws {
        let store = WebViewStore()
        let html = #"""
        <title>Controlled fixture</title>
        <style>input,button { display:block; width:320px; height:40px }</style>
        <label for="controlled">Controlled value</label><input id="controlled">
        <button id="action">Tamper proof action</button>
        <script>
          const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          window.ownSetterCalls = 0;
          Object.defineProperty(controlled, 'value', {
            configurable: true,
            get() { return nativeDescriptor.get.call(this); },
            set(value) { window.ownSetterCalls += 1; nativeDescriptor.set.call(this, value); }
          });
          window.__pipiBrowserDOM = Object.freeze({dispatch(){ return {ok:false,error:'PAGE_WORLD_FAKE'}; }});
        </script>
        """#
        try loadHTML(html, in: store, expectedTitle: "Controlled fixture")
        let first = try call(store, action: "observe")
        XCTAssertEqual(first["ok"] as? Bool, true)
        let pageWorld = try call(store, action: "eval", request: [
            "js": "window.__pipiBrowserDOM.dispatch({}).error",
        ])
        XCTAssertEqual(pageWorld["result"] as? String, "PAGE_WORLD_FAKE")
        let firstToken = try XCTUnwrap(elements(first).first?["token"] as? String)
        let tokenVisibility = try call(store, action: "eval", request: [
            "js": "document.documentElement.outerHTML.includes(\(String(reflecting: firstToken)))",
        ])
        XCTAssertEqual(tokenVisibility["result"] as? String, "0")

        let controlled = try element(named: "Controlled value", tag: "input", in: first)
        let input = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(first["snapshotID"] as? String),
            "element_token": try XCTUnwrap(controlled["token"] as? String),
            "text": "CONTROLLED_TEXT",
        ])
        XCTAssertEqual(input["ok"] as? Bool, true)
        let tracker = try call(store, action: "eval", request: [
            "js": "window.ownSetterCalls + '|' + document.getElementById('controlled').value",
        ])
        XCTAssertEqual(tracker["result"] as? String, "0|CONTROLLED_TEXT")

        let button = try element(named: "Tamper proof action", in: input)
        let clicked = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(input["snapshotID"] as? String),
            "element_token": try XCTUnwrap(button["token"] as? String),
        ])
        XCTAssertEqual(clicked["ok"] as? Bool, true)
    }

    func testStrictEnvelopeBudgetDoesNotLetHugeEarlyCandidateStarveLaterElements() throws {
        let store = WebViewStore()
        let huge = String(repeating: "😀", count: 15_000)
        let hugeOption = String(repeating: "选", count: 2_000)
        let html = """
        <title>Strict envelope fixture</title>
        <button aria-label="\(huge)">Huge first</button>
        <button>Later usable target</button>
        <label for="bounded">Bounded select</label>
        <select id="bounded"><option value="long">\(hugeOption)</option></select>
        """
        try loadHTML(html, in: store, expectedTitle: "Strict envelope fixture")
        _ = try call(store, action: "eval", request: [
            "js": "document.title='" + huge + "'; history.replaceState({}, '', '/' + 'u'.repeat(12000)); true",
        ])
        let observed = try call(store, action: "observe", request: ["scope": "page"])
        XCTAssertLessThanOrEqual(try serialized(observed).utf16.count, 20_000)
        XCTAssertLessThanOrEqual((observed["title"] as? String ?? "").utf16.count, 512)
        XCTAssertLessThanOrEqual((observed["url"] as? String ?? "").utf16.count, 4_096)
        XCTAssertNotNil(try? element(named: "Later usable target", in: observed))

        let select = try element(named: "Bounded select", tag: "select", in: observed)
        let selected = try call(store, action: "select", request: [
            "snapshot_id": try XCTUnwrap(observed["snapshotID"] as? String),
            "element_token": try XCTUnwrap(select["token"] as? String),
            "option": hugeOption,
        ])
        XCTAssertLessThanOrEqual(try serialized(selected).utf16.count, 20_000)
        XCTAssertLessThanOrEqual(((selected["action"] as? [String: Any])?["selected"] as? String ?? "").utf16.count, 256)
    }

    func testFoundationSerializationBudgetHandlesEscapesAndPreservesLaterTarget() throws {
        let store = WebViewStore()
        let escaped = String(repeating: #"/\"#, count: 260)
        let buttons = (0..<80).map {
            "<button aria-label='\(escaped) early \($0)'>Early \($0)</button>"
        }.joined()
        let option = String(repeating: "/", count: 2_000)
        let html = """
        <title>Foundation budget fixture</title>
        <style>button,select { display:block; width:500px; height:30px }</style>
        <label for="slash-select">Slash select</label>
        <select id="slash-select"><option value="slash">\(option)</option></select>
        \(buttons)
        <button>Later compact target</button>
        """
        try loadHTML(html, in: store, expectedTitle: "Foundation budget fixture")
        _ = try call(store, action: "eval", request: [
            "js": "document.title = String.fromCharCode(1).repeat(500); history.replaceState({}, '', '/' + '/'.repeat(9000)); true",
        ])

        let observed = try call(store, action: "observe", request: ["scope": "page"])
        XCTAssertEqual(observed["ok"] as? Bool, true)
        XCTAssertEqual(observed["truncated"] as? Bool, true)
        XCTAssertLessThanOrEqual(try foundationUTF16Length(observed), 20_000)
        XCTAssertEqual(
            WebViewStore.foundationSerializedUTF16Length(observed),
            try foundationUTF16Length(observed)
        )
        XCTAssertNotNil(try? element(named: "Later compact target", in: observed))

        let select = try element(named: "Slash select", tag: "select", in: observed)
        let selected = try call(store, action: "select", request: [
            "snapshot_id": try XCTUnwrap(observed["snapshotID"] as? String),
            "element_token": try XCTUnwrap(select["token"] as? String),
            "option": option,
        ])
        XCTAssertEqual(selected["ok"] as? Bool, true)
        XCTAssertLessThanOrEqual(try foundationUTF16Length(selected), 20_000)
    }

    func testRedactionCapacityFailsClosedBeforeWriting() throws {
        let store = WebViewStore()
        try loadHTML(
            "<title>Redaction cap fixture</title><label for='field'>Cap field</label><input id='field'>",
            in: store,
            expectedTitle: "Redaction cap fixture"
        )
        let observed = try call(store, action: "observe")
        let field = try element(named: "Cap field", tag: "input", in: observed)
        let result = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(observed["snapshotID"] as? String),
            "element_token": try XCTUnwrap(field["token"] as? String),
            "text": String(repeating: "Z", count: 5_000),
        ])
        XCTAssertEqual(result["code"] as? String, "browser_redaction_capacity_exceeded")
        let value = try call(store, action: "eval", request: ["js": "document.getElementById('field').value"])
        XCTAssertEqual(value["result"] as? String, "")
        let later = try call(store, action: "observe")
        XCTAssertEqual(later["code"] as? String, "browser_redaction_capacity_exceeded")
    }

    func testNavigateReturnsObservationAndHighlightExpires() throws {
        let store = WebViewStore()
        let html = "<title>Navigated fixture</title><button id='go'>Go</button>"
        let encoded = try XCTUnwrap(html.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed))
        let navigated = try call(store, action: "navigate", request: [
            "url": "data:text/html,\(encoded)",
        ])
        XCTAssertEqual(navigated["ok"] as? Bool, true)
        XCTAssertEqual(navigated["title"] as? String, "Navigated fixture")
        XCTAssertNotNil(navigated["snapshotID"] as? String)

        let content = try call(store, action: "content", request: ["mode": "text"])
        XCTAssertEqual(content["ok"] as? Bool, true)
        XCTAssertTrue((content["content"] as? String ?? "").contains("Go"))
        let screenshot = try call(store, action: "screenshot")
        XCTAssertEqual(screenshot["ok"] as? Bool, true)
        XCTAssertEqual(screenshot["mimeType"] as? String, "image/png")
        XCTAssertGreaterThan((screenshot["base64"] as? String ?? "").count, 100)

        let button = try element(named: "Go", tag: "button", in: navigated)
        let clicked = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(navigated["snapshotID"] as? String),
            "element_token": try XCTUnwrap(button["token"] as? String),
        ])
        XCTAssertEqual(clicked["ok"] as? Bool, true)
        let during = try call(store, action: "eval", request: [
            "js": "document.querySelector('[data-pipiui-browser-highlight]') !== null",
        ])
        XCTAssertEqual(during["result"] as? String, "1")
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        let after = try call(store, action: "eval", request: [
            "js": "document.querySelector('[data-pipiui-browser-highlight]') !== null",
        ])
        XCTAssertEqual(after["result"] as? String, "0")
    }

    func testTypedLinkAndFormNavigationReturnOneDestinationObservation() throws {
        let source = #"""
        <title>Navigation source</title>
        <style>a,button { display:block; width:320px; height:40px }</style>
        <a href="pipiui-test://fixture/link-destination">Open link destination</a>
        <form action="pipiui-test://fixture/form-destination" method="get">
          <button type="submit">Submit destination form</button>
        </form>
        """#
        let handler = BrowserFixtureSchemeHandler(pages: [
            "/source": source,
            "/link-destination": "<title>Link destination</title><h1>Arrived by link</h1>",
            "/form-destination": "<title>Form destination</title><h1>Arrived by form</h1>",
        ])
        let store = WebViewStore(testSchemeHandler: handler)

        let first = try call(store, action: "navigate", request: ["url": "pipiui-test://fixture/source"])
        let link = try element(named: "Open link destination", in: first)
        let linked = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(first["snapshotID"] as? String),
            "element_token": try XCTUnwrap(link["token"] as? String),
        ])
        XCTAssertEqual(linked["ok"] as? Bool, true)
        XCTAssertEqual(linked["title"] as? String, "Link destination")
        XCTAssertTrue(elements(linked).contains { $0["name"] as? String == "Arrived by link" })
        XCTAssertEqual((linked["action"] as? [String: Any])?["kind"] as? String, "click")

        let second = try call(store, action: "navigate", request: ["url": "pipiui-test://fixture/source"])
        let submit = try element(named: "Submit destination form", tag: "button", in: second)
        let submitted = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(second["snapshotID"] as? String),
            "element_token": try XCTUnwrap(submit["token"] as? String),
        ])
        XCTAssertEqual(submitted["ok"] as? Bool, true)
        XCTAssertEqual(submitted["title"] as? String, "Form destination")
        XCTAssertTrue(elements(submitted).contains { $0["name"] as? String == "Arrived by form" })
    }

    func testSameOriginIframeClickObservesDestinationAndCancellationRespondsOnce() throws {
        let handler = BrowserFixtureSchemeHandler(pages: [
            "/frame-host": #"""
                <title>Frame host</title>
                <style>iframe { display:block; width:500px; height:180px }</style>
                <iframe src="pipiui-test://fixture/frame-source"></iframe>
                """#,
            "/frame-source": "<a href='pipiui-test://fixture/frame-destination'>Navigate frame</a>",
            "/frame-destination": "<button>Frame destination action</button>",
            "/cancel-source": "<a href='pipiui-test://fixture/slow'>Open slow destination</a>",
        ])
        let store = WebViewStore(testSchemeHandler: handler)
        let host = try call(store, action: "navigate", request: ["url": "pipiui-test://fixture/frame-host"])
        let frameLink = try element(named: "Navigate frame", in: host)
        XCTAssertTrue((frameLink["frame"] as? String ?? "").contains("iframe"))
        let frameResult = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(host["snapshotID"] as? String),
            "element_token": try XCTUnwrap(frameLink["token"] as? String),
        ])
        XCTAssertEqual(frameResult["ok"] as? Bool, true)
        XCTAssertTrue(elements(frameResult).contains { $0["name"] as? String == "Frame destination action" })
        XCTAssertFalse(elements(frameResult).contains { $0["name"] as? String == "Navigate frame" })

        let cancelSource = try call(store, action: "navigate", request: ["url": "pipiui-test://fixture/cancel-source"])
        let slowLink = try element(named: "Open slow destination", in: cancelSource)
        let requestID = UUID().uuidString
        let once = expectation(description: "typed navigation cancellation responds once")
        var responses: [[String: Any]] = []
        store.handle(action: "click", request: J([
            "requestID": requestID,
            "snapshot_id": try XCTUnwrap(cancelSource["snapshotID"] as? String),
            "element_token": try XCTUnwrap(slowLink["token"] as? String),
        ])) { response in
            responses.append(response)
            if responses.count == 1 { once.fulfill() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            store.cancelRequest(requestID: requestID, reason: "test typed navigation cancellation")
        }
        wait(for: [once], timeout: 2)
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        XCTAssertEqual(responses.count, 1)
        XCTAssertEqual(responses.first?["code"] as? String, "request_cancelled")
        XCTAssertEqual(store.browserActivity, .idle)
    }

    func testSlowIframeNavigationWaitsForPreCommitAndPostCommitCompletionExactlyOnce() throws {
        let handler = BrowserFixtureSchemeHandler(
            pages: [
                "/pre-host": "<title>Pre host</title><iframe style='width:500px;height:180px' src='pipiui-test://fixture/pre-source'></iframe>",
                "/pre-source": "<a href='pipiui-test://fixture/pre-destination'>Slow precommit frame link</a>",
                "/pre-destination": "<button>Precommit destination arrived</button>",
                "/post-host": "<title>Post host</title><iframe style='width:500px;height:180px' src='pipiui-test://fixture/post-source'></iframe>",
                "/post-source": "<a href='pipiui-test://fixture/post-destination'>Slow postcommit frame link</a>",
                "/post-destination": "<button>Postcommit destination arrived</button>",
            ],
            preCommitDelays: ["/pre-destination": 1.3],
            completionDelays: ["/post-destination": 1.3]
        )
        let store = WebViewStore(testSchemeHandler: handler)

        func clickAndCount(
            hostURL: String,
            linkName: String,
            destinationName: String
        ) throws {
            let host = try call(store, action: "navigate", request: ["url": hostURL])
            let link = try element(named: linkName, in: host)
            let requestID = UUID().uuidString
            let responseExpectation = expectation(description: destinationName)
            var responses: [[String: Any]] = []
            let started = Date()
            var responseElapsed: TimeInterval?
            store.handle(action: "click", request: J([
                "requestID": requestID,
                "snapshot_id": try XCTUnwrap(host["snapshotID"] as? String),
                "element_token": try XCTUnwrap(link["token"] as? String),
            ])) { response in
                responses.append(response)
                if responses.count == 1 {
                    responseElapsed = Date().timeIntervalSince(started)
                    responseExpectation.fulfill()
                }
            }
            wait(for: [responseExpectation], timeout: 5)
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(responseElapsed), 1.2)
            XCTAssertEqual(responses.count, 1)
            let response = try XCTUnwrap(responses.first)
            XCTAssertEqual(response["ok"] as? Bool, true, "\(response)")
            XCTAssertTrue(elements(response).contains { $0["name"] as? String == destinationName })
            XCTAssertFalse(elements(response).contains { $0["name"] as? String == linkName })
        }

        try clickAndCount(
            hostURL: "pipiui-test://fixture/pre-host",
            linkName: "Slow precommit frame link",
            destinationName: "Precommit destination arrived"
        )
        try clickAndCount(
            hostURL: "pipiui-test://fixture/post-host",
            linkName: "Slow postcommit frame link",
            destinationName: "Postcommit destination arrived"
        )
    }

    func testIframeCancelledLinkAndFormsReturnFreshObservationExactlyOnce() throws {
        let frameSource = #"""
        <style>a,button,input { display:block; width:340px; height:36px }</style>
        <a id="spa" href="pipiui-test://fixture/should-not-load">Prevented iframe link</a>
        <form id="invalid" action="pipiui-test://fixture/should-not-load">
          <input required aria-label="Required form value">
          <button id="invalidSubmit" type="submit">Invalid iframe form</button>
        </form>
        <form id="cancelled" action="pipiui-test://fixture/should-not-load">
          <input required value="ready" aria-label="Valid form value">
          <button type="submit">Cancelled iframe form</button>
        </form>
        <div id="updates"></div>
        <script>
          function addUpdate(text) {
            const button = document.createElement('button');
            button.textContent = text;
            updates.appendChild(button);
          }
          document.body.addEventListener('click', event => {
            if (event.target === spa) {
              event.preventDefault();
              addUpdate('Prevented link DOM update');
            }
          });
          invalidSubmit.addEventListener('click', () => addUpdate('Invalid form DOM update'));
          cancelled.addEventListener('submit', event => {
            event.preventDefault();
            addUpdate('Cancelled form DOM update');
          });
        </script>
        """#
        let handler = BrowserFixtureSchemeHandler(pages: [
            "/cancelled-host": "<title>Cancelled host</title><iframe style='width:600px;height:420px' src='pipiui-test://fixture/cancelled-source'></iframe>",
            "/cancelled-source": frameSource,
        ])
        let store = WebViewStore(testSchemeHandler: handler)

        func clickExactlyOnce(
            observation: [String: Any],
            targetName: String,
            targetTag: String,
            expectedUpdate: String
        ) throws -> [String: Any] {
            let target = try element(named: targetName, tag: targetTag, in: observation)
            let requestID = UUID().uuidString
            let done = expectation(description: expectedUpdate)
            var responses: [[String: Any]] = []
            store.handle(action: "click", request: J([
                "requestID": requestID,
                "snapshot_id": try XCTUnwrap(observation["snapshotID"] as? String),
                "element_token": try XCTUnwrap(target["token"] as? String),
                "scope": "page",
            ])) { response in
                responses.append(response)
                if responses.count == 1 { done.fulfill() }
            }
            wait(for: [done], timeout: 2)
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
            XCTAssertEqual(responses.count, 1)
            let response = try XCTUnwrap(responses.first)
            XCTAssertEqual(response["ok"] as? Bool, true, "\(response)")
            XCTAssertTrue(
                elements(response).contains { $0["name"] as? String == expectedUpdate },
                "\(expectedUpdate): \(elements(response).compactMap { $0["name"] as? String })"
            )
            XCTAssertEqual(store.browserActivity, .idle)
            return response
        }

        let host = try call(store, action: "navigate", request: [
            "url": "pipiui-test://fixture/cancelled-host",
            "scope": "page",
        ])
        let afterLink = try clickExactlyOnce(
            observation: host,
            targetName: "Prevented iframe link",
            targetTag: "a",
            expectedUpdate: "Prevented link DOM update"
        )
        let afterInvalid = try clickExactlyOnce(
            observation: afterLink,
            targetName: "Invalid iframe form",
            targetTag: "button",
            expectedUpdate: "Invalid form DOM update"
        )
        _ = try clickExactlyOnce(
            observation: afterInvalid,
            targetName: "Cancelled iframe form",
            targetTag: "button",
            expectedUpdate: "Cancelled form DOM update"
        )
    }

    func testIframeFailurePollCancellationAndShortTimeoutAreTerminalExactlyOnce() throws {
        let failureHandler = BrowserFixtureSchemeHandler(pages: [
            "/failure-host": "<title>Failure host</title><iframe style='width:600px;height:180px' src='pipiui-test://fixture/failure-source'></iframe>",
            "/failure-source": #"""
                <a id="failure" href="pipiui-test://fixture/slow">Failing iframe link</a>
                <script>
                  failure.addEventListener('click', () => setTimeout(() => {
                    window.frameElement.dispatchEvent(new Event('error'));
                  }, 250));
                </script>
                """#,
        ])
        let failureStore = WebViewStore(testSchemeHandler: failureHandler)
        let failureHost = try call(failureStore, action: "navigate", request: [
            "url": "pipiui-test://fixture/failure-host",
        ])
        let failureLink = try element(named: "Failing iframe link", in: failureHost)
        let failureDone = expectation(description: "iframe failure terminal")
        var failureResponses: [[String: Any]] = []
        let failureStarted = Date()
        failureStore.handle(action: "click", request: J([
            "requestID": UUID().uuidString,
            "snapshot_id": try XCTUnwrap(failureHost["snapshotID"] as? String),
            "element_token": try XCTUnwrap(failureLink["token"] as? String),
        ])) { response in
            failureResponses.append(response)
            if failureResponses.count == 1 { failureDone.fulfill() }
        }
        wait(for: [failureDone], timeout: 3)
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        XCTAssertEqual(failureResponses.count, 1)
        XCTAssertEqual(failureResponses.first?["code"] as? String, "browser_iframe_navigation_failed")
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(failureStarted), 0.2)
        XCTAssertFalse(try serialized(try XCTUnwrap(failureResponses.first)).contains("Failing iframe link"))
        XCTAssertEqual(failureStore.browserActivity, .idle)

        func pendingStore(timeout: TimeInterval = 20) throws -> (WebViewStore, [String: Any], [String: Any]) {
            let handler = BrowserFixtureSchemeHandler(pages: [
                "/pending-host": "<title>Pending host</title><iframe style='width:600px;height:180px' src='pipiui-test://fixture/pending-source'></iframe>",
                "/pending-source": "<a href='pipiui-test://fixture/slow'>Pending iframe link</a>",
            ])
            let store = WebViewStore(testSchemeHandler: handler, frameNavigationTimeout: timeout)
            let host = try call(store, action: "navigate", request: ["url": "pipiui-test://fixture/pending-host"])
            return (store, host, try element(named: "Pending iframe link", in: host))
        }

        let (cancelStore, cancelHost, cancelLink) = try pendingStore()
        let cancelID = UUID().uuidString
        let cancelDone = expectation(description: "active iframe polling cancellation")
        var cancelResponses: [[String: Any]] = []
        cancelStore.handle(action: "click", request: J([
            "requestID": cancelID,
            "snapshot_id": try XCTUnwrap(cancelHost["snapshotID"] as? String),
            "element_token": try XCTUnwrap(cancelLink["token"] as? String),
        ])) { response in
            cancelResponses.append(response)
            if cancelResponses.count == 1 { cancelDone.fulfill() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            cancelStore.cancelRequest(requestID: cancelID, reason: "cancel active iframe poll")
        }
        wait(for: [cancelDone], timeout: 2)
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        XCTAssertEqual(cancelResponses.count, 1)
        XCTAssertEqual(cancelResponses.first?["code"] as? String, "request_cancelled")
        XCTAssertEqual(cancelStore.browserActivity, .idle)

        let (timeoutStore, timeoutHost, timeoutLink) = try pendingStore(timeout: 0.35)
        let timeoutDone = expectation(description: "short iframe timeout")
        var timeoutResponses: [[String: Any]] = []
        let timeoutStarted = Date()
        timeoutStore.handle(action: "click", request: J([
            "requestID": UUID().uuidString,
            "snapshot_id": try XCTUnwrap(timeoutHost["snapshotID"] as? String),
            "element_token": try XCTUnwrap(timeoutLink["token"] as? String),
        ])) { response in
            timeoutResponses.append(response)
            if timeoutResponses.count == 1 { timeoutDone.fulfill() }
        }
        wait(for: [timeoutDone], timeout: 2)
        let timeoutElapsed = Date().timeIntervalSince(timeoutStarted)
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        XCTAssertGreaterThanOrEqual(timeoutElapsed, 0.30)
        XCTAssertLessThan(timeoutElapsed, 1.5)
        XCTAssertEqual(timeoutResponses.count, 1)
        XCTAssertEqual(timeoutResponses.first?["code"] as? String, "browser_navigation_timeout")
        XCTAssertFalse(try serialized(try XCTUnwrap(timeoutResponses.first)).contains("Pending iframe link"))
        XCTAssertEqual(timeoutStore.browserActivity, .idle)
    }

    func testIframeNavigationToCrossOriginReturnsExplicitFallback() throws {
        let handler = BrowserFixtureSchemeHandler(pages: [
            "/cross-host": "<title>Cross host</title><iframe style='width:500px;height:180px' src='pipiui-test://fixture/cross-source'></iframe>",
            "/cross-source": "<a href='pipiui-test://other/cross-destination'>Cross-origin frame link</a>",
            "/cross-destination": "<button>Inaccessible destination</button>",
        ])
        let store = WebViewStore(testSchemeHandler: handler)
        let host = try call(store, action: "navigate", request: ["url": "pipiui-test://fixture/cross-host"])
        let link = try element(named: "Cross-origin frame link", in: host)
        let result = try call(store, action: "click", request: [
            "snapshot_id": try XCTUnwrap(host["snapshotID"] as? String),
            "element_token": try XCTUnwrap(link["token"] as? String),
        ])
        XCTAssertEqual(result["ok"] as? Bool, false)
        XCTAssertEqual(result["code"] as? String, "browser_iframe_content_unavailable")
        let limitations = result["limitations"] as? [String] ?? []
        XCTAssertTrue(limitations.contains { $0.contains("screenshot or Computer Use") })
        XCTAssertFalse(try serialized(result).contains("Inaccessible destination"))
    }

    func testIframeInputSelectAndTargetedScrollAreCommitted() throws {
        let store = WebViewStore()
        let frameHTML = #"""
        <label for='frame-input'>Frame input</label><input id='frame-input'>
        <label for='frame-select'>Frame select</label>
        <select id='frame-select'><option value='a'>Alpha</option><option value='b'>Beta</option></select>
        <div id='frame-scroll' tabindex='0' aria-label='Frame scroll region' style='width:300px;height:80px;overflow:auto'>
          <div style='height:700px'>Tall frame contents</div>
        </div>
        """#
        let escapedFrame = frameHTML
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <title>Iframe actions fixture</title>
        <iframe style="width:600px;height:300px" srcdoc="\(escapedFrame)"></iframe>
        """
        try loadHTML(html, in: store, expectedTitle: "Iframe actions fixture")
        let observed = try call(store, action: "observe", request: ["scope": "page"])
        let input = try element(named: "Frame input", tag: "input", in: observed)
        XCTAssertTrue((input["frame"] as? String ?? "").contains("iframe"))
        let inputResult = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(observed["snapshotID"] as? String),
            "element_token": try XCTUnwrap(input["token"] as? String),
            "text": "FRAME_TYPED_TEXT",
        ])
        XCTAssertEqual(inputResult["ok"] as? Bool, true)

        let select = try element(named: "Frame select", tag: "select", in: inputResult)
        let selectResult = try call(store, action: "select", request: [
            "snapshot_id": try XCTUnwrap(inputResult["snapshotID"] as? String),
            "element_token": try XCTUnwrap(select["token"] as? String),
            "option": "Beta",
        ])
        XCTAssertEqual(selectResult["ok"] as? Bool, true)

        let scroll = try element(named: "Frame scroll region", tag: "div", in: selectResult)
        let scrollResult = try call(store, action: "scroll", request: [
            "snapshot_id": try XCTUnwrap(selectResult["snapshotID"] as? String),
            "element_token": try XCTUnwrap(scroll["token"] as? String),
            "direction": "down",
            "amount": 0.5,
        ])
        XCTAssertEqual(scrollResult["ok"] as? Bool, true)

        let values = try call(store, action: "eval", request: [
            "js": "(() => { const d=document.querySelector('iframe').contentDocument; return [d.getElementById('frame-input').value,d.getElementById('frame-select').value,d.getElementById('frame-scroll').scrollTop].join('|'); })()",
        ])
        let parts = (values["result"] as? String ?? "").split(separator: "|")
        XCTAssertEqual(parts.first, "FRAME_TYPED_TEXT")
        XCTAssertEqual(parts.dropFirst().first, "b")
        XCTAssertGreaterThan(Int(parts.last ?? "0") ?? 0, 0)
    }

    func testWaitSelectorAppearsAfterDelayAndReturnsObservation() throws {
        let html = #"""
        <!doctype html>
        <html><head><meta charset="utf-8"><title>Wait selector fixture</title></head>
        <body>
          <h1>Waiting room</h1>
          <script>
            setTimeout(() => {
              const button = document.createElement('button');
              button.id = 'late-button';
              button.textContent = 'Late button';
              document.body.appendChild(button);
            }, 350);
          </script>
        </body></html>
        """#
        let store = WebViewStore()
        try loadHTML(html, in: store, expectedTitle: "Wait selector fixture")

        let started = Date()
        let waited = try call(store, action: "wait", request: [
            "mode": "selector",
            "selector": "#late-button",
            "timeout": 3,
        ], timeout: 5)
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(waited["ok"] as? Bool, true, "\(waited)")
        XCTAssertGreaterThanOrEqual(elapsed, 0.30)
        XCTAssertEqual((waited["action"] as? [String: Any])?["kind"] as? String, "wait")
        XCTAssertEqual((waited["action"] as? [String: Any])?["mode"] as? String, "selector")
        XCTAssertTrue(elements(waited).contains { $0["name"] as? String == "Late button" })
        XCTAssertNotNil(waited["snapshotID"] as? String)
    }

    func testWaitSelectorTimeoutReturnsStructuredError() throws {
        let html = #"""
        <!doctype html>
        <html><head><meta charset="utf-8"><title>Wait timeout fixture</title></head>
        <body><h1>Nothing arrives</h1></body></html>
        """#
        let store = WebViewStore()
        try loadHTML(html, in: store, expectedTitle: "Wait timeout fixture")

        let started = Date()
        let timedOut = try call(store, action: "wait", request: [
            "mode": "selector",
            "selector": "#never-appears",
            "timeout": 0.35,
        ], timeout: 3)
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(timedOut["ok"] as? Bool, false, "\(timedOut)")
        XCTAssertEqual(timedOut["code"] as? String, "browser_wait_timeout")
        XCTAssertEqual(timedOut["requiresObservation"] as? Bool, true)
        XCTAssertEqual(timedOut["mode"] as? String, "selector")
        XCTAssertGreaterThanOrEqual(elapsed, 0.30)
        XCTAssertEqual(store.browserActivity, .idle)
    }

    func testWaitNetworkIdleSettlesAfterSlowResource() throws {
        final class WaitResourceSchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
            func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
                guard let url = urlSchemeTask.request.url else {
                    urlSchemeTask.didFailWithError(URLError(.badURL))
                    return
                }
                if url.path == "/page" {
                    let html = """
                    <!doctype html>
                    <html><head><meta charset="utf-8"><title>Idle wait fixture</title></head>
                    <body>
                      <h1>Idle host</h1>
                      <button id="ready-control">Ready control</button>
                      <img id="slow" src="pipiui-test://fixture/slow.png" width="10" height="10">
                    </body></html>
                    """
                    let data = Data(html.utf8)
                    let response = URLResponse(
                        url: url,
                        mimeType: "text/html",
                        expectedContentLength: data.count,
                        textEncodingName: "utf-8"
                    )
                    urlSchemeTask.didReceive(response)
                    urlSchemeTask.didReceive(data)
                    urlSchemeTask.didFinish()
                    return
                }
                if url.path == "/slow.png" {
                    // 1x1 PNG
                    let png = Data(base64Encoded:
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
                    )!
                    let response = URLResponse(
                        url: url,
                        mimeType: "image/png",
                        expectedContentLength: png.count,
                        textEncodingName: nil
                    )
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                        urlSchemeTask.didReceive(response)
                        urlSchemeTask.didReceive(png)
                        urlSchemeTask.didFinish()
                    }
                    return
                }
                urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            }

            func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
        }

        let handler = WaitResourceSchemeHandler()
        let store = WebViewStore(testSchemeHandler: handler)

        let navigated = try call(
            store,
            action: "navigate",
            request: ["url": "pipiui-test://fixture/page"],
            timeout: 5
        )
        XCTAssertEqual(navigated["ok"] as? Bool, true, "\(navigated)")
        XCTAssertEqual(navigated["title"] as? String, "Idle wait fixture")
        XCTAssertTrue(elements(navigated).contains { $0["name"] as? String == "Ready control" })

        // Explicit idle wait on an already-settled page should return quickly with observation.
        let started = Date()
        let idle = try call(store, action: "wait", request: [
            "mode": "idle",
            "idle_ms": 200,
            "timeout": 3,
        ], timeout: 4)
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(idle["ok"] as? Bool, true, "\(idle)")
        XCTAssertEqual((idle["action"] as? [String: Any])?["kind"] as? String, "wait")
        XCTAssertEqual((idle["action"] as? [String: Any])?["mode"] as? String, "idle")
        XCTAssertLessThan(elapsed, 1.5)
        XCTAssertNotNil(idle["snapshotID"] as? String)
    }

    func testWaitIdleTimeoutWhenResourcesNeverQuiet() throws {
        final class ForeverBusySchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
            func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
                guard let url = urlSchemeTask.request.url else {
                    urlSchemeTask.didFailWithError(URLError(.badURL))
                    return
                }
                if url.path == "/busy" {
                    let html = """
                    <!doctype html>
                    <html><head><meta charset="utf-8"><title>Busy idle fixture</title></head>
                    <body><h1>Idle host</h1><div id="mount"></div></body></html>
                    """
                    let data = Data(html.utf8)
                    let response = URLResponse(
                        url: url,
                        mimeType: "text/html",
                        expectedContentLength: data.count,
                        textEncodingName: "utf-8"
                    )
                    urlSchemeTask.didReceive(response)
                    urlSchemeTask.didReceive(data)
                    urlSchemeTask.didFinish()
                    return
                }
                if url.path == "/hang.png" {
                    // Intentionally remain pending so document.images stay incomplete.
                    return
                }
                urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            }

            func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
        }

        let store = WebViewStore(testSchemeHandler: ForeverBusySchemeHandler())
        let page = try call(
            store,
            action: "navigate",
            request: ["url": "pipiui-test://fixture/busy"],
            timeout: 5
        )
        XCTAssertEqual(page["ok"] as? Bool, true, "\(page)")

        // Attach the hanging image after navigation settles so didFinish is not blocked.
        let attached = try call(store, action: "eval", request: [
            "js": """
            (() => {
              const img = document.createElement('img');
              img.id = 'hang';
              img.width = 10;
              img.height = 10;
              img.src = 'pipiui-test://fixture/hang.png';
              document.getElementById('mount').appendChild(img);
              return String(!img.complete);
            })()
            """,
        ])
        XCTAssertEqual(attached["result"] as? String, "true", "hanging image fixture must stay incomplete")
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))

        let timedOut = try call(store, action: "wait", request: [
            "mode": "idle",
            "idle_ms": 200,
            "timeout": 0.4,
        ], timeout: 3)
        XCTAssertEqual(timedOut["ok"] as? Bool, false, "\(timedOut)")
        XCTAssertEqual(timedOut["code"] as? String, "browser_wait_timeout")
        XCTAssertEqual(timedOut["requiresObservation"] as? Bool, true)
        XCTAssertEqual(timedOut["mode"] as? String, "idle")
    }

    func testWaitInvalidArgumentsAndCancellation() throws {
        let store = WebViewStore()
        try loadHTML(
            "<!doctype html><html><head><title>Wait args</title></head><body><button id='x'>X</button></body></html>",
            in: store,
            expectedTitle: "Wait args"
        )

        let invalid = try call(store, action: "wait", request: [
            "mode": "selector",
            "timeout": 1,
        ])
        XCTAssertEqual(invalid["ok"] as? Bool, false)
        XCTAssertEqual(invalid["code"] as? String, "invalid_browser_wait")

        let requestID = UUID().uuidString
        let once = expectation(description: "wait cancellation responds once")
        var responses: [[String: Any]] = []
        store.handle(action: "wait", request: J([
            "requestID": requestID,
            "mode": "selector",
            "selector": "#never",
            "timeout": 5,
        ])) { response in
            responses.append(response)
            if responses.count == 1 { once.fulfill() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            store.cancelRequest(requestID: requestID, reason: "test wait cancellation")
        }
        wait(for: [once], timeout: 2)
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        XCTAssertEqual(responses.count, 1)
        XCTAssertEqual(responses.first?["code"] as? String, "request_cancelled")
        XCTAssertEqual(responses.first?["retryable"] as? Bool, true)
        XCTAssertEqual(store.browserActivity, .idle)
    }

    func testObservationURLRedactsSensitiveQueryParameters() throws {
        let handler = BrowserFixtureSchemeHandler(pages: [
            "/secret-page": """
            <!doctype html>
            <html><head><meta charset="utf-8"><title>Secret query fixture</title></head>
            <body>
              <h1>Query redaction</h1>
              <label for="bare-pass">Account password recovery</label>
              <input id="bare-pass" name="user_password" placeholder="password recovery">
              <input id="upload" type="file" aria-label="Upload document">
            </body></html>
            """,
        ])
        let store = WebViewStore(testSchemeHandler: handler)
        let secret = "SECRET_RESET_TOKEN_VALUE_9f3a"
        let observed = try call(store, action: "navigate", request: [
            "url": "pipiui-test://fixture/secret-page?reset_token=\(secret)&ok=1&api_key=ANOTHER_SECRET",
        ], timeout: 5)
        XCTAssertEqual(observed["ok"] as? Bool, true, "\(observed)")
        let url = try XCTUnwrap(observed["url"] as? String)
        XCTAssertFalse(url.contains(secret), "reset_token value must not appear in observation URL: \(url)")
        XCTAssertFalse(url.contains("ANOTHER_SECRET"), "api_key value must not appear: \(url)")
        XCTAssertTrue(url.contains("reset_token=%5Bredacted%5D") || url.contains("reset_token=[redacted]"), url)
        XCTAssertTrue(url.contains("api_key=%5Bredacted%5D") || url.contains("api_key=[redacted]"), url)
        XCTAssertTrue(url.contains("ok=1"), "non-sensitive params must remain: \(url)")

        let encoded = try serialized(observed)
        XCTAssertFalse(encoded.contains(secret))
        XCTAssertFalse(encoded.contains("ANOTHER_SECRET"))

        let limitations = observed["limitations"] as? [String] ?? []
        XCTAssertTrue(limitations.contains { $0.contains("js_dialogs_not_handled") })
        XCTAssertTrue(limitations.contains { $0.contains("file_input") })

        // Bare password keyword in name/label/placeholder → sensitive handoff path.
        let bare = try element(named: "Account password recovery", tag: "input", in: observed)
        XCTAssertEqual(bare["valueHint"] as? String, "sensitive value hidden")
        let handoff = try call(store, action: "input", request: [
            "snapshot_id": try XCTUnwrap(observed["snapshotID"] as? String),
            "element_token": try XCTUnwrap(bare["token"] as? String),
            "text": "should-not-type",
        ])
        XCTAssertEqual(handoff["ok"] as? Bool, false)
        XCTAssertEqual(handoff["code"] as? String, "user_handoff_required")
    }
}
