import Foundation

/// Engine-agnostic backend for one agent session. `PiProcess` conforms today;
/// a future `JcodeBackend` (driving `jcode api-bridge` over NDJSON) will conform
/// the same way. `ChatSession` holds `any AgentSessionBackend` and routes its
/// `onEvent`/`onExit` plus the request/terminate methods uniformly.
///
/// Method signatures mirror `PiProcess` exactly so the pi path needs no method
/// body changes — `PiProcess` satisfies this protocol by an empty extension.
/// The protocol deliberately keeps the `J` dynamic-JSON type (not a typed
/// `BackendEvent` enum) so the existing `handleEvent(_ e: J)` entry point and
/// its full test suite stay byte-for-byte unchanged. A non-pi backend is
/// expected to translate its native events into pi-compatible `J` shapes before
/// invoking `onEvent`.
protocol AgentSessionBackend: AnyObject {
    /// Streaming/event delivery (callbacks fire on the main thread).
    var onEvent: ((J) -> Void)? { get set }

    /// Process-exit delivery (callback fires on the main thread).
    var onExit: ((Int32, String) -> Void)? { get set }

    /// Whether the backing process is alive.
    var isRunning: Bool { get }

    /// Send a raw command without waiting for the response.
    /// `failure` runs on the main thread if the process is dead or the write fails.
    func send(_ object: [String: Any], failure: (() -> Void)?)

    /// Send a command with an auto-generated id; completion runs on the main thread.
    func request(_ object: [String: Any], completion: ((J) -> Void)?)

    /// Graceful stop: signal the process and any descendant subagent processes.
    func terminate()

    /// Best-effort signal to descendant processes only — never the main process itself.
    func signalDescendants(_ sig: Int32)

    /// Last-resort kill when a graceful terminate does not exit in time.
    func forceKill()
}
