import ExpoModulesCore
import NearbyConnections
import CryptoKit
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import UIKit

public final class PiperNearbyModule: Module {
  private var manager: ConnectionManager?
  private var advertiser: Advertiser?
  private var discoverer: Discoverer?
  private var running = false
  private var generation = 0
  private var starting: (generation: Int, promise: Promise)?
  private var name = "Piper"
  private var names: [String: String] = [:]
  private var verification: [String: (Bool) -> Void] = [:]
  private var connected = Set<String>()
  private var expected: [String: Int64] = [:]
  private var incoming: [PayloadID: (peer: String, url: URL, token: CancellationToken)] = [:]
  private var sending: [String: (id: PayloadID, token: CancellationToken)] = [:]
  private var progressAt: [PayloadID: TimeInterval] = [:]
  private let maxFile: Int64 = 5 * 1024 * 1024
  private let service = "com.boywithacap.pipernet.mesh.v1"
  private let localMediums: Set<Medium> = [.bluetooth, .ble, .wifiLAN, .wifiHotspot, .wifiDirect, .awdl]
  private let io = DispatchQueue(label: "pipernet.media", qos: .utility)
  private var cache: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("piper-mesh", isDirectory: true) }

  public func definition() -> ModuleDefinition {
    Name("PiperNearby")
    Events("onEvent")
    AsyncFunction("start") { (displayName: String, promise: Promise) in
      self.stopMesh()
      guard UIApplication.shared.applicationState == .active else {
        promise.reject("E_NEARBY_INACTIVE", "Return to PiperNet before starting nearby sharing.")
        return
      }
      // Fail recoverably before Nearby touches APIs whose missing usage keys terminate iOS.
      for key in ["NSBluetoothAlwaysUsageDescription", "NSLocalNetworkUsageDescription", "NSLocationWhenInUseUsageDescription"] {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String, !value.isEmpty else {
          promise.reject("E_NEARBY_CONFIG", "Install a new PiperNet development build with nearby permissions.")
          return
        }
      }
      do {
        try FileManager.default.createDirectory(at: self.cache, withIntermediateDirectories: true)
        for file in try FileManager.default.contentsOfDirectory(at: self.cache, includingPropertiesForKeys: nil) { try? FileManager.default.removeItem(at: file) }
      } catch { promise.reject(error); return }
      self.running = true
      self.name = String(displayName.prefix(40))
      // Advertiser/Discoverer deinit stops the process-wide Nearby core. Reuse
      // them so an old callback releasing its objects cannot stop a new session.
      if self.manager == nil {
        let manager = ConnectionManager(serviceID: self.service, strategy: .cluster, queue: .main)
        manager.delegate = self
        let advertiser = Advertiser(connectionManager: manager)
        let discoverer = Discoverer(connectionManager: manager)
        advertiser.delegate = self; discoverer.delegate = self
        self.manager = manager; self.advertiser = advertiser; self.discoverer = discoverer
      }
      let generation = self.generation
      self.starting = (generation, promise)
      self.advertiser?.startAdvertising(using: Data(self.name.utf8), mediums: self.localMediums) { [weak self] error in
        // Nearby completion handlers are not delegate callbacks and may run on
        // a worker queue. All session state and lifecycle changes belong to main.
        DispatchQueue.main.async { [weak self] in
          guard let self, self.running, self.generation == generation else { return }
          if let error { self.finishStart(generation, error: error); return }
          self.discoverer?.startDiscovery(mediums: self.localMediums) { [weak self] error in
            DispatchQueue.main.async { [weak self] in
              self?.finishStart(generation, error: error)
            }
          }
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("stop") { self.stopMesh() }.runOnQueue(.main)
    AsyncFunction("connect") { (peer: String, promise: Promise) in
      guard self.running, self.connected.count + self.verification.count < 2, let discoverer = self.discoverer else { promise.reject("E_CONNECT", "Nearby session is full or paused."); return }
      discoverer.requestConnection(to: peer, using: Data(self.name.utf8), mediums: self.localMediums) { error in
        if let error { promise.reject(error) } else { promise.resolve() }
      }
    }.runOnQueue(.main)
    AsyncFunction("verify") { (peer: String, accept: Bool) in
      guard let handler = self.verification.removeValue(forKey: peer), self.running else { throw self.failure("No pairing request.") }
      handler(accept)
    }.runOnQueue(.main)
    AsyncFunction("disconnect") { (peer: String) in self.manager?.disconnect(from: peer) }.runOnQueue(.main)
    AsyncFunction("sendControl") { (peer: String, text: String, promise: Promise) in
      guard self.connected.contains(peer), text.utf8.count <= 8192, let manager = self.manager else { promise.reject("E_CONTROL", "Invalid control payload."); return }
      _ = manager.send(Data(text.utf8), to: [peer]) { error in if let error { promise.reject(error) } else { promise.resolve() } }
    }.runOnQueue(.main)
    AsyncFunction("expectFile") { (peer: String, bytes: Int64) in
      guard self.connected.contains(peer), self.expected.isEmpty, bytes > 0, bytes <= self.maxFile else { throw self.failure("File admission denied.") }
      let space = try FileManager.default.attributesOfFileSystem(forPath: self.cache.path)[.systemFreeSize] as? NSNumber
      guard let space, space.int64Value > bytes * 3 + 10 * 1024 * 1024 else { throw self.failure("Not enough device storage.") }
      self.expected[peer] = bytes
    }.runOnQueue(.main)
    AsyncFunction("sendFile") { (peer: String, uri: String, promise: Promise) in
      do {
        guard self.connected.contains(peer), self.sending.isEmpty, let manager = self.manager else { throw self.failure("File transfer unavailable.") }
        let url = try self.ownedURL(uri)
        let size = try self.fileSize(url)
        guard size > 0, size <= self.maxFile else { throw self.failure("Media exceeds the wire limit.") }
        let id = Int64.random(in: 1...Int64.max)
        let token = manager.sendResource(at: url, withName: "media.bin", to: [peer], id: id) { error in
          if let error { self.sending.removeValue(forKey: peer); promise.reject(error) } else { promise.resolve() }
        }
        self.sending[peer] = (id, token)
      } catch { promise.reject(error) }
    }.runOnQueue(.main)
    AsyncFunction("cancelFile") { (peer: String) in self.cancelFile(peer) }.runOnQueue(.main)
    AsyncFunction("hashFile") { (uri: String, promise: Promise) in
      self.io.async {
        do {
          let url = try self.ownedURL(uri)
          let size = try self.fileSize(url)
          guard size > 0, size <= self.maxFile else { throw self.failure("Media exceeds the wire limit.") }
          let handle = try FileHandle(forReadingFrom: url)
          defer { try? handle.close() }
          var hash = SHA256()
          while let data = try handle.read(upToCount: 64 * 1024), !data.isEmpty { hash.update(data: data) }
          promise.resolve(["hash": hash.finalize().map { String(format: "%02x", $0) }.joined(), "bytes": size] as [String: Any])
        } catch { promise.reject(error) }
      }
    }
    AsyncFunction("inspectMedia") { (uri: String, promise: Promise) in
      Task {
        do { promise.resolve(try await self.inspect(self.ownedURL(uri))) } catch { promise.reject(error) }
      }
    }
    OnAppEntersBackground { self.stopOnMain() }
    OnDestroy { self.stopOnMain() }
  }

  private func failure(_ text: String) -> NSError { NSError(domain: "PiperNearby", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
  private func finishStart(_ generation: Int, error: Error?) {
    guard self.generation == generation, let pending = starting, pending.generation == generation else { return }
    starting = nil
    if let error {
      NSLog("PiperNearby startup failed: %@", error.localizedDescription)
      stopMesh()
      pending.promise.reject(error)
    } else { pending.promise.resolve() }
  }
  private func stopOnMain() {
    if Thread.isMainThread { stopMesh() }
    else { DispatchQueue.main.async { [weak self] in self?.stopMesh() } }
  }
  private func emit(_ value: [String: Any]) { if running { sendEvent("onEvent", value) } }
  private func ownedURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw failure("Only app-owned files can be used.") }
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL
    let roots = [FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0], FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]]
    guard roots.contains(where: { resolved.path.hasPrefix($0.resolvingSymlinksInPath().path + "/") }) else { throw failure("Invalid local media file.") }
    return resolved
  }
  private func fileSize(_ url: URL) throws -> Int64 { (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0 }
  private func cancelFile(_ peer: String) {
    expected.removeValue(forKey: peer)
    sending.removeValue(forKey: peer)?.token.cancel()
    for (id, entry) in incoming.filter({ $0.value.peer == peer }) {
      entry.token.cancel(); try? FileManager.default.removeItem(at: entry.url); incoming.removeValue(forKey: id)
    }
  }
  private func stopMesh() {
    let wasRunning = running
    running = false
    generation += 1
    let pending = starting
    starting = nil
    pending?.promise.reject("E_NEARBY_CANCELLED", "Nearby startup was interrupted. Return to PiperNet and try again.")
    if wasRunning { advertiser?.stopAdvertising(); discoverer?.stopDiscovery() }
    let handlers = Array(verification.values)
    verification.removeAll()
    handlers.forEach { $0(false) }
    for peer in connected { cancelFile(peer); manager?.disconnect(from: peer) }
    connected.removeAll(); expected.removeAll(); names.removeAll(); progressAt.removeAll()
  }
  private func inspect(_ url: URL) async throws -> [String: Any] {
    let size = try fileSize(url)
    guard size > 0, size <= maxFile else { throw failure("Invalid incoming media size.") }
    let handle = try FileHandle(forReadingFrom: url)
    let header = try handle.read(upToCount: 12) ?? Data()
    try handle.close()
    if header.starts(with: [0xff, 0xd8]) {
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetType(source) as String? == UTType.jpeg.identifier,
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
        (1...640).contains(width), (1...640).contains(height) else { throw failure("Invalid incoming photo.") }
      return ["kind": "photo", "width": width, "height": height, "bytes": size]
    }
    guard header.count == 12, String(data: header.subdata(in: 4..<8), encoding: .ascii) == "ftyp" else { throw failure("Unsupported media container.") }
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw failure("Missing video track.") }
    let duration = try await asset.load(.duration).seconds
    let dimensions = try await track.load(.naturalSize)
    let descriptions = try await track.load(.formatDescriptions)
    guard duration.isFinite, duration > 0, duration <= 60.5, dimensions.width > 0, dimensions.height > 0,
      dimensions.width <= 640, dimensions.height <= 640,
      descriptions.contains(where: { CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264 }) else { throw failure("Invalid incoming video format, dimensions or duration.") }
    return ["kind": "video", "width": dimensions.width, "height": dimensions.height, "duration": duration, "bytes": size]
  }
}

