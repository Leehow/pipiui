import Foundation
import AppKit
import Security
import CryptoKit

struct ComputerApplicationCodeIdentity: Codable, Equatable, Hashable, Sendable {
    let bundleID: String
    let canonicalBundlePath: String
    let volumeIdentifier: UInt64
    let fileIdentifier: UInt64
    let designatedRequirement: String
    let signingIdentifier: String
    let teamIdentifier: String?
    let codeDirectoryHash: String
    let leafCertificateSHA256: String?

    var normalizedBundleID: String {
        bundleID.lowercased()
    }

    /// Audit records retain only this one-way value, never the application path or
    /// the full designated requirement.
    var auditFingerprint: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = (try? encoder.encode(self)) ?? Data()
        return SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

/// The exact display/process identity shown to the user together with the
/// static-and-dynamic code identity that was resolved for that same PID.
/// A later PID may reuse this authorization only after resolving to the exact
/// same code identity again.
struct ComputerRunningApplicationAuthorization: Equatable, Sendable {
    let application: ComputerApplicationIdentity
    let codeIdentity: ComputerApplicationCodeIdentity
}

struct ComputerApplicationSigningIdentity: Equatable, Sendable {
    let bundleID: String
    let designatedRequirement: String
    let signingIdentifier: String
    let teamIdentifier: String?
    let codeDirectoryHash: String
    let leafCertificateSHA256: String?
}

enum ComputerApplicationCodeIdentityError: LocalizedError, Equatable {
    case invalidBundleURL
    case fileIdentityUnavailable
    case unsignedOrInvalidApplication(OSStatus)
    case signingInformationUnavailable(OSStatus)
    case designatedRequirementUnavailable(OSStatus)
    case expectedRequirementInvalid(OSStatus)
    case incompleteSigningIdentity
    case runningApplicationUnavailable
    case runningApplicationAmbiguous
    case runningBundleMismatch
    case runningBundleURLMismatch
    case runningExecutableOutsideBundle
    case runningCodeUnavailable(OSStatus)
    case runningCodeInvalid(OSStatus)
    case runningArchitectureCodeIdentityMismatch
    case identityDrift

    var errorDescription: String? {
        switch self {
        case .invalidBundleURL:
            return "application bundle URL is invalid"
        case .fileIdentityUnavailable:
            return "application bundle file identity is unavailable"
        case .unsignedOrInvalidApplication(let status):
            return "application code signature is invalid (\(status))"
        case .signingInformationUnavailable(let status):
            return "application signing information is unavailable (\(status))"
        case .designatedRequirementUnavailable(let status):
            return "application designated requirement is unavailable (\(status))"
        case .expectedRequirementInvalid(let status):
            return "authorized application requirement is invalid (\(status))"
        case .incompleteSigningIdentity:
            return "application signing identity is incomplete"
        case .runningApplicationUnavailable:
            return "launched application process is unavailable"
        case .runningApplicationAmbiguous:
            return "running application process identity is ambiguous"
        case .runningBundleMismatch:
            return "launched process bundle identifier does not match the authorized application"
        case .runningBundleURLMismatch:
            return "launched process bundle URL does not match the authorized application"
        case .runningExecutableOutsideBundle:
            return "launched process executable is outside the authorized application bundle"
        case .runningCodeUnavailable(let status):
            return "launched process code identity is unavailable (\(status))"
        case .runningCodeInvalid(let status):
            return "launched process code signature is invalid (\(status))"
        case .runningArchitectureCodeIdentityMismatch:
            return "launched process architecture or code directory does not match the authorized application"
        case .identityDrift:
            return "application code identity changed after authorization"
        }
    }
}

enum ComputerApplicationCodeIdentityResolver {
    /// Resolve the one live NSRunningApplication represented by the captured
    /// PID. The explicit candidate count is fail-closed even though macOS PIDs
    /// should be unique: an incomplete or internally inconsistent workspace
    /// snapshot must never become an authorization identity.
    static func exactRunningBundleURL(
        for application: ComputerApplicationIdentity
    ) throws -> URL {
        guard application.processID > 0 else {
            throw ComputerApplicationCodeIdentityError
                .runningApplicationUnavailable
        }
        let candidates = NSWorkspace.shared.runningApplications.filter {
            $0.processIdentifier == application.processID
                && !$0.isTerminated
        }
        guard !candidates.isEmpty else {
            throw ComputerApplicationCodeIdentityError
                .runningApplicationUnavailable
        }
        guard candidates.count == 1 else {
            throw ComputerApplicationCodeIdentityError
                .runningApplicationAmbiguous
        }
        let running = candidates[0]
        guard let direct = NSRunningApplication(
            processIdentifier: application.processID
        ), !direct.isTerminated,
        direct.processIdentifier == running.processIdentifier,
        let bundleID = running.bundleIdentifier,
        bundleID.caseInsensitiveCompare(application.bundleID) == .orderedSame,
        let directBundleID = direct.bundleIdentifier,
        directBundleID.caseInsensitiveCompare(bundleID) == .orderedSame,
        let bundleURL = running.bundleURL,
        let directBundleURL = direct.bundleURL else {
            throw ComputerApplicationCodeIdentityError
                .runningApplicationUnavailable
        }
        let canonical = try canonicalBundleURL(bundleURL)
        guard canonical.path == (try canonicalBundleURL(directBundleURL)).path
        else {
            throw ComputerApplicationCodeIdentityError
                .runningApplicationAmbiguous
        }
        return canonical
    }

