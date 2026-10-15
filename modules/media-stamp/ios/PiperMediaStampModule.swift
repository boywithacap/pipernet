import AVFoundation
import ExpoModulesCore
import UIKit

public final class PiperMediaStampModule: Module {
  private let io = DispatchQueue(label: "PiperMediaStamp.io", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("PiperMediaStamp")
    AsyncFunction("stampPhoto") { (uri: String, text: String, quality: Double, promise: Promise) in
      self.io.async {
        do {
          promise.resolve(try self.stampPhoto(uri, text: text, quality: quality))
        } catch { promise.reject(error) }
      }
    }
    AsyncFunction("stampVideo") { (uri: String, text: String, promise: Promise) in
      Task {
        do { promise.resolve(try await self.stampVideo(uri, text: text)) }
        catch { promise.reject(error) }
      }
    }
  }

  private func failure(_ text: String) -> NSError {
    NSError(domain: "PiperMediaStamp", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
  }

  private func ownedURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw failure("Invalid capture file.") }
    let source = url.resolvingSymlinksInPath().standardizedFileURL
    let roots = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
    guard roots.contains(where: { source.path.hasPrefix($0.resolvingSymlinksInPath().path + "/") }) else {
      throw failure("Only temporary captures can be timestamped.")
    }
    return source
  }

  private func outputURL(_ ext: String) -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("piper-stamp-\(UUID().uuidString).\(ext)")
  }

  private func validateText(_ text: String) throws {
    guard text.count <= 64, text.split(separator: "\n").count == 2 else { throw failure("Invalid capture timestamp.") }
  }

  private func validateSize(_ size: CGSize) throws {
    guard size.width.isFinite, size.height.isFinite,
          size.width >= 32, size.height >= 32,
          size.width <= 640, size.height <= 640 else { throw failure("Invalid capture dimensions.") }
  }

  private static func drawStamp(_ text: String, size: CGSize) {
    // Size for the final small mesh image, with room for subsequent video compression.
    let edge = min(size.width, size.height)
    let font = UIFont.monospacedDigitSystemFont(ofSize: max(9, edge * 0.035), weight: .medium)
    let shadow = NSShadow()
    shadow.shadowColor = UIColor.black
    shadow.shadowOffset = CGSize(width: 0, height: 1)
    shadow.shadowBlurRadius = max(1, edge * 0.003)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font, .foregroundColor: UIColor.white,
      .strokeColor: UIColor.black.withAlphaComponent(0.82), .strokeWidth: -3,
      .shadow: shadow,
    ]
    let labelSize = (text as NSString).size(withAttributes: attributes)
    let margin = max(6, edge * 0.03)
    (text as NSString).draw(at: CGPoint(x: margin, y: size.height - labelSize.height - margin), withAttributes: attributes)
  }

  private func stampPhoto(_ uri: String, text: String, quality: Double) throws -> String {
    let source = try ownedURL(uri)
    try validateText(text)
    guard quality.isFinite, quality > 0, quality <= 1,
          let image = UIImage(contentsOfFile: source.path) else { throw failure("Couldn’t read the photo.") }
    let size = image.size
    try validateSize(size)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let stamped = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
      Self.drawStamp(text, size: size)
    }
    guard let data = stamped.jpegData(compressionQuality: quality) else { throw failure("Couldn’t timestamp the photo.") }
    let output = outputURL("jpg")
    try data.write(to: output, options: .atomic)
    return output.absoluteString
  }

  private func stampVideo(_ uri: String, text: String) async throws -> String {
    let source = try ownedURL(uri)
    try validateText(text)
    let asset = AVURLAsset(url: source)
    let duration = try await asset.load(.duration)
    guard duration.seconds.isFinite, duration.seconds > 0, duration.seconds <= 60.5,
          let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw failure("Record a video of 60 seconds or less.")
    }
    let naturalSize = try await track.load(.naturalSize)
    let preferred = try await track.load(.preferredTransform)
    let bounds = CGRect(origin: .zero, size: naturalSize).applying(preferred)
    let size = CGSize(width: abs(bounds.width), height: abs(bounds.height))
    try validateSize(size)

    let video = AVMutableVideoComposition()
    video.renderSize = size
    video.frameDuration = CMTime(value: 1, timescale: 30)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layerInstruction.setTransform(preferred.concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY)), at: .zero)
    instruction.layerInstructions = [layerInstruction]
    video.instructions = [instruction]

    // UIKit/CoreAnimation creation belongs on the main thread; encoding runs natively.
    let animation = await MainActor.run { () -> AVVideoCompositionCoreAnimationTool in
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = false
      let overlayImage = UIGraphicsImageRenderer(size: size, format: format).image { _ in Self.drawStamp(text, size: size) }
      let parent = CALayer()
      parent.frame = CGRect(origin: .zero, size: size)
      let footage = CALayer()
      footage.frame = parent.bounds
      let overlay = CALayer()
      overlay.frame = parent.bounds
      overlay.contents = overlayImage.cgImage
      parent.addSublayer(footage)
      parent.addSublayer(overlay)
      return AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: footage, in: parent)
    }
    video.animationTool = animation
    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      throw failure("Couldn’t timestamp the video.")
    }
    let output = outputURL("mp4")
    export.outputURL = output
    export.outputFileType = .mp4
    export.videoComposition = video
    // All tracks, including microphone audio, remain in the export.
    await export.export()
    guard export.status == .completed else {
      try? FileManager.default.removeItem(at: output)
      throw export.error ?? failure("Couldn’t timestamp the video.")
    }
    return output.absoluteString
  }
}
