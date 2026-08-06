import Foundation
import WebKit
import AppKit

enum BrowserActivity: String {
    case idle
    case observing
    case acting

    var label: String {
        switch self {
        case .idle: ""
        case .observing: "正在观察"
        case .acting: "正在操作"
        }
    }
}

enum BrowserDOMControllerResource {
    static let contentWorldName = "PipiUIBrowserDOM"

    static func bundledURL(bundle: Bundle = PipiResourceBundle.shared) -> URL? {
        bundle.url(forResource: "Resources", withExtension: nil)?
            .appendingPathComponent("BrowserDOM", isDirectory: true)
            .appendingPathComponent("controller.js")
    }

    static func bundledSource(bundle: Bundle = PipiResourceBundle.shared) throws -> String {
        guard let url = bundledURL(bundle: bundle) else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}

/// Per-session embedded browser: wraps a WKWebView, captures console output,
/// and executes bridge commands from the pi webview extension. Main thread only.
final class WebViewStore: NSObject, ObservableObject {
    let webView: WKWebView
    @Published var urlString = ""
    @Published var title = ""
    @Published var isLoading = false
    @Published private(set) var browserActivity: BrowserActivity = .idle

    private var consoleLogs: [String] = []
    private var requestGeneration: UInt64 = 0
    private var activeRequestID: String?
    private var activeRespond: (([String: Any]) -> Void)?
    private var activeIsNavigation = false
    private var navTimeout: DispatchWorkItem?
    private var actionGrace: DispatchWorkItem?
    private var pendingWKNavigation: WKNavigation?
    private var pendingNavigationScope = "viewport"
    private var pendingActionMetadata: [String: Any]?
    private var pendingTypedClick = false
    private var pendingFrameNavigationDeadline: Date?
    private let frameNavigationTimeout: TimeInterval
    private let browserDOMSourceAvailable: Bool

    private static let productionFrameNavigationTimeout: TimeInterval = 20
    private static let productionFrameNavigationTimeoutNote = "iframe navigation timed out after 20s"
    /// Quiet window after the latest completed resource/navigation timing entry.
    private static let productionNetworkIdleQuietMs: Double = 400
    /// Cap extra wait after didFinish so idle settle cannot stall ordinary navigations.
    private static let productionNavigationIdleMaxSeconds: TimeInterval = 2.5
    private static let defaultWaitTimeoutSeconds: TimeInterval = 10
    private static let maxWaitTimeoutSeconds: TimeInterval = 30

    private static let browserDOMWorld = WKContentWorld.world(name: BrowserDOMControllerResource.contentWorldName)

    private static let consoleScript = """
    (function () {
      function send(level, args) {
        try {
          var text = args.map(function (a) {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (e) { return String(a); }
          }).join(' ');
          window.webkit.messageHandlers.pipiConsole.postMessage({ level: level, text: text });
        } catch (e) {}
      }
      ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
        var original = console[level];
        console[level] = function () {
          send(level, Array.prototype.slice.call(arguments));
          return original.apply(console, arguments);
        };
      });
      window.addEventListener('error', function (e) {
        send('error', [e.message + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?')]);
      });
      window.addEventListener('unhandledrejection', function (e) {
        send('error', ['Unhandled promise rejection: ' + e.reason]);
      });
    })();
    """

    override convenience init() {
        self.init(testSchemeHandler: nil)
    }

    /// Test-only scheme and frame-timeout injection keep navigation fixtures deterministic
    /// without changing the production 20-second boundary or public browser interface.
    init(
        testSchemeHandler: WKURLSchemeHandler?,
        frameNavigationTimeout: TimeInterval = WebViewStore.productionFrameNavigationTimeout
    ) {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: Self.consoleScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        let browserDOMSource = try? BrowserDOMControllerResource.bundledSource()
        if let browserDOMSource {
            controller.addUserScript(WKUserScript(
                source: browserDOMSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: Self.browserDOMWorld
            ))
        }
        config.userContentController = controller
        if let testSchemeHandler {
            config.setURLSchemeHandler(testSchemeHandler, forURLScheme: "pipiui-test")
        }
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: config)
        self.frameNavigationTimeout = max(0.05, frameNavigationTimeout)
        browserDOMSourceAvailable = browserDOMSource != nil
        super.init()
        controller.add(WeakScriptHandler(self), name: "pipiConsole")
        webView.navigationDelegate = self
    }