extension PiperNearbyModule: AdvertiserDelegate, DiscovererDelegate, ConnectionManagerDelegate {
  public func advertiser(_ advertiser: Advertiser, didReceiveConnectionRequestFrom endpointID: EndpointID, with context: Data, connectionRequestHandler: @escaping (Bool) -> Void) {
    guard advertiser === self.advertiser, running, context.count <= 128, connected.count + verification.count < 2 else { connectionRequestHandler(false); return }
    names[endpointID] = String(data: context, encoding: .utf8) ?? "Nearby"
    connectionRequestHandler(true) // Opens only the verification stage, never auto-accepts the secure connection.
  }
  public func discoverer(_ discoverer: Discoverer, didFind endpointID: EndpointID, with context: Data) {
    guard discoverer === self.discoverer, context.count <= 128 else { return }
    names[endpointID] = String(data: context, encoding: .utf8) ?? "Nearby"
    emit(["type": "found", "peerId": endpointID, "name": names[endpointID]!])
  }
  public func discoverer(_ discoverer: Discoverer, didLose endpointID: EndpointID) { if discoverer === self.discoverer { emit(["type": "lost", "peerId": endpointID]) } }
  public func connectionManager(_ connectionManager: ConnectionManager, didReceive verificationCode: String, from endpointID: EndpointID, verificationHandler: @escaping (Bool) -> Void) {
    guard connectionManager === manager, running, connected.count + verification.count < 2 else { verificationHandler(false); return }
    verification[endpointID] = verificationHandler
    emit(["type": "pairing", "peerId": endpointID, "name": names[endpointID] ?? "Nearby", "code": verificationCode])
    let generation = self.generation
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
      guard self.generation == generation else { return }
      if let handler = self.verification.removeValue(forKey: endpointID) { handler(false) }
    }
  }
  public func connectionManager(_ connectionManager: ConnectionManager, didChangeTo state: ConnectionState, for endpointID: EndpointID) {
    guard connectionManager === manager else { return }
    switch state {
    case .connected:
      guard running, connected.count < 2 else { connectionManager.disconnect(from: endpointID); return }
      connected.insert(endpointID); emit(["type": "connected", "peerId": endpointID])
    case .disconnected, .rejected:
      connected.remove(endpointID); verification.removeValue(forKey: endpointID); cancelFile(endpointID)
      emit(["type": "disconnected", "peerId": endpointID])
    case .connecting: break
    }
  }
  public func connectionManager(_ connectionManager: ConnectionManager, didReceive data: Data, withID payloadID: PayloadID, from endpointID: EndpointID) {
    guard connectionManager === manager, connected.contains(endpointID), data.count <= 8192, let text = String(data: data, encoding: .utf8) else { connectionManager.disconnect(from: endpointID); return }
    emit(["type": "control", "peerId": endpointID, "text": text])
  }
  public func connectionManager(_ connectionManager: ConnectionManager, didReceive stream: InputStream, withID payloadID: PayloadID, from endpointID: EndpointID, cancellationToken token: CancellationToken) { token.cancel(); stream.close() }
  public func connectionManager(_ connectionManager: ConnectionManager, didStartReceivingResourceWithID payloadID: PayloadID, from endpointID: EndpointID, at localURL: URL, withName name: String, cancellationToken token: CancellationToken) {
    guard connectionManager === manager, connected.contains(endpointID), expected[endpointID] != nil, !incoming.values.contains(where: { $0.peer == endpointID }) else { token.cancel(); try? FileManager.default.removeItem(at: localURL); return }
    incoming[payloadID] = (endpointID, localURL, token)
  }
  public func connectionManager(_ connectionManager: ConnectionManager, didReceiveTransferUpdate update: TransferUpdate, from endpointID: EndpointID, forPayload payloadID: PayloadID) {
    guard connectionManager === manager else { return }
    let entry = incoming[payloadID]
    let isSending = sending[endpointID]?.id == payloadID
    guard entry != nil || isSending else { return }
    switch update {
    case .progress(let progress):
      let limit = entry != nil ? expected[endpointID] ?? 0 : maxFile
      guard progress.totalUnitCount <= limit, progress.completedUnitCount <= limit else {
        cancelFile(endpointID); emit(["type": "error", "message": "Nearby peer exceeded the file limit."]); return
      }
      let now = Date.timeIntervalSinceReferenceDate
      if now - (progressAt[payloadID] ?? 0) >= 0.5 {
        progressAt[payloadID] = now
        emit(["type": "progress", "peerId": endpointID, "direction": isSending ? "sending" : "receiving", "bytes": progress.completedUnitCount, "total": progress.totalUnitCount])
      }
    case .success:
      progressAt.removeValue(forKey: payloadID)
      if isSending { sending.removeValue(forKey: endpointID) }
      if let entry {
        incoming.removeValue(forKey: payloadID)
        let size = expected.removeValue(forKey: endpointID) ?? 0
        do {
          guard try fileSize(entry.url) == size else { throw failure("Incomplete incoming media.") }
          let destination = cache.appendingPathComponent(UUID().uuidString + ".bin")
          try FileManager.default.moveItem(at: entry.url, to: destination)
          emit(["type": "file", "peerId": endpointID, "uri": destination.absoluteString])
        } catch { try? FileManager.default.removeItem(at: entry.url); emit(["type": "error", "message": "Couldn’t save incoming media."]) }
      }
    case .failure, .canceled:
      progressAt.removeValue(forKey: payloadID); cancelFile(endpointID)
      emit(["type": "error", "message": "Nearby transfer interrupted. It will retry."])
    }
  }
}
