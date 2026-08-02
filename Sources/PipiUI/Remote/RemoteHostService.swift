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
    private let controller: RemoteHostController?
    private let token = BridgeCapabilityToken.generate()
    private let nonce = BridgeCapabilityToken.generate(byteCount: 18)
    private var server: LocalRemoteHTTPServer?
    private let stateChanged: (LocalRemoteHostState) -> Void
    private let accessMode: LocalRemoteAccessMode
    private var port: UInt16 = 0
    private weak var peerTransport: RemotePeerTransport?

    init?(
        controller: RemoteHostController?,
        accessMode: LocalRemoteAccessMode = .loopbackOnly,
        peerTransport: RemotePeerTransport? = nil,
        stateChanged: @escaping (LocalRemoteHostState) -> Void
    ) {
        self.controller = controller
        self.accessMode = accessMode
        self.peerTransport = peerTransport
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

    func setPeerTransport(_ peerTransport: RemotePeerTransport?) {
        self.peerTransport = peerTransport
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
        if routePath.hasPrefix("/p2p-test/") {
            handlePeerTest(request, routePath: routePath, respond: respond)
            return
        }
        guard let controller else {
            respond(.json(status: 503, ["error": "remote controller is unavailable"]))
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

    private func handlePeerTest(
        _ request: LocalRemoteHTTPRequest,
        routePath: String,
        respond: @escaping (LocalRemoteHTTPResponse) -> Void
    ) {
        guard let peerTransport else {
            respond(.json(status: 503, ["error": "WKWebView peer test is disabled"]))
            return
        }
        switch (request.method, routePath) {
        case ("GET", "/p2p-test/"):
            respond(peerTestPage())

        case ("GET", "/p2p-test/config"):
            do {
                respond(try encodedPeerJSON(peerTransport.makeTestSession(now: Date())))
            } catch let error as RemotePeerTransportError {
                respond(peerErrorResponse(error))
            } catch {
                respond(.json(status: 500, ["error": "cannot create peer session"]))
            }

        case ("POST", "/p2p-test/offer"):
            do {
                let offer = try RemotePeerOffer.decodeExact(request.body)
                try peerTransport.accept(offer: offer, now: Date())
                respond(.empty(status: 202))
            } catch let error as RemotePeerTransportError {
                respond(peerErrorResponse(error))
            } catch {
                respond(.json(status: 422, ["error": "invalid offer"]))
            }

        case ("GET", "/p2p-test/answer"):
            guard let lookup = RemotePeerQuery.exactAnswerLookup(
                requestTarget: request.path
            ) else {
                respond(.json(status: 400, ["error": "invalid answer query"]))
                return
            }
            do {
                respond(try encodedPeerJSON(peerTransport.answer(
                    sessionID: lookup.sessionID,
                    generation: lookup.generation,
                    now: Date()
                )))
            } catch let error as RemotePeerTransportError {
                respond(peerErrorResponse(error))
            } catch {
                respond(.json(status: 500, ["error": "cannot read peer answer"]))
            }

        default:
            respond(.json(status: 404, ["error": "route not found"]))
        }
    }

    private func encodedPeerJSON<T: Encodable>(
        _ value: T
    ) throws -> LocalRemoteHTTPResponse {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return LocalRemoteHTTPResponse(
            status: 200,
            contentType: "application/json; charset=utf-8",
            headers: [:],
            body: try encoder.encode(value)
        )
    }

    private func peerErrorResponse(
        _ error: RemotePeerTransportError
    ) -> LocalRemoteHTTPResponse {
        if error == .answerUnavailable {
            return .empty(status: 204)
        }
        return .json(status: error.httpStatus, ["error": error.safeMessage])
    }

    private func peerTestPage() -> LocalRemoteHTTPResponse {
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
        do {
            return LocalRemoteHTTPResponse(
                status: 200,
                contentType: "text/html; charset=utf-8",
                headers: [
                    "Content-Security-Policy": csp,
                    "Referrer-Policy": "no-referrer",
                    "X-Frame-Options": "DENY",
                ],
                body: try RemotePeerBrowserPage.render(token: token, nonce: nonce)
            )
        } catch {
            return .json(status: 500, ["error": "bundled peer page is unavailable"])
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