    // MARK: - UI actions

    /// Normalize user/bridge input into a loadable URL. Returns nil when the string cannot form a URL.
    func resolvedURL(from input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // Keep scheme-bearing URLs as-is (about:blank, http://..., file://...).
        // Only bare hosts get an http(s) prefix — prepending to about:blank yields nil.
        if let url = URL(string: trimmed), url.scheme != nil {
            return url
        }
        let isLocal = trimmed.hasPrefix("localhost") || trimmed.hasPrefix("127.0.0.1") || trimmed.hasPrefix("0.0.0.0")
        let urlText = (isLocal ? "http://" : "https://") + trimmed
        return URL(string: urlText)
    }

    @discardableResult
    func navigate(_ input: String) -> Bool {
        guard let url = resolvedURL(from: input) else { return false }
        cancelActiveRequest(reason: "superseded by browser panel navigation", stopLoading: true)
        clearBrowserDOMState(preservingRedactions: true)
        webView.load(URLRequest(url: url))
        return true
    }

    // MARK: - Bridge commands (invoked on main thread)

    func handle(action: String, request: J, respond: @escaping ([String: Any]) -> Void) {
        let requestID = request["requestID"].string ?? UUID().uuidString
        switch action {
        case "navigate":
            guard let url = request["url"].string, !url.isEmpty else {
                respond(["ok": false, "error": "missing url"])
                return
            }
            guard let resolved = resolvedURL(from: url) else {
                respond(["ok": false, "error": "invalid url"])
                return
            }
            let generation = beginRequest(
                requestID: requestID,
                activity: .acting,
                navigation: true,
                respond: respond
            )
            pendingNavigationScope = normalizedScope(request["scope"].string)
            clearBrowserDOMState(preservingRedactions: true)
            let nav = webView.load(URLRequest(url: resolved))
            pendingWKNavigation = nav
            if nav == nil {
                completeRequest(ifGeneration: generation, ["ok": false, "error": "failed to start load"])
            } else {
                scheduleNavigationTimeout(generation: generation)
            }
        case "reload":
            let generation = beginRequest(
                requestID: requestID,
                activity: .acting,
                navigation: true,
                respond: respond
            )
            pendingNavigationScope = normalizedScope(request["scope"].string)
            clearBrowserDOMState(preservingRedactions: true)
            let nav = webView.reload()
            pendingWKNavigation = nav
            if nav == nil {
                completeRequest(ifGeneration: generation, ["ok": false, "error": "failed to start reload"])
            } else {
                scheduleNavigationTimeout(generation: generation)
            }
        case "back":
            clearBrowserDOMState(preservingRedactions: true)
            webView.goBack()
            respond(["ok": true])
        case "forward":
            clearBrowserDOMState(preservingRedactions: true)
            webView.goForward()
            respond(["ok": true])
        case "observe":
            let generation = beginRequest(
                requestID: requestID,
                activity: .observing,
                navigation: false,
                respond: respond
            )
            evaluateBrowserDOM(
                ["action": "observe", "scope": normalizedScope(request["scope"].string)]
            ) { [weak self] response in
                self?.completeRequest(ifGeneration: generation, response)
            }
        case "wait":
            let generation = beginRequest(
                requestID: requestID,
                activity: .observing,
                navigation: false,
                respond: respond
            )
            let scope = normalizedScope(request["scope"].string)
            let selector = request["selector"].string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let hasSelector = !selector.isEmpty
            let hasIndex = request["element_index"].int != nil
            let hasToken = !(request["element_token"].string ?? "").isEmpty
            let hasElementTarget = hasIndex || hasToken || !(request["snapshot_id"].string ?? "").isEmpty
            let requestedMode = (request["mode"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let mode: String
            if requestedMode == "idle" || requestedMode == "selector" {
                mode = requestedMode
            } else if hasSelector || hasElementTarget {
                mode = "selector"
            } else if requestedMode.isEmpty {
                mode = "idle"
            } else {
                completeRequest(ifGeneration: generation, [
                    "ok": false,
                    "error": "wait mode must be 'selector' or 'idle'",
                    "code": "invalid_browser_wait",
                ])
                return
            }
            if mode == "selector", !hasSelector, !hasElementTarget {
                completeRequest(ifGeneration: generation, [
                    "ok": false,
                    "error": "wait selector mode requires selector or a snapshot element target",
                    "code": "invalid_browser_wait",
                ])
                return
            }
            if mode == "selector", hasSelector, hasElementTarget {
                completeRequest(ifGeneration: generation, [
                    "ok": false,
                    "error": "wait selector mode accepts selector or a snapshot element target, not both",
                    "code": "invalid_browser_wait",
                ])
                return
            }
            let timeoutSeconds = Self.clampedWaitTimeout(request["timeout"].double)
            let idleMs = Self.clampedIdleQuietMs(request["idle_ms"].double)
            var payload: [String: Any] = [
                "action": "wait_check",
                "mode": mode,
                "scope": scope,
                "idle_ms": idleMs,
            ]
            if hasSelector { payload["selector"] = selector }
            if let snapshotID = request["snapshot_id"].string { payload["snapshot_id"] = snapshotID }
            if let token = request["element_token"].string { payload["element_token"] = token }
            if let index = request["element_index"].int { payload["element_index"] = index }
            scheduleWaitPoll(
                generation: generation,
                payload: payload,
                scope: scope,
                mode: mode,
                deadline: Date().addingTimeInterval(timeoutSeconds)
            )
        case "click", "input", "select", "scroll":
            let generation = beginRequest(
                requestID: requestID,
                activity: .acting,
                navigation: false,
                respond: respond
            )
            if action == "click" {
                pendingTypedClick = true
                pendingNavigationScope = normalizedScope(request["scope"].string)
                pendingActionMetadata = ["kind": "click"]
            }
            var payload: [String: Any] = [
                "action": action,
                "scope": normalizedScope(request["scope"].string),
            ]
            for key in ["snapshot_id", "element_token", "text", "option", "direction"] {
                if let value = request[key].string { payload[key] = value }
            }
            if let value = request["element_index"].int { payload["element_index"] = value }
            if let value = request["amount"].double { payload["amount"] = value }
            evaluateBrowserDOM(payload) { [weak self] response in
                guard let self, generation == self.requestGeneration, self.activeRespond != nil else { return }
                if action == "click", response["ok"] as? Bool == true,
                   response["deferObservation"] as? Bool == true {
                    if self.activeIsNavigation { return }
                    let targetFrame = response["targetFrame"] as? String ?? "main"
                    self.scheduleActionObservation(
                        generation: generation,
                        scope: self.pendingNavigationScope,
                        iframeTarget: targetFrame != "main",
                        iframeNavigationBearing: response["navigationBearing"] as? Bool == true
                    )
                } else if action == "click", self.activeIsNavigation {
                    // A main-frame navigation may replace the JS world before its click
                    // callback returns. The adopted WKNavigation owns the single response.
                    return
                } else {
                    self.completeRequest(ifGeneration: generation, response)
                }
            }
        case "eval":
            guard let js = request["js"].string else {
                respond(["ok": false, "error": "missing js"])
                return
            }
            let generation = beginRequest(
                requestID: requestID,
                activity: .acting,
                navigation: false,
                respond: respond
            )
            webView.evaluateJavaScript(js) { [weak self] result, error in
                if let error {
                    self?.completeRequest(ifGeneration: generation, ["ok": false, "error": Self.describeJSError(error)])
                } else {
                    self?.completeRequest(ifGeneration: generation, ["ok": true, "result": Self.stringify(result)])
                }
            }
        case "content":
            let generation = beginRequest(
                requestID: requestID,
                activity: .observing,
                navigation: false,
                respond: respond
            )
            let mode = request["mode"].string ?? "text"
            let js = mode == "html"
                ? "document.documentElement.outerHTML"
                : "document.body ? document.body.innerText : ''"
            webView.evaluateJavaScript(js) { [weak self] result, error in
                if let error {
                    self?.completeRequest(ifGeneration: generation, ["ok": false, "error": Self.describeJSError(error)])
                } else {
                    var text = (result as? String) ?? ""
                    var truncated = false
                    if text.count > 100_000 {
                        text = String(text.prefix(100_000))
                        truncated = true
                    }
                    self?.completeRequest(ifGeneration: generation, ["ok": true, "content": text, "truncated": truncated])
                }
            }
        case "console":
            let logs = consoleLogs
            if request["clear"].bool == true { consoleLogs = [] }
            respond(["ok": true, "logs": logs])
        case "screenshot":
            let generation = beginRequest(
                requestID: requestID,
                activity: .observing,
                navigation: false,
                respond: respond
            )
            let config = WKSnapshotConfiguration()
            config.snapshotWidth = 1024
            webView.takeSnapshot(with: config) { [weak self] image, error in
                guard let image,
                      let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    self?.completeRequest(ifGeneration: generation, ["ok": false, "error": error?.localizedDescription ?? "snapshot failed (面板可能未显示)"])
                    return
                }
                self?.completeRequest(ifGeneration: generation, ["ok": true, "base64": png.base64EncodedString(), "mimeType": "image/png"])
            }
        case "info":
            respond([
                "ok": true,
                "url": webView.url?.absoluteString ?? "",
                "title": webView.title ?? "",
                "loading": webView.isLoading,
            ])
        default:
            respond(["ok": false, "error": "unknown action: \(action)"])
        }
    }

    func cancelRequest(requestID: String, reason: String = "browser request cancelled") {
        guard !requestID.isEmpty, activeRequestID == requestID else { return }
        cancelActiveRequest(reason: reason, stopLoading: activeIsNavigation)
    }

    private func normalizedScope(_ scope: String?) -> String {
        scope == "page" ? "page" : "viewport"
    }

    private static func clampedWaitTimeout(_ raw: Double?) -> TimeInterval {
        let value = raw ?? defaultWaitTimeoutSeconds
        return min(max(value, 0.05), maxWaitTimeoutSeconds)
    }

    private static func clampedIdleQuietMs(_ raw: Double?) -> Double {
        let value = raw ?? productionNetworkIdleQuietMs
        return min(max(value, 50), 5_000)
    }

    @discardableResult
    private func beginRequest(
        requestID: String,
        activity: BrowserActivity,
        navigation: Bool,
        respond: @escaping ([String: Any]) -> Void
    ) -> UInt64 {
        cancelActiveRequest(reason: "superseded by newer browser request", stopLoading: activeIsNavigation)
        requestGeneration &+= 1
        activeRequestID = requestID
        activeRespond = respond
        activeIsNavigation = navigation
        browserActivity = activity
        return requestGeneration
    }

    private func completeRequest(ifGeneration generation: UInt64, _ response: [String: Any]) {
        guard generation == requestGeneration, let respond = activeRespond else { return }
        navTimeout?.cancel()
        navTimeout = nil
        actionGrace?.cancel()
        actionGrace = nil
        pendingWKNavigation = nil
        pendingActionMetadata = nil
        pendingTypedClick = false
        pendingFrameNavigationDeadline = nil
        activeRespond = nil
        activeRequestID = nil
        activeIsNavigation = false
        browserActivity = .idle
        respond(Self.boundedStructuredBrowserResponse(response))
    }

    private func cancelActiveRequest(reason: String, stopLoading: Bool) {
        guard let respond = activeRespond else {
            browserActivity = .idle
            return
        }
        requestGeneration &+= 1
        if stopLoading { webView.stopLoading() }
        navTimeout?.cancel()
        navTimeout = nil
        actionGrace?.cancel()
        actionGrace = nil
        pendingWKNavigation = nil
        pendingActionMetadata = nil
        pendingTypedClick = false
        pendingFrameNavigationDeadline = nil
        activeRespond = nil
        activeRequestID = nil
        activeIsNavigation = false
        browserActivity = .idle
        clearBrowserDOMState(preservingRedactions: true)
        respond([
            "ok": false,
            "error": reason,
            "code": "request_cancelled",
            "requiresObservation": true,
        ])
    }

    private func scheduleNavigationTimeout(generation: UInt64) {
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, generation == self.requestGeneration else { return }
            self.finishNavigationWithObservation(
                generation: generation,
                note: "load did not finish within 20s (page may still be loading)"
            )
        }
        navTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
    }

