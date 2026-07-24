import AppKit
import ObjectiveC

/// Captures `NSException`s that AppKit handles internally.
///
/// Exceptions raised inside the event loop or the display/constraint cycle never
/// reach `NSSetUncaughtExceptionHandler`: AppKit catches them and routes them
/// through `-[NSApplication reportException:]` (and, for the display cycle, its
/// `_crashOnException:` sibling, which traps). Hooking the public
/// `reportException:` gives us the exception *reason* — the one piece of
/// information a `.ips` crash report does not contain.
///
/// The `_crashOnException:` path stays uncovered on purpose (private API); for
/// that one the reason still lands in the file via ``StderrCapture``, since
/// AppKit `NSLog`s it before trapping.
public enum AppKitExceptionHook {
    private static let lock = NSLock()
    private static var didInstall = false
    private static var originalIMP: IMP?

    /// Idempotent. Must run on the main thread (it mutates a class method table).
    public static func install() {
        lock.lock()
        defer { lock.unlock() }
        guard !didInstall else { return }

        let selector = #selector(NSApplication.reportException(_:))
        guard let method = class_getInstanceMethod(NSApplication.self, selector) else {
            Log.warn("AppKitExceptionHook: reportException: not found; skipping", category: .crash)
            return
        }
        didInstall = true

        let replacement: @convention(block) (NSApplication, NSException) -> Void = { app, exception in
            report(exception)
            guard let original = originalIMP else { return }
            let callOriginal = unsafeBitCast(
                original,
                to: (@convention(c) (NSApplication, Selector, NSException) -> Void).self
            )
            callOriginal(app, selector, exception)
        }
        originalIMP = method_setImplementation(method, imp_implementationWithBlock(replacement))
    }

    private static func report(_ exception: NSException) {
        let name = exception.name.rawValue
        let reason = exception.reason ?? "(no reason)"
        var parts = ["AppKit reported NSException: \(name): \(reason)"]
        let frames = exception.callStackSymbols
        if !frames.isEmpty {
            parts.append("Call stack:")
            parts.append(contentsOf: frames.prefix(40).map { "\t\($0)" })
        }
        // Synchronous: the process may be about to trap.
        CrashReporting.logCrashSync(parts.joined(separator: "\n"))
    }
}
