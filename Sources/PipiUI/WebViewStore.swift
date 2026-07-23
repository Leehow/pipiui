import Foundation
import WebKit
import AppKit

/// Per-session embedded browser: wraps a WKWebView, captures console output,
/// and executes bridge commands from the pi webview extension. Main thread only.
final class WebViewStore: NSObject, ObservableObject {
    let webView: WKWebView
    @Published var urlString = ""
    @Published var title = ""
    @Published var isLoading = false

    private var consoleLogs: [String] = []
    /// Pending bridge respond for the in-flight navigate/reload. Invoked exactly once.
    private var navCompletion: (([String: Any]) -> Void)?
    private var navTimeout: DispatchWorkItem?
    /// Bumped on every `awaitNavigation`. Timeout / settle paths capture it so a stale
    /// callback cannot complete a newer pending respond.
    private var navGeneration: UInt64 = 0
    /// The `WKNavigation` produced by the load/reload we are waiting on (identity match).
    private var pendingWKNavigation: WKNavigation?

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

    override init() {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: Self.consoleScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        config.userContentController = controller
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: config)
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
        webView.load(URLRequest(url: url))
        return true
    }

    // MARK: - Bridge commands (invoked on main thread)

    func handle(action: String, request: J, respond: @escaping ([String: Any]) -> Void) {
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
            awaitNavigation(respond: respond)
            let nav = webView.load(URLRequest(url: resolved))
            bindPendingNavigation(nav)
            if nav == nil {
                completeNavigation(["ok": false, "error": "failed to start load"])
            }
        case "reload":
            awaitNavigation(respond: respond)
            let nav = webView.reload()
            bindPendingNavigation(nav)
            if nav == nil {
                completeNavigation(["ok": false, "error": "failed to start reload"])
            }
        case "back":
            webView.goBack()
            respond(["ok": true])
        case "forward":
            webView.goForward()
            respond(["ok": true])
        case "eval":
            guard let js = request["js"].string else {
                respond(["ok": false, "error": "missing js"])
                return
            }
            webView.evaluateJavaScript(js) { result, error in
                if let error {
                    respond(["ok": false, "error": Self.describeJSError(error)])
                } else {
                    respond(["ok": true, "result": Self.stringify(result)])
                }
            }
        case "content":
            let mode = request["mode"].string ?? "text"
            let js = mode == "html"
                ? "document.documentElement.outerHTML"
                : "document.body ? document.body.innerText : ''"
            webView.evaluateJavaScript(js) { result, error in
                if let error {
                    respond(["ok": false, "error": Self.describeJSError(error)])
                } else {
                    var text = (result as? String) ?? ""
                    var truncated = false
                    if text.count > 100_000 {
                        text = String(text.prefix(100_000))
                        truncated = true
                    }
                    respond(["ok": true, "content": text, "truncated": truncated])
                }
            }
        case "console":
            let logs = consoleLogs
            if request["clear"].bool == true { consoleLogs = [] }
            respond(["ok": true, "logs": logs])
        case "screenshot":
            let config = WKSnapshotConfiguration()
            config.snapshotWidth = 1024
            webView.takeSnapshot(with: config) { image, error in
                guard let image,
                      let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    respond(["ok": false, "error": error?.localizedDescription ?? "snapshot failed (面板可能未显示)"])
                    return
                }
                respond(["ok": true, "base64": png.base64EncodedString(), "mimeType": "image/png"])
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

    /// Fail any in-flight navigation wait so its bridge client is not left hanging.
    private func cancelPendingNavigation(reason: String) {
        completeNavigation(["ok": false, "error": reason])
    }

    /// Deliver at most one response for the current pending navigation (success, failure, timeout, or supersede).
    private func completeNavigation(_ response: [String: Any]) {
        navTimeout?.cancel()
        navTimeout = nil
        pendingWKNavigation = nil
        guard let respond = navCompletion else { return }
        navCompletion = nil
        respond(response)
    }

    /// Like `completeNavigation`, but no-ops when `generation` is no longer current
    /// (stale timeout or late WK callback after supersede).
    private func completeNavigation(ifGeneration generation: UInt64, _ response: [String: Any]) {
        guard generation == navGeneration else { return }
        completeNavigation(response)
    }

    /// Whether a WK callback's navigation object is the one we are waiting on.
    /// Requires a bound `pendingWKNavigation` and identity match — never settle on a
    /// guess (stale didFinish from a prior about:blank must not complete a new pending).
    private func isCurrentNavigation(_ navigation: WKNavigation?) -> Bool {
        guard navCompletion != nil else { return false }
        guard let pending = pendingWKNavigation, let navigation else { return false }
        return navigation === pending
    }

    private static func isURLCancelled(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled
    }

    /// Register a pending navigation; respond when didFinish/didFail fires or after timeout.
    /// If a previous navigate/reload is still waiting, it is failed first (never dropped).
    private func awaitNavigation(respond: @escaping ([String: Any]) -> Void) {
        cancelPendingNavigation(reason: "superseded by newer navigation")
        navGeneration += 1
        let generation = navGeneration
        pendingWKNavigation = nil
        navCompletion = respond
        let timeout = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.completeNavigation(ifGeneration: generation, [
                "ok": true,
                "url": self.webView.url?.absoluteString ?? "",
                "title": self.webView.title ?? "",
                "note": "load did not finish within 20s (page may still be loading)",
            ])
        }
        navTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
    }

    private func finishPendingNavigationSuccess(ifGeneration generation: UInt64) {
        completeNavigation(ifGeneration: generation, [
            "ok": true,
            "url": webView.url?.absoluteString ?? "",
            "title": webView.title ?? "",
        ])
    }

    /// Bind the WKNavigation returned by `load`/`reload` so late callbacks from a
    /// superseded load cannot settle the new pending respond.
    private func bindPendingNavigation(_ navigation: WKNavigation?) {
        pendingWKNavigation = navigation
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
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        urlString = webView.url?.absoluteString ?? urlString
        title = webView.title ?? ""
        // Ignore finishes for a superseded load (identity + generation).
        guard isCurrentNavigation(navigation) else { return }
        finishPendingNavigationSuccess(ifGeneration: navGeneration)
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
    /// not complete the *new* pending with ok:true; real failures report ok:false.
    fileprivate func settleNavigationFailure(navigation: WKNavigation?, error: Error) {
        // Stale callback for a navigation we are no longer waiting on.
        guard isCurrentNavigation(navigation) else { return }
        let generation = navGeneration
        // NSURLErrorCancelled means this load was replaced/stopped — not success.
        // After supersede the old load's cancel is already filtered by isCurrentNavigation;
        // if the *current* load is cancelled, fail the pending respond once.
        if Self.isURLCancelled(error) {
            completeNavigation(ifGeneration: generation, [
                "ok": false,
                "error": error.localizedDescription,
            ])
            return
        }
        completeNavigation(ifGeneration: generation, [
            "ok": false,
            "error": error.localizedDescription,
        ])
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