    private func scheduleActionObservation(
        generation: UInt64,
        scope: String,
        iframeTarget: Bool,
        iframeNavigationBearing: Bool
    ) {
        if iframeTarget, iframeNavigationBearing {
            pendingFrameNavigationDeadline = Date().addingTimeInterval(frameNavigationTimeout)
            scheduleFrameNavigationPoll(generation: generation, scope: scope, delay: 0.05)
            return
        }
        actionGrace?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  generation == self.requestGeneration,
                  self.activeRespond != nil,
                  !self.activeIsNavigation else { return }
            let action = iframeTarget ? "finalize_click" : "observe"
            self.evaluateBrowserDOM([
                "action": action,
                "scope": scope,
                "action_metadata": self.pendingActionMetadata ?? ["kind": "click"],
            ]) { [weak self] response in
                self?.completeRequest(ifGeneration: generation, response)
            }
        }
        actionGrace = work
        let delay: TimeInterval = iframeTarget ? 0.10 : 0.25
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func scheduleFrameNavigationPoll(
        generation: UInt64,
        scope: String,
        delay: TimeInterval
    ) {
        actionGrace?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  generation == self.requestGeneration,
                  self.activeRespond != nil,
                  !self.activeIsNavigation else { return }
            guard let deadline = self.pendingFrameNavigationDeadline, Date() < deadline else {
                self.clearBrowserDOMState(preservingRedactions: true)
                let productionTimeout = self.frameNavigationTimeout == Self.productionFrameNavigationTimeout
                self.completeRequest(ifGeneration: generation, [
                    "ok": false,
                    "error": productionTimeout
                        ? "iframe navigation did not finish within 20s"
                        : "iframe navigation did not finish before the configured test timeout",
                    "code": "browser_navigation_timeout",
                    "requiresObservation": true,
                    "note": productionTimeout
                        ? Self.productionFrameNavigationTimeoutNote
                        : "iframe navigation timed out after the configured test interval",
                ])
                return
            }
            self.evaluateBrowserDOM([
                "action": "finalize_click",
                "scope": scope,
                "action_metadata": self.pendingActionMetadata ?? ["kind": "click"],
            ]) { [weak self] response in
                guard let self,
                      generation == self.requestGeneration,
                      self.activeRespond != nil else { return }
                if response["ok"] as? Bool == true,
                   response["pendingFrameNavigation"] as? Bool == true {
                    self.scheduleFrameNavigationPoll(generation: generation, scope: scope, delay: 0.05)
                } else {
                    self.completeRequest(ifGeneration: generation, response)
                }
            }
        }
        actionGrace = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func finishNavigationWithObservation(generation: UInt64, note: String? = nil) {
        var payload: [String: Any] = ["action": "observe", "scope": pendingNavigationScope]
        if let pendingActionMetadata { payload["action_metadata"] = pendingActionMetadata }
        evaluateBrowserDOM(payload) { [weak self] response in
            var result = response
            if let note { result["note"] = note }
            self?.completeRequest(ifGeneration: generation, result)
        }
    }