    static func canonicalBundleURL(_ url: URL) throws -> URL {
        guard url.isFileURL else {
            throw ComputerApplicationCodeIdentityError.invalidBundleURL
        }
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        guard canonical.pathExtension.lowercased() == "app",
              FileManager.default.fileExists(atPath: canonical.path) else {
            throw ComputerApplicationCodeIdentityError.invalidBundleURL
        }
        return canonical
    }

    static func resolve(
        bundleURL originalURL: URL
    ) throws -> ComputerApplicationCodeIdentity {
        let bundleURL = try canonicalBundleURL(originalURL)
        guard let bundle = Bundle(url: bundleURL),
              let bundleID = bundle.bundleIdentifier,
              !bundleID.isEmpty else {
            throw ComputerApplicationCodeIdentityError.invalidBundleURL
        }
        let initialFileIdentity = try fileIdentity(for: bundleURL)

        var staticCode: SecStaticCode?
        var status = SecStaticCodeCreateWithPath(
            bundleURL as CFURL,
            SecCSFlags(),
            &staticCode
        )
        guard status == errSecSuccess, let staticCode else {
            throw ComputerApplicationCodeIdentityError
                .unsignedOrInvalidApplication(status)
        }
        status = SecStaticCodeCheckValidity(
            staticCode,
            SecCSFlags(),
            nil
        )
        guard status == errSecSuccess else {
            throw ComputerApplicationCodeIdentityError
                .unsignedOrInvalidApplication(status)
        }
        let signingIdentity = try signingIdentity(
            for: staticCode,
            flags: SecCSFlags(
                rawValue: kSecCSSigningInformation
                    | kSecCSRequirementInformation
            )
        )
        guard signingIdentity.bundleID.caseInsensitiveCompare(bundleID)
                == .orderedSame else {
            throw ComputerApplicationCodeIdentityError.identityDrift
        }
        guard try fileIdentity(for: bundleURL) == initialFileIdentity else {
            throw ComputerApplicationCodeIdentityError.identityDrift
        }

        return ComputerApplicationCodeIdentity(
            bundleID: signingIdentity.bundleID,
            canonicalBundlePath: bundleURL.path,
            volumeIdentifier: initialFileIdentity.volume,
            fileIdentifier: initialFileIdentity.file,
            designatedRequirement: signingIdentity.designatedRequirement,
            signingIdentifier: signingIdentity.signingIdentifier,
            teamIdentifier: signingIdentity.teamIdentifier,
            codeDirectoryHash: signingIdentity.codeDirectoryHash,
            leafCertificateSHA256:
                signingIdentity.leafCertificateSHA256
        )
    }

