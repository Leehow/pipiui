import Foundation
import Vision
import ImageIO
import CoreGraphics

/// On-device OCR via Apple Vision. Zero config; runs off the caller's thread.
enum ImageVisionOCR {
    /// Returns joined recognized lines, or `nil` on failure / empty result.
    static func recognizedText(data: Data) async -> String? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: recognizeSync(data: data))
            }
        }
    }

    /// Synchronous path kept for tests that inject a fake; production uses the async wrapper.
    static func recognizeSync(data: Data) -> String? {
        guard let cgImage = cgImage(from: data) else { return nil }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "en-US"]

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return nil
        }

        guard let observations = request.results, !observations.isEmpty else {
            return nil
        }

        let lines = observations.compactMap { $0.topCandidates(1).first?.string }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !lines.isEmpty else { return nil }
        return lines.joined(separator: "\n")
    }

    private static func cgImage(from data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            return nil
        }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}