    /// After didFinish, wait briefly for resource timing to go quiet before observing.
    /// Soft-cap keeps static pages fast; never fails navigate solely for missing idle.
    private func finishNavigationAfterNetworkIdle(generation: UInt64) {
        let deadline = Date().addingTimeInterval(Self.productionNavigationIdleMaxSeconds)
        scheduleNavigationIdlePoll(generation: generation, deadline: deadline, delay: 0)
    }

    private func scheduleNavigationIdlePoll(
        generation: UInt64,
        deadline: Date,
        delay: TimeInterval
    ) {
        actionGrace?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  generation == self.requestGeneration,
                  self.activeRespond != nil,
                  self.activeIsNavigation else { return }
            if Date() >= deadline {
                self.finishNavigationWithObservation(generation: generation)
                return
            }
            self.evaluateBrowserDOM([
                "action": "wait_check",
                "mode": "idle",
                "idle_ms": Self.productionNetworkIdleQuietMs,
            ]) { [weak self] response in
                guard let self,
                      generation == self.requestGeneration,
                      self.activeRespond != nil,
                      self.activeIsNavigation else { return }
                if response["ok"] as? Bool == true, response["ready"] as? Bool == true {
                    self.finishNavigationWithObservation(generation: generation)
                    return
                }
                if Date() >= deadline {
                    self.finishNavigationWithObservation(generation: generation)
                    return
                }
                self.scheduleNavigationIdlePoll(generation: generation, deadline: deadline, delay: 0.05)
            }
        }
        actionGrace = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func scheduleWaitPoll(
        generation: UInt64,
        payload: [String: Any],
        scope: String,
        mode: String,
        deadline: Date,
        delay: TimeInterval = 0
    ) {
        actionGrace?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  generation == self.requestGeneration,
                  self.activeRespond != nil,
                  !self.activeIsNavigation else { return }
            if Date() >= deadline {
                self.completeRequest(ifGeneration: generation, [
                    "ok": false,
                    "error": mode == "idle"
                        ? "network idle was not reached before timeout"
                        : "wait condition was not met before timeout",
                    "code": "browser_wait_timeout",
                    "requiresObservation": true,
                    "mode": mode,
                ])
                return
            }
            self.evaluateBrowserDOM(payload) { [weak self] response in
                guard let self,
                      generation == self.requestGeneration,
                      self.activeRespond != nil else { return }
                if response["ok"] as? Bool != true {
                    self.completeRequest(ifGeneration: generation, response)
                    return
                }
                if response["ready"] as? Bool == true {
                    var observePayload: [String: Any] = [
                        "action": "observe",
                        "scope": scope,
                        "action_metadata": [
                            "kind": "wait",
                            "mode": mode,
                        ],
                    ]
                    if let selector = payload["selector"] as? String {
                        var metadata = observePayload["action_metadata"] as? [String: Any] ?? [:]
                        metadata["selector"] = selector
                        observePayload["action_metadata"] = metadata
                    }
                    self.evaluateBrowserDOM(observePayload) { [weak self] observation in
                        self?.completeRequest(ifGeneration: generation, observation)
                    }
                    return
                }
                if Date() >= deadline {
                    self.completeRequest(ifGeneration: generation, [
                        "ok": false,
                        "error": mode == "idle"
                            ? "network idle was not reached before timeout"
                            : "wait condition was not met before timeout",
                        "code": "browser_wait_timeout",
                        "requiresObservation": true,
                        "mode": mode,
                    ])
                    return
                }
                self.scheduleWaitPoll(
                    generation: generation,
                    payload: payload,
                    scope: scope,
                    mode: mode,
                    deadline: deadline,
                    delay: 0.05
                )
            }
        }
        actionGrace = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    static func foundationSerializedUTF16Length(_ value: [String: Any]) -> Int? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let string = String(data: data, encoding: .utf8) else { return nil }
        return string.utf16.count
    }

    /// Apply the public structured-browser budget with the exact Foundation serializer
    /// used by BridgeServer. Removing the largest element first preserves later small,
    /// actionable entries instead of letting slash-heavy early entries starve them.
    static func boundedStructuredBrowserResponse(_ response: [String: Any]) -> [String: Any] {
        let isStructured = response["snapshotID"] != nil
            || response["observation"] != nil
            || response["deferObservation"] != nil
            || response["pendingFrameNavigation"] != nil
        guard isStructured else { return response }

        var result = response
        func length() -> Int { foundationSerializedUTF16Length(result) ?? .max }
        func serializedSize(_ value: Any) -> Int {
            guard JSONSerialization.isValidJSONObject(value),
                  let data = try? JSONSerialization.data(withJSONObject: value),
                  let string = String(data: data, encoding: .utf8) else { return .max }
            return string.utf16.count
        }

        while length() > 20_000 {
            var topElements = result["elements"] as? [[String: Any]] ?? []
            var nested = result["observation"] as? [String: Any]
            var nestedElements = nested?["elements"] as? [[String: Any]] ?? []

            let topLargest = topElements.enumerated().max {
                serializedSize($0.element) < serializedSize($1.element)
            }
            let nestedLargest = nestedElements.enumerated().max {
                serializedSize($0.element) < serializedSize($1.element)
            }
            let topSize = topLargest.map { serializedSize($0.element) } ?? -1
            let nestedSize = nestedLargest.map { serializedSize($0.element) } ?? -1
            if topSize >= 0 || nestedSize >= 0 {
                if topSize >= nestedSize, let index = topLargest?.offset {
                    topElements.remove(at: index)
                    result["elements"] = topElements
                    result["truncated"] = true
                } else if let index = nestedLargest?.offset {
                    nestedElements.remove(at: index)
                    nested?["elements"] = nestedElements
                    nested?["truncated"] = true
                    result["observation"] = nested
                }
                continue
            }

            var topLimitations = result["limitations"] as? [String] ?? []
            var nestedLimitations = nested?["limitations"] as? [String] ?? []
            if !topLimitations.isEmpty {
                topLimitations.removeLast()
                result["limitations"] = topLimitations
                result["truncated"] = true
                continue
            }
            if !nestedLimitations.isEmpty {
                nestedLimitations.removeLast()
                nested?["limitations"] = nestedLimitations
                nested?["truncated"] = true
                result["observation"] = nested
                continue
            }

            return [
                "ok": false,
                "error": "browser response exceeded the Foundation serialization budget",
                "code": "browser_output_truncated",
                "requiresObservation": true,
                "truncated": true,
            ]
        }
        return result
    }

    private func evaluateBrowserDOM(
        _ payload: [String: Any],
        completion: @escaping ([String: Any]) -> Void
    ) {
        guard browserDOMSourceAvailable else {
            completion([
                "ok": false,
                "error": "structured browser controller resource is unavailable",
                "code": "browser_controller_unavailable",
            ])
            return
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            completion(["ok": false, "error": "invalid browser controller request"])
            return
        }
        let js = "globalThis.__pipiBrowserDOM ? globalThis.__pipiBrowserDOM.dispatch(\(json)) : null"
        webView.evaluateJavaScript(js, in: nil, in: Self.browserDOMWorld) { result in
            switch result {
            case .success(let value):
                if let response = value as? [String: Any] {
                    completion(response)
                } else {
                    completion([
                        "ok": false,
                        "error": "structured browser controller did not initialize",
                        "code": "browser_controller_unavailable",
                    ])
                }
            case .failure(let error):
                completion(["ok": false, "error": Self.describeJSError(error)])
            }
        }
    }

    private func clearBrowserDOMState(preservingRedactions: Bool = false) {
        guard browserDOMSourceAvailable else { return }
        let action = preservingRedactions ? "invalidate" : "clear"
        let js = "globalThis.__pipiBrowserDOM?.dispatch({action:'\(action)'})"
        webView.evaluateJavaScript(js, in: nil, in: Self.browserDOMWorld) { _ in }
    }

    /// Whether a WK callback's navigation object is the one we are waiting on.
    private func isCurrentNavigation(_ navigation: WKNavigation?) -> Bool {
        guard activeRespond != nil, activeIsNavigation else { return false }
        guard let pending = pendingWKNavigation, let navigation else { return false }
        return navigation === pending
    }

    private static func isURLCancelled(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled
    }

    private static func stringify(_ value: Any?) -> String {
        guard let value else { return "undefined" }
        if let s = value as? String { return s }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value),
           let s = String(data: data, encoding: .utf8) {
            return s
        }
        return "\(value)"
    }

    private static func describeJSError(_ error: Error) -> String {
        let ns = error as NSError
        if let message = ns.userInfo["WKJavaScriptExceptionMessage"] as? String {
            return "JavaScript exception: \(message)"
        }
        return ns.localizedDescription
    }
}