    /// Resolve by PID through Security.framework's dynamic-code API. The
    /// authorized designated requirement is matched by the kernel and the
    /// identity is read from the validated running architecture itself. Never
    /// reopen the path as fresh static code here: the bytes at that path can
    /// differ from the architecture/process that Launch Services started.
    static func resolveRunningApplication(
        processID: Int32,
        expectedIdentity: ComputerApplicationCodeIdentity
    ) throws -> ComputerApplicationCodeIdentity {
        guard processID > 0,
              let running = NSRunningApplication(
                processIdentifier: processID
              ),
              !running.isTerminated,
              let runningBundleID = running.bundleIdentifier,
              let runningBundleURL = running.bundleURL else {
            throw ComputerApplicationCodeIdentityError
                .runningApplicationUnavailable
        }
        guard runningBundleID.caseInsensitiveCompare(expectedIdentity.bundleID)
                == .orderedSame else {
            throw ComputerApplicationCodeIdentityError.runningBundleMismatch
        }
        let canonicalExpected = try canonicalBundleURL(
            URL(
                fileURLWithPath: expectedIdentity.canonicalBundlePath,
                isDirectory: true
            )
        )
        let canonicalRunning = try canonicalBundleURL(runningBundleURL)
        guard canonicalExpected.path == canonicalRunning.path else {
            throw ComputerApplicationCodeIdentityError
                .runningBundleURLMismatch
        }
        let initialFileIdentity = try fileIdentity(for: canonicalRunning)
        guard initialFileIdentity.volume == expectedIdentity.volumeIdentifier,
              initialFileIdentity.file == expectedIdentity.fileIdentifier else {
            throw ComputerApplicationCodeIdentityError.identityDrift
        }
        if let executableURL = running.executableURL {
            let executable = executableURL.standardizedFileURL
                .resolvingSymlinksInPath().path
            let bundlePrefix = canonicalRunning.path + "/"
            guard executable.hasPrefix(bundlePrefix) else {
                throw ComputerApplicationCodeIdentityError
                    .runningExecutableOutsideBundle
            }
        } else {
            throw ComputerApplicationCodeIdentityError
                .runningExecutableOutsideBundle
        }

        let attributes = [
            kSecGuestAttributePid as String: NSNumber(value: processID),
        ] as CFDictionary
        var dynamicCode: SecCode?
        var status = SecCodeCopyGuestWithAttributes(
            nil,
            attributes,
            SecCSFlags(),
            &dynamicCode
        )
        guard status == errSecSuccess, let dynamicCode else {
            throw ComputerApplicationCodeIdentityError
                .runningCodeUnavailable(status)
        }
        var expectedRequirement: SecRequirement?
        // Bind dynamic validation to both the authorized designated
        // requirement and its exact code directory. The latter is what makes
        // universal/Rosetta architecture changes and same-vendor replacement
        // binaries fail before any signing information is read back.
        let exactRequirementText =
            "(\(expectedIdentity.designatedRequirement)) and cdhash H\"" +
            "\(expectedIdentity.codeDirectoryHash)\""
        status = SecRequirementCreateWithString(
            exactRequirementText as CFString,
            SecCSFlags(),
            &expectedRequirement
        )
        guard status == errSecSuccess, let expectedRequirement else {
            throw ComputerApplicationCodeIdentityError
                .expectedRequirementInvalid(status)
        }
        status = SecCodeCheckValidity(
            dynamicCode,
            SecCSFlags(),
            expectedRequirement
        )
        guard status == errSecSuccess else {
            throw ComputerApplicationCodeIdentityError
                .runningCodeInvalid(status)
        }

        // Security.framework's C declarations accept SecCodeRef for the
        // information/path APIs below. Swift imports those parameters as the
        // narrower SecStaticCode type even though SecCode and SecStaticCode are
        // CF runtime views of the same opaque object. This view preserves the
        // already-validated dynamic code; it does not copy or reopen disk code.
        let dynamicCodeView = unsafeBitCast(
            dynamicCode,
            to: SecStaticCode.self
        )
        var codePath: CFURL?
        status = SecCodeCopyPath(
            dynamicCodeView,
            SecCSFlags(),
            &codePath
        )
        guard status == errSecSuccess,
              let dynamicPath = codePath as URL?,
              try canonicalBundleURL(dynamicPath).path
                == canonicalRunning.path else {
            throw ComputerApplicationCodeIdentityError
                .runningBundleURLMismatch
        }
        let runningSigningIdentity = try signingIdentity(
            for: dynamicCodeView,
            flags: SecCSFlags(
                rawValue: kSecCSSigningInformation
                    | kSecCSRequirementInformation
                    | kSecCSDynamicInformation
            )
        )
        let finalFileIdentity = try fileIdentity(for: canonicalRunning)
        guard finalFileIdentity == initialFileIdentity else {
            throw ComputerApplicationCodeIdentityError.identityDrift
        }
        let actualIdentity = ComputerApplicationCodeIdentity(
            bundleID: runningSigningIdentity.bundleID,
            canonicalBundlePath: canonicalRunning.path,
            volumeIdentifier: finalFileIdentity.volume,
            fileIdentifier: finalFileIdentity.file,
            designatedRequirement:
                runningSigningIdentity.designatedRequirement,
            signingIdentifier: runningSigningIdentity.signingIdentifier,
            teamIdentifier: runningSigningIdentity.teamIdentifier,
            codeDirectoryHash: runningSigningIdentity.codeDirectoryHash,
            leafCertificateSHA256:
                runningSigningIdentity.leafCertificateSHA256
        )
        return try validateRunningIdentity(
            expected: expectedIdentity,
            actual: actualIdentity
        )
    }

