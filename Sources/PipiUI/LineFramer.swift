import Foundation

/// Splits a byte stream into LF-delimited lines across arbitrarily chunked input.
///
/// Exists to kill an O(n²) trap: the previous inline splitter called
/// `buffer.firstIndex(of: 0x0A)` on the *whole* accumulator every time a chunk
/// arrived. pi returns a session's entire history as one JSON line with no LF
/// until the very end (11.5 MB for a long session), delivered in ~180 pipe
/// chunks — so each chunk rescanned everything, ~1 GB of byte scanning, and a
/// single session took 20–30 s to open. Tracking how far we have already scanned
/// makes every byte examined at most once: O(n).
struct LineFramer {
    private var buffer = Data()
    /// Bytes at the front already scanned for LF (no LF found in them yet).
    private var scanned = 0

    /// Appends `data` and returns every newly completed line (LF stripped, and a
    /// trailing CR stripped). A partial trailing line is retained for next time.
    mutating func push(_ data: Data) -> [Data] {
        guard !data.isEmpty else { return [] }
        buffer.append(data)

        var lines: [Data] = []
        var lineStart = buffer.startIndex
        var search = buffer.startIndex + scanned

        while search < buffer.endIndex,
              let nl = buffer[search...].firstIndex(of: 0x0A) {
            var line = buffer.subdata(in: lineStart..<nl)
            if line.last == 0x0D { line.removeLast() }
            lines.append(line)
            lineStart = nl + 1
            search = nl + 1
        }

        if lineStart > buffer.startIndex {
            // Drop consumed lines; keep the trailing partial as a fresh 0-based Data.
            buffer = Data(buffer[lineStart...])
        }
        // The bytes that remain have all been scanned (no LF among them).
        scanned = buffer.count
        return lines
    }

    /// Bytes currently held as an incomplete trailing line (diagnostics / tests).
    var pendingByteCount: Int { buffer.count }
}