extension WebViewStore: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
        if activeRespond != nil, pendingTypedClick, !activeIsNavigation {
            actionGrace?.cancel()
            actionGrace = nil
            activeIsNavigation = true
            pendingWKNavigation = navigation
            scheduleNavigationTimeout(generation: requestGeneration)
            clearBrowserDOMState(preservingRedactions: true)
            return
        }
        let replacedPendingNavigation = activeIsNavigation
            && pendingWKNavigation != nil
            && pendingWKNavigation !== navigation
        if activeRespond != nil,
           !activeIsNavigation || replacedPendingNavigation {
            cancelActiveRequest(
                reason: "page navigation invalidated the active browser request",
                stopLoading: false
            )
        }
        clearBrowserDOMState(preservingRedactions: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        urlString = webView.url?.absoluteString ?? urlString
        title = webView.title ?? ""
        guard isCurrentNavigation(navigation) else { return }
        finishNavigationAfterNetworkIdle(generation: requestGeneration)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        isLoading = false
        settleNavigationFailure(navigation: navigation, error: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        isLoading = false
        consoleLogs.append("[navigation-error] \(error.localizedDescription)")
        settleNavigationFailure(navigation: navigation, error: error)
    }

    /// Settle or ignore a WK failure callback. Cancelled (-999) from a superseded load must
    /// not complete the newer pending request.
    fileprivate func settleNavigationFailure(navigation: WKNavigation?, error: Error) {
        guard isCurrentNavigation(navigation) else { return }
        let message = Self.isURLCancelled(error) ? "navigation cancelled" : error.localizedDescription
        completeRequest(ifGeneration: requestGeneration, ["ok": false, "error": message])
    }
}

extension WebViewStore: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pipiConsole",
              let body = message.body as? [String: Any],
              let level = body["level"] as? String,
              let text = body["text"] as? String else { return }
        consoleLogs.append("[\(level)] \(text)")
        if consoleLogs.count > 500 {
            consoleLogs.removeFirst(consoleLogs.count - 500)
        }
    }
}

/// WKUserContentController retains its handler strongly; break the cycle.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
