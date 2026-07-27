import Foundation
import AppKit

struct ComputerResolvedApplication: Equatable, Sendable {
    let bundleID: String
    let name: String
    let applicationURL: URL
    let codeIdentity: ComputerApplicationCodeIdentity

    var authorizationIdentity: ComputerApplicationIdentity {
        ComputerApplicationIdentity(
            bundleID: bundleID,
            name: name,
            processID: 0,
            windowTitle: nil
        )
    }
}

struct ComputerActivatedApplication: Equatable, Sendable {
    let application: ComputerApplicationIdentity
    /// Compatibility-only metadata retained for older audit/settings payloads.
    /// Production launch authorization never consults code-signing identity.
    let codeIdentity: ComputerApplicationCodeIdentity
}

enum ComputerApplicationLaunchError: LocalizedError, Equatable {
    case invalidBundleIdentifier
    case applicationNotFound(String)
    case ambiguousApplicationRegistration(String)
    case resolvedBundleMismatch(expected: String, actual: String)
    case launchFailed(String)
    case invalidLaunchedProcess
    case frontmostVerificationTimedOut
    case screenshotReadinessTimedOut
    case cancelled

    var errorDescription: String? {
        switch self {
        case .invalidBundleIdentifier:
            return "open_application requires one exact macOS bundle identifier"
        case .applicationNotFound(let bundleID):
            return "no installed macOS application matches bundle identifier \(bundleID)"
        case .ambiguousApplicationRegistration(let bundleID):
            return "multiple distinct macOS applications are registered for bundle identifier \(bundleID); authorization is ambiguous"
        case .resolvedBundleMismatch(let expected, let actual):
            return "resolved application bundle mismatch: expected \(expected), got \(actual)"
        case .launchFailed(let message):
            return "failed to launch or activate application: \(message)"
        case .invalidLaunchedProcess:
            return "NSWorkspace did not return a valid application process"
        case .frontmostVerificationTimedOut:
            return "launched application did not become the exact frontmost process before timeout"
        case .screenshotReadinessTimedOut:
            return "ScreenCaptureKit did not expose the exact target application window before the open_application verification deadline"
        case .cancelled:
            return "open_application request was cancelled"
        }
    }
}

enum ComputerApplicationResolver {
    /// CFBundleIdentifier allows only alphanumerics, dots, and hyphens. Requiring
    /// at least two components also excludes executable names and free-form input.
    static func validateBundleIdentifier(_ value: String) throws {
        guard value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty,
              value.utf8.count <= 255,
              value.range(
                of: #"^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$"#,
                options: .regularExpression
              ) != nil else {
            throw ComputerApplicationLaunchError.invalidBundleIdentifier
        }
    }

