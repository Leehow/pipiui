import Foundation

/// Bounded byte tail of a child process stderr, drained asynchronously so a
/// long-lived cua-driver generation can never fill its stderr pipe and block.
///
/// Stores raw bytes only (most recent `capacity` bytes, oldest discarded).
/// Redaction/truncation is applied at read time, never at storage time, so the
/// store stays trivial and the redaction policy is independently testable.
///
/// The drain handler is the *sole* reader of the pipe. When the child closes
/// its stderr (notably on exit) the handler observes EOF and calls `markEOF`,
/// which is guaranteed to happen *after* every data chunk has been appended.
/// Failure-capture code then calls `waitForEOF` to serialize behind that flush,
/// eliminating the race where a fast-exit child's final stderr is read before
/// the async handler has delivered it.
final class BoundedPipeTail: @unchecked Sendable {
    private let condition = NSCondition()
    private let capacity: Int
    private var buffer = Data()
    private var eofObserved = false

    init(capacity: Int) {
        precondition(capacity > 0, "capacity must be positive")
        self.capacity = capacity
    }

    /// Appends a chunk read from the pipe. Keeps only the newest `capacity`
    /// bytes, discarding the oldest overflow. Cheap and non-blocking.
    func append(_ data: Data) {
        guard !data.isEmpty else { return }
        condition.lock()
        buffer.append(data)
        let overflow = buffer.count - capacity
        if overflow > 0 {
            buffer.removeFirst(overflow)
        }
        condition.unlock()
    }

    /// Marks that the pipe reached end-of-file. Called from the readability
    /// handler once the child has closed its stderr. Because EOF is delivered
    /// only after every prior data chunk, setting this flag proves the tail
    /// now contains everything the child ever wrote.
    func markEOF() {
        condition.lock()
        eofObserved = true
        condition.broadcast()
        condition.unlock()
    }

    /// Blocks the calling thread until `markEOF()` has been called or `timeout`
    /// elapses, returning whether EOF was observed. Intended for the
    /// failure-capture path, where the child has already terminated and EOF is
    /// imminent, so the wait normally returns within milliseconds. Must not be
    /// called on the main thread.
    func waitForEOF(timeout: TimeInterval) -> Bool {
        condition.lock()
        if eofObserved {
            condition.unlock()
            return true
        }
        let deadline = Date().addingTimeInterval(timeout)
        while !eofObserved {
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { break }
            _ = condition.wait(until: deadline)
        }
        let observed = eofObserved
        condition.unlock()
        return observed
    }

    /// Current tail decoded lossily as UTF-8, then sanitized for safe logging
    /// or error reporting. Safe to call off the owning queue.
    func sanitizedTail() -> String {
        condition.lock()
        let raw = String(decoding: buffer, as: UTF8.self)
        condition.unlock()
        return StderrSanitizer.sanitize(raw)
    }
}

/// Redaction + truncation policy for stderr that may appear in errors or logs.
///
/// Threat model: cua-driver / proxy stderr can legitimately echo arguments or
/// environment-derived secrets while crashing. Base64/hex blobs, tokens, and
/// large dumps must never reach the unified log or a user-visible error.
enum StderrSanitizer {
    /// Maximum characters emitted after sanitization.
    static let maxTotalCharacters = 4_000
    /// Maximum characters emitted for a single line (after redaction).
    static let maxLineCharacters = 400
    /// Runs of this many (or more) base64/hex/url-safe characters are treated
    /// as secret tokens and replaced with `placeholder`.
    static let redactedTokenLength = 40
    /// Replacement for any redacted token run.
    static let placeholder = "<redacted>"

    private static let tokenPattern: NSRegularExpression = {
        // base64 (+ / =), base64url (- _), and hex digits. 40+ contiguous chars
        // is long enough that no useful short identifier is caught, while every
        // common bearer token / base64 blob / hex digest is.
        let pattern = "[A-Za-z0-9+/=_-]{\(redactedTokenLength),}"
        return try! NSRegularExpression(pattern: pattern)
    }()

    /// Redacts long base64-like token runs, caps per-line length, then caps
    /// total length. Never throws; always returns a String (possibly empty).
    static func sanitize(_ raw: String) -> String {
        guard !raw.isEmpty else { return "" }
        let redacted = redactTokens(in: raw)
        let cappedLines = redacted
            .split(
                omittingEmptySubsequences: false,
                whereSeparator: { $0 == "\n" }
            )
            .map(capLine)
            .joined(separator: "\n")
        return capTotal(cappedLines)
    }

    private static func redactTokens(in text: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return tokenPattern.stringByReplacingMatches(
            in: text,
            range: range,
            withTemplate: placeholder
        )
    }

    private static func capLine(_ line: Substring) -> String {
        guard line.count > maxLineCharacters else { return String(line) }
        return String(line.prefix(maxLineCharacters)) + "…<line truncated>"
    }

    private static func capTotal(_ text: String) -> String {
        guard text.count > maxTotalCharacters else { return text }
        return "…<stderr truncated>\n" + String(text.suffix(maxTotalCharacters))
    }
}