    /// Production comparator kept separate so architecture/process-vs-disk
    /// confusion has a deterministic regression seam. v1 intentionally
    /// authorizes one code directory: a universal binary launched under a
    /// different/Rosetta architecture has a different cdhash and fails closed.
    static func validateRunningIdentity(
        expected: ComputerApplicationCodeIdentity,
        actual: ComputerApplicationCodeIdentity
    ) throws -> ComputerApplicationCodeIdentity {
        guard expected.normalizedBundleID == actual.normalizedBundleID,
              expected.canonicalBundlePath == actual.canonicalBundlePath,
              expected.volumeIdentifier == actual.volumeIdentifier,
              expected.fileIdentifier == actual.fileIdentifier,
              expected.designatedRequirement
                == actual.designatedRequirement,
              expected.signingIdentifier == actual.signingIdentifier,
              expected.teamIdentifier == actual.teamIdentifier,
              expected.leafCertificateSHA256
                == actual.leafCertificateSHA256 else {
            throw ComputerApplicationCodeIdentityError.identityDrift
        }
        guard expected.codeDirectoryHash == actual.codeDirectoryHash else {
            throw ComputerApplicationCodeIdentityError
                .runningArchitectureCodeIdentityMismatch
        }
        return actual
    }

    private static func fileIdentity(
        for bundleURL: URL
    ) throws -> (volume: UInt64, file: UInt64) {
        let attributes = try FileManager.default.attributesOfItem(
            atPath: bundleURL.path
        )
        guard let volume = attributes[.systemNumber] as? NSNumber,
              let file = attributes[.systemFileNumber] as? NSNumber else {
            throw ComputerApplicationCodeIdentityError.fileIdentityUnavailable
        }
        return (volume.uint64Value, file.uint64Value)
    }

    private static func signingIdentity(
        for code: SecStaticCode,
        flags: SecCSFlags
    ) throws -> ComputerApplicationSigningIdentity {
        var requirement: SecRequirement?
        var status = SecCodeCopyDesignatedRequirement(
            code,
            SecCSFlags(),
            &requirement
        )
        guard status == errSecSuccess, let requirement else {
            throw ComputerApplicationCodeIdentityError
                .designatedRequirementUnavailable(status)
        }
        var requirementText: CFString?
        status = SecRequirementCopyString(
            requirement,
            SecCSFlags(),
            &requirementText
        )
        guard status == errSecSuccess,
              let designatedRequirement = requirementText as String?,
              !designatedRequirement.isEmpty else {
            throw ComputerApplicationCodeIdentityError
                .designatedRequirementUnavailable(status)
        }

        var information: CFDictionary?
        status = SecCodeCopySigningInformation(
            code,
            flags,
            &information
        )
        guard status == errSecSuccess,
              let values = information as? [String: Any] else {
            throw ComputerApplicationCodeIdentityError
                .signingInformationUnavailable(status)
        }
        let signedInfo = values[kSecCodeInfoPList as String]
        let bundleID: String?
        if let dictionary = signedInfo as? [String: Any] {
            bundleID = dictionary["CFBundleIdentifier"] as? String
        } else if let dictionary = signedInfo as? NSDictionary {
            bundleID = dictionary["CFBundleIdentifier"] as? String
        } else {
            bundleID = nil
        }
        guard let bundleID, !bundleID.isEmpty,
              let signingIdentifier =
                values[kSecCodeInfoIdentifier as String] as? String,
              !signingIdentifier.isEmpty,
              let unique = values[kSecCodeInfoUnique as String] as? Data,
              !unique.isEmpty else {
            throw ComputerApplicationCodeIdentityError.incompleteSigningIdentity
        }
        let teamIdentifier = (
            values[kSecCodeInfoTeamIdentifier as String] as? String
        ).flatMap { $0.isEmpty ? nil : $0 }
        let certificateDigest: String?
        if let certificates =
                values[kSecCodeInfoCertificates as String] as? [SecCertificate],
           let leaf = certificates.first {
            certificateDigest = SHA256.hash(
                data: SecCertificateCopyData(leaf) as Data
            ).map { String(format: "%02x", $0) }.joined()
        } else {
            certificateDigest = nil
        }

        return ComputerApplicationSigningIdentity(
            bundleID: bundleID,
            designatedRequirement: designatedRequirement,
            signingIdentifier: signingIdentifier,
            teamIdentifier: teamIdentifier,
            codeDirectoryHash: unique.map {
                String(format: "%02x", $0)
            }.joined(),
            leafCertificateSHA256: certificateDigest
        )
    }
}
