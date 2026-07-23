import Foundation

/// Lightweight dynamic JSON accessor over JSONSerialization values.
package struct J {
    let raw: Any?

    package init(_ raw: Any?) { self.raw = raw }

    static func parse(_ data: Data) -> J? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return J(obj)
    }

    subscript(key: String) -> J {
        J((raw as? [String: Any])?[key])
    }

    subscript(index: Int) -> J {
        guard let arr = raw as? [Any], index >= 0, index < arr.count else { return J(nil) }
        return J(arr[index])
    }

    var exists: Bool { raw != nil && !(raw is NSNull) }
    var string: String? { raw as? String }
    var bool: Bool? { raw as? Bool }

    var double: Double? {
        if let d = raw as? Double { return d }
        if let n = raw as? NSNumber { return n.doubleValue }
        return nil
    }

    var int: Int? {
        if let i = raw as? Int { return i }
        if let n = raw as? NSNumber { return n.intValue }
        return nil
    }

    var array: [J] { (raw as? [Any])?.map(J.init) ?? [] }
    var dict: [String: Any]? { raw as? [String: Any] }

    /// Compact JSON string of this value (for arg previews).
    var compactJSON: String {
        guard let raw, JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw),
              let s = String(data: data, encoding: .utf8) else {
            return string ?? (raw.map { "\($0)" } ?? "")
        }
        return s
    }
}
