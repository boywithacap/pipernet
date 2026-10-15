import AVFoundation
import CryptoKit
import ExpoModulesCore
import ImageIO
import UniformTypeIdentifiers

public final class PiperMediaInspectorModule: Module {
  private let io = DispatchQueue(label: "PiperMediaInspector.io", qos: .userInitiated)
  private let maxFile: Int64 = 5 * 1024 * 1024

  public func definition() -> ModuleDefinition {
    Name("PiperMediaInspector")
    AsyncFunction("hashFile") { (uri: String, promise: Promise) in
      self.io.async {
        do {
          let url = try self.ownedURL(uri)
          let size = try self.fileSize(url)
          guard size > 0, size <= self.maxFile else {
            throw self.failure("Media exceeds the wire limit.")
          }
          let handle = try FileHandle(forReadingFrom: url)
          defer { try? handle.close() }
          var hash = SHA256()
          while let data = try handle.read(upToCount: 64 * 1024), !data.isEmpty {
            hash.update(data: data)
          }
          promise.resolve(
            ["hash": hash.finalize().map { String(format: "%02x", $0) }.joined(), "bytes": size]
              as [String: Any])
        } catch { promise.reject(error) }
      }
    }
    AsyncFunction("inspectMedia") { (uri: String, promise: Promise) in
      Task {
        do { promise.resolve(try await self.inspect(self.ownedURL(uri))) } catch {
          promise.reject(error)
        }
      }
    }
  }

  private func failure(_ text: String) -> NSError {
    NSError(domain: "PiperMediaInspector", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
  }
  private func ownedURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else {
      throw failure("Only app-owned files can be used.")
    }
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL
    let roots = [
      FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0],
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0],
    ]
    guard
      roots.contains(where: { resolved.path.hasPrefix($0.resolvingSymlinksInPath().path + "/") })
    else { throw failure("Invalid local media file.") }
    return resolved
  }
  private func fileSize(_ url: URL) throws -> Int64 {
    (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
      ?? 0
  }
  private func inspect(_ url: URL) async throws -> [String: Any] {
    let size = try fileSize(url)
    guard size > 0, size <= maxFile else { throw failure("Invalid incoming media size.") }
    let handle = try FileHandle(forReadingFrom: url)
    let header = try handle.read(upToCount: 12) ?? Data()
    try handle.close()
    if header.starts(with: [0xff, 0xd8]) {
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        CGImageSourceGetType(source) as String? == UTType.jpeg.identifier,
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int,
        let height = properties[kCGImagePropertyPixelHeight] as? Int,
        (1...640).contains(width), (1...640).contains(height)
      else { throw failure("Invalid incoming photo.") }
      return ["kind": "photo", "width": width, "height": height, "bytes": size]
    }
    guard header.count == 12, String(data: header.subdata(in: 4..<8), encoding: .ascii) == "ftyp"
    else { throw failure("Unsupported media container.") }
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw failure("Missing video track.")
    }
    let duration = try await asset.load(.duration).seconds
    let dimensions = try await track.load(.naturalSize)
    let descriptions = try await track.load(.formatDescriptions)
    guard duration.isFinite, duration > 0, duration <= 60.5, dimensions.width > 0,
      dimensions.height > 0,
      dimensions.width <= 640, dimensions.height <= 640,
      descriptions.contains(where: {
        CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264
      })
    else { throw failure("Invalid incoming video format, dimensions or duration.") }
    return [
      "kind": "video", "width": dimensions.width, "height": dimensions.height, "duration": duration,
      "bytes": size,
    ]
  }
}
