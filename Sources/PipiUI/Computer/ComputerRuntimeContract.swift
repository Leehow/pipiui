import Foundation

struct ComputerRuntimeErrorSemantics: Equatable {
    let retryable: Bool
    let requiresObservation: Bool
}

/// Public, versioned boundary between PipiUI's desktop runtime and a trusted
/// replaceable Pi strategy. The Cua helper remains private to the App.
enum ComputerRuntimeContract {
    static let protocolName = ComputerUseStrategyResource.runtimeProtocolName
    static let version = ComputerUseStrategyResource.runtimeProtocolVersion
    static let capabilitiesAction = "computer_runtime_capabilities"
    static let operations = [
        capabilitiesAction,
        "computer_batch",
        "computer_open_application",
        "computer_cancel",
    ]

    static func validateVersion(_ request: J) -> [String: Any]? {
        guard request["protocolVersion"].int == version else {
            return failure(
                code: "unsupported_protocol_version",
                message:
                    "PipiUI Computer Runtime requires protocolVersion \(version)",
                retryable: false,
                requiresObservation: false,
                extra: [
                    "protocol": [
                        "name": protocolName,
                        "version": version,
                    ],
                ]
            )
        }
        return nil
    }

    static func capabilities(
        descriptor: ComputerCaptureDescriptor,
        permissions: ComputerPermissionSnapshot
    ) -> [String: Any] {
        [
            "ok": true,
            "protocol": [
                "name": protocolName,
                "version": version,
            ],
            "operations": operations,
            "actions": ComputerActionKind.allCases.map(\.rawValue),
            "actionAliases": [
                "click": ComputerActionKind.leftClick.rawValue,
                "move": ComputerActionKind.mouseMove.rawValue,
                "keypress": ComputerActionKind.key.rawValue,
                "drag": ComputerActionKind.drag.rawValue,
            ],
            "features": [
                "batchActions": true,
                "accessibilityElements": true,
                "windowPinning": true,
                "backgroundInput": true,
                "inMemoryScreenshots": true,
                "requestCancellation": true,
                "nativeOpenAIComputerCall": false,
            ],
            "limits": [
                "maxActionsPerBatch": ComputerRequest.maximumActions,
                "maxRequestBodyBytes": BridgeRequestLimits.maximumBodyBytes,
                "maxExecutionMilliseconds":
                    Int(ComputerRuntimeBudget.maximumExecutionSeconds * 1_000),
                "maxEstimatedActionMilliseconds":
                    Int(ComputerRuntimeBudget.maximumEstimatedSeconds * 1_000),
                "maxPauseMilliseconds":
                    Int(ComputerRuntimeBudget.maximumPauseSeconds * 1_000),
                "maxTypedUTF16Units": ComputerRuntimeBudget.maximumTypedUTF16Units,
            ],
            "display": [
                "id": Int(descriptor.displayID),
                "width": descriptor.outputSize.width,
                "height": descriptor.outputSize.height,
                "globalBounds": [
                    "x": descriptor.globalBounds.origin.x,
                    "y": descriptor.globalBounds.origin.y,
                    "width": descriptor.globalBounds.width,
                    "height": descriptor.globalBounds.height,
                ],
            ],
            "runtime": [
                "platform": "macOS",
                "transport": "loopback-http-json",
                "endpoint": "/rpc",
                "helperExposed": false,
                "screenRecordingGranted": permissions.screenRecording,
                "accessibilityGranted": permissions.accessibility,
            ],
        ]
    }

    static func failure(
        code: String,
        message: String,
        retryable: Bool,
        requiresObservation: Bool,
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        var response: [String: Any] = [
            "ok": false,
            // Compatibility with the original private bridge.
            "error": message,
            "errorCode": code,
            // Public v1 error shape.
            "runtimeError": [
                "code": code,
                "message": message,
                "retryable": retryable,
                "requiresObservation": requiresObservation,
            ],
        ]
        for (key, value) in extra {
            response[key] = value
        }
        return response
    }

    /// Central compatibility envelope for errors emitted by existing runtime
    /// mechanics. Existing fields remain available while v1 clients get one
    /// stable structured error object.
    static func compatibilityEnvelope(_ response: [String: Any]) -> [String: Any] {
        guard response["ok"] as? Bool == false,
              response["runtimeError"] == nil else {
            return response
        }
        let message = response["error"] as? String ?? "computer runtime request failed"
        let code = response["errorCode"] as? String ?? "runtime_error"
        let semantics = errorSemantics(for: code)
        var result = response
        result["errorCode"] = code
        result["runtimeError"] = [
            "code": code,
            "message": message,
            "retryable":
                response["retryable"] as? Bool ?? semantics.retryable,
            "requiresObservation":
                response["requiresObservation"] as? Bool
                ?? semantics.requiresObservation,
        ]
        return result
    }

    /// Stable guidance for lower-level mechanics codes that predate Runtime v1.
    /// Unknown codes fail closed: absence of positive guidance never authorizes
    /// a retry or proves that continuing without observation is safe.
    static func errorSemantics(for code: String) -> ComputerRuntimeErrorSemantics {
        switch code {
        case "computer_busy":
            // The request was rejected before execution began.
            return ComputerRuntimeErrorSemantics(
                retryable: true,
                requiresObservation: false
            )
        case "computer_cancelled", "request_cancelled":
            // Cancellation can race with already-posted input.
            return ComputerRuntimeErrorSemantics(
                retryable: true,
                requiresObservation: true
            )
        case "computer_target_missing",
             "computer_target_lost",
             "computer_outcome_unknown",
             "cua_driver_error":
            return ComputerRuntimeErrorSemantics(
                retryable: false,
                requiresObservation: true
            )
        case "user_handoff_required":
            return ComputerRuntimeErrorSemantics(
                retryable: true,
                requiresObservation: true
            )
        case "invalid_application_target",
             "invalid_computer_request",
             "unauthorized_session_capability",
             "unauthorized_computer_capability",
             "unsupported_protocol_version",
             "runtime_unavailable":
            return ComputerRuntimeErrorSemantics(
                retryable: false,
                requiresObservation: false
            )
        case "runtime_error":
            // A generic mechanics failure cannot prove whether an action ran.
            return ComputerRuntimeErrorSemantics(
                retryable: false,
                requiresObservation: true
            )
        default:
            return ComputerRuntimeErrorSemantics(
                retryable: false,
                requiresObservation: true
            )
        }
    }
}