    /// Resolve only through Launch Services' exact bundle-identifier lookup.
    /// Paths, URLs, shell commands, executable names, and AppleScript never enter
    /// this seam.
    static func resolve(bundleIdentifier requested: String) throws
        -> ComputerResolvedApplication {
        try validateBundleIdentifier(requested)
        guard let selectedURL = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: requested
        ), selectedURL.isFileURL else {
            throw ComputerApplicationLaunchError.applicationNotFound(requested)
        }
        let applicationURL = try selectUnambiguousApplicationURL(
            bundleIdentifier: requested,
            selectedURL: selectedURL,
            registeredURLs: NSWorkspace.shared.urlsForApplications(
                withBundleIdentifier: requested
            )
        )
        guard
        let bundle = Bundle(url: applicationURL),
        let resolvedBundleID = bundle.bundleIdentifier,
        !resolvedBundleID.isEmpty else {
            throw ComputerApplicationLaunchError.applicationNotFound(requested)
        }
        guard resolvedBundleID.caseInsensitiveCompare(requested) == .orderedSame else {
            throw ComputerApplicationLaunchError.resolvedBundleMismatch(
                expected: requested,
                actual: resolvedBundleID
            )
        }
        let displayName = (
            bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
        )?.trimmingCharacters(in: .whitespacesAndNewlines)
        let bundleName = (
            bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
        )?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackName = applicationURL.deletingPathExtension().lastPathComponent
        return ComputerResolvedApplication(
            bundleID: resolvedBundleID,
            name: [displayName, bundleName, fallbackName]
                .compactMap { $0 }
                .first(where: { !$0.isEmpty }) ?? resolvedBundleID,
            applicationURL: applicationURL,
            codeIdentity: compatibilityCodeIdentity(
                bundleID: resolvedBundleID,
                applicationURL: applicationURL
            )
        )
    }

    /// The legacy model still carries a code-identity field for decoding old
    /// settings/audit records. It is deliberately untrusted and is never used
    /// by the production computer/open_application execution path.
    static func compatibilityCodeIdentity(
        bundleID: String,
        applicationURL: URL
    ) -> ComputerApplicationCodeIdentity {
        ComputerApplicationCodeIdentity(
            bundleID: bundleID,
            canonicalBundlePath: applicationURL.standardizedFileURL
                .resolvingSymlinksInPath().path,
            volumeIdentifier: 0,
            fileIdentifier: 0,
            designatedRequirement: "",
            signingIdentifier: "",
            teamIdentifier: nil,
            codeDirectoryHash: "",
            leafCertificateSHA256: nil
        )
    }

    /// Launch Services may retain duplicate/stale registrations. Require one
    /// canonical application URL so the requested bundle ID cannot resolve to
    /// an arbitrary installation.
    static func selectUnambiguousApplicationURL(
        bundleIdentifier: String,
        selectedURL: URL,
        registeredURLs: [URL]
    ) throws -> URL {
        let selected = try ComputerApplicationCodeIdentityResolver
            .canonicalBundleURL(selectedURL)
        var candidatesByPath: [String: URL] = [:]
        for url in registeredURLs {
            guard url.isFileURL else {
                throw ComputerApplicationLaunchError
                    .ambiguousApplicationRegistration(bundleIdentifier)
            }
            let canonical: URL
            do {
                canonical = try ComputerApplicationCodeIdentityResolver
                    .canonicalBundleURL(url)
            } catch {
                // A stale or malformed registration is itself ambiguous; do not
                // silently ignore it and launch another candidate.
                throw ComputerApplicationLaunchError
                    .ambiguousApplicationRegistration(bundleIdentifier)
            }
            candidatesByPath[canonical.path] = canonical
        }
        guard candidatesByPath.count == 1,
              candidatesByPath[selected.path] != nil else {
            throw ComputerApplicationLaunchError
                .ambiguousApplicationRegistration(bundleIdentifier)
        }
        return selected
    }
}

enum ComputerApplicationLauncher {
    /// NSWorkspace is the sole launch/activation mechanism. The coordinator still
    /// verifies the exact bundle and PID against the real frontmost application.
    static func activate(
        _ target: ComputerResolvedApplication
    ) async throws -> ComputerActivatedApplication {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.addsToRecentItems = false

        let running: NSRunningApplication = try await withCheckedThrowingContinuation {
            continuation in
            NSWorkspace.shared.openApplication(
                at: target.applicationURL,
                configuration: configuration
            ) { application, error in
                if let error {
                    continuation.resume(throwing:
                        ComputerApplicationLaunchError.launchFailed(
                            error.localizedDescription
                        )
                    )
                    return
                }
                guard let application,
                      !application.isTerminated,
                      application.processIdentifier > 0 else {
                    continuation.resume(throwing:
                        ComputerApplicationLaunchError.invalidLaunchedProcess
                    )
                    return
                }
                continuation.resume(returning: application)
            }
        }
        guard let actualBundleID = running.bundleIdentifier,
              actualBundleID.caseInsensitiveCompare(target.bundleID) == .orderedSame else {
            throw ComputerApplicationLaunchError.resolvedBundleMismatch(
                expected: target.bundleID,
                actual: running.bundleIdentifier ?? "(missing)"
            )
        }
        let application = ComputerApplicationIdentity(
            bundleID: actualBundleID,
            name: running.localizedName ?? target.name,
            processID: running.processIdentifier,
            windowTitle: nil
        )
        return ComputerActivatedApplication(
            application: application,
            codeIdentity: target.codeIdentity
        )
    }
}
