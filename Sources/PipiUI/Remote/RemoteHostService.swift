import Foundation

enum LocalRemoteHostState: Equatable {
    case starting
    case listening(loopbackURL: URL, lanURL: URL?)
    case failed(String)
    case stopped
}

/// Authenticates and adapts the deliberately local raw HTTP listener. Command
/// execution stays in RemoteHostController so Relay never weakens local policy.
final class RemoteHostService {
    private let controller: RemoteHostController
    private let token = BridgeCapabilityToken.generate()
    private let nonce = BridgeCapabilityToken.generate(byteCount: 18)
    private var server: LocalRemoteHTTPServer?
    private let stateChanged: (LocalRemoteHostState) -> Void
    private let accessMode: LocalRemoteAccessMode
    private var port: UInt16 = 0

    init?(
        controller: RemoteHostController,
        accessMode: LocalRemoteAccessMode = .loopbackOnly,
        stateChanged: @escaping (LocalRemoteHostState) -> Void
    ) {
        self.controller = controller
        self.accessMode = accessMode
        self.stateChanged = stateChanged
        stateChanged(.starting)
        guard let server = LocalRemoteHTTPServer(
            accessMode: accessMode,
            handler: { [weak self] request, respond in
                DispatchQueue.main.async {
                    self?.handle(request, respond: respond)
                }
            },
            onReady: { [weak self] port in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.port = port
                    let loopbackURL = URL(string: "http://127.0.0.1:\(port)/")!
                    let lanURL: URL?
                    if case .trustedLAN(let address, let pairingSecret) = self.accessMode {
                        var components = URLComponents()
                        components.scheme = "http"
                        components.host = address
                        components.port = Int(port)
                        components.path = "/"
                        components.queryItems = [
                            URLQueryItem(name: "pair", value: pairingSecret),
                        ]
                        lanURL = components.url
                    } else {
                        lanURL = nil
                    }
                    self.stateChanged(.listening(loopbackURL: loopbackURL, lanURL: lanURL))
                }
            },
            onFailure: { [weak self] message in
                DispatchQueue.main.async {
                    self?.stateChanged(.failed(message))
                }
            }
        ) else {
            stateChanged(.failed("无法创建本地网页 listener"))
            return nil
        }
        self.server = server
    }

    func stop() {
        server?.stop()
        server = nil
        port = 0
        stateChanged(.stopped)
    }

    private func handle(
        _ request: LocalRemoteHTTPRequest,
        respond: @escaping (LocalRemoteHTTPResponse) -> Void
    ) {
        guard port != 0 else {
            respond(.json(status: 503, ["error": "listener is not ready"]))
            return
        }
        if let error = LocalRemoteRequestPolicy.authorizationError(
            for: request,
            expectedToken: token,
            port: port,
            accessMode: accessMode
        ) {
            respond(error)
            return
        }
        if let routeRejection = LocalRemoteRoutes.rejection(for: request) {
            respond(routeRejection)
            return
        }

        let routePath = LocalRemoteRequestPolicy.routePath(for: request.path)
        if request.method == "GET", routePath == "/" {
            respond(webPage())
            return
        }
        guard let command = RemoteRelayCommand.localHTTPCommand(
            method: request.method,
            path: routePath
        ) else {
            respond(.json(status: 404, ["error": "route not found"]))
            return
        }
        controller.handle(RemoteCommandRequest(
            command: command,
            body: request.body,
            deadline: Date().addingTimeInterval(LocalRemoteRequestLimits.requestTimeout)
        )) { response in
            respond(LocalRemoteHTTPResponse(
                status: response.status,
                contentType: response.contentType,
                headers: response.headers,
                body: response.body
            ))
        }
    }

    private func webPage() -> LocalRemoteHTTPResponse {
        let csp = [
            "default-src 'none'",
            "script-src 'nonce-\(nonce)'",
            "style-src 'nonce-\(nonce)'",
            "connect-src 'self'",
            "img-src 'none'",
            "font-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'none'",
        ].joined(separator: "; ")
        return LocalRemoteHTTPResponse(
            status: 200,
            contentType: "text/html; charset=utf-8",
            headers: [
                "Content-Security-Policy": csp,
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
            ],
            body: LocalRemoteWebPage.render(token: token, nonce: nonce)
        )
    }
}
