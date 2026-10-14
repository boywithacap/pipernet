import CoreBluetooth
import ExpoModulesCore
import Foundation
import UIKit

private let bleService = CBUUID(string: "BE516B00-5E69-4F91-A91F-3A86A4C10701")
private let bleIdentity = CBUUID(string: "BE516B01-5E69-4F91-A91F-3A86A4C10701")
private let bleStream = CBUUID(string: "BE516B02-5E69-4F91-A91F-3A86A4C10701")

private final class BleLink {
  let id: String
  var peripheral: CBPeripheral?
  var central: CBCentral?
  var characteristic: CBCharacteristic?
  var session: OpaquePointer?
  var accepted = false
  var writing = false
  var sentCount = 0
  var announced = false
  var expectedName: String?
  var earlyControls: [String] = []
  var touched = Date()
  var sentProgressAt = Date.distantPast
  var receivedProgressAt = Date.distantPast
  let created = Date()
  init(_ id: String) { self.id = id }
  deinit { if let session { pb_free(session) } }
}

public final class PiperBleModule: Module {
  private let radio = BleRadio()
  public func definition() -> ModuleDefinition {
    Name("PiperBle")
    Events("onEvent")
    OnCreate { self.radio.emit = { [weak self] event in self?.sendEvent("onEvent", event) } }
    OnAppEntersBackground { self.radio.queue.async { self.radio.stop() } }
    OnDestroy { self.radio.queue.async { self.radio.stop() } }
    AsyncFunction("start") { (name: String, promise: Promise) in
      guard UIApplication.shared.applicationState == .active else {
        promise.reject("E_BLE_INACTIVE", "Return to PiperNet before starting Bluetooth sharing.")
        return
      }
      self.radio.queue.async { self.radio.start(name, promise) }
    }.runOnQueue(.main)
    AsyncFunction("stop") { (promise: Promise) in self.radio.perform(promise) { self.radio.stop() }
    }
    // BLE owns the bounded discovery queue because the identity is read over GATT.
    AsyncFunction("connect") { (_: String) in }
    AsyncFunction("verify") { (peer: String, accept: Bool, promise: Promise) in
      self.radio.perform(promise) { try self.radio.verify(peer, accept) }
    }
    AsyncFunction("disconnect") { (peer: String, promise: Promise) in
      self.radio.perform(promise) { self.radio.drop(peer) }
    }
    AsyncFunction("sendControl") { (peer: String, text: String, promise: Promise) in
      self.radio.perform(promise) {
        let link = try self.radio.link(peer)
        try self.radio.check(pb_control(link.session, text), link)
        self.radio.flush(link)
      }
    }
    AsyncFunction("expectFile") { (peer: String, bytes: Int, hash: String, promise: Promise) in
      self.radio.perform(promise) { try self.radio.expect(peer, bytes, hash) }
    }
    AsyncFunction("sendFile") { (peer: String, uri: String, hash: String, promise: Promise) in
      self.radio.perform(promise) {
        let link = try self.radio.link(peer)
        let url = try self.radio.ownedFile(uri)
        try self.radio.check(pb_send_file(link.session, url.path, hash), link)
        self.radio.flush(link)
      }
    }
    AsyncFunction("cancelFile") { (peer: String, promise: Promise) in
      self.radio.perform(promise) {
        let link = try self.radio.link(peer)
        try self.radio.check(pb_cancel(link.session), link)
        self.radio.flush(link)
      }
    }
  }
}

private final class BleRadio: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate,
  CBPeripheralDelegate
{
  let queue = DispatchQueue(label: "pipernet.ble", qos: .utility)
  var emit: (([String: Any]) -> Void)?
  private var scanner: CBCentralManager?
  private var advertiser: CBPeripheralManager?
  private var stream: CBMutableCharacteristic?
  private var links: [String: BleLink] = [:]
  private var candidates: [UUID: (CBPeripheral, Date)] = [:]
  private var cooldown: [UUID: Date] = [:]
  private var disconnecting = Set<UUID>()
  private var timer: DispatchSourceTimer?
  private var running = false
  private var probing = false
  private var name = ""
  private var startup: Promise?
  private var startupAt = Date()
  private var serviceAdded = false
  private var cache: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(
      "piper-ble")
  }
  func failure(_ text: String) -> NSError {
    NSError(domain: "PiperBle", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
  }
  func perform(_ promise: Promise, _ work: @escaping () throws -> Void) {
    queue.async {
      do {
        try work()
        promise.resolve()
      } catch { promise.reject(error) }
    }
  }
  func start(_ name: String, _ promise: Promise) {
    stop()
    self.name = name
    probing = !validName(name)
    do { try cleanCache() } catch {
      promise.reject(error)
      return
    }
    running = true
    startup = promise
    startupAt = Date()
    scanner = CBCentralManager(delegate: self, queue: queue)
    advertiser = CBPeripheralManager(delegate: self, queue: queue)
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 1, repeating: 3)
    timer.setEventHandler { [weak self] in self?.tick() }
    timer.resume()
    self.timer = timer
  }
  func stop() {
    running = false
    startup?.reject("E_BLE_CANCELLED", "Bluetooth startup was interrupted.")
    startup = nil
    timer?.cancel()
    timer = nil
    scanner?.stopScan()
    advertiser?.stopAdvertising()
    for link in Array(links.values) {
      if let peripheral = link.peripheral { scanner?.cancelPeripheralConnection(peripheral) }
    }
    links.removeAll()
    candidates.removeAll()
    cooldown.removeAll()
    disconnecting.removeAll()
    advertiser?.removeAllServices()
    scanner?.delegate = nil
    advertiser?.delegate = nil
    scanner = nil
    advertiser = nil
    stream = nil
    serviceAdded = false
  }
  private func startupFailed(_ message: String) {
    let promise = startup
    startup = nil
    if promise != nil {
      stop()
      promise?.reject("E_BLE_START", message)
    } else {
      emit?(["type": "error", "message": message])
      stop()
    }
  }
  private func validName(_ name: String) -> Bool {
    name.range(
      of: "^PN1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
      options: .regularExpression) != nil
  }
  private func identifier(_ name: String) -> Data {
    guard let uuid = UUID(uuidString: String(name.dropFirst(4))) else {
      return Data(repeating: 0, count: 16)
    }
    var bytes = uuid.uuid
    return withUnsafeBytes(of: &bytes) { Data($0) }
  }
  private func remoteName(_ data: Data) -> String? {
    guard data.count == 16 else { return nil }
    let b = [UInt8](data)
    let id = UUID(
      uuid: (
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13],
        b[14], b[15]
      ))
    let name = "PN1:" + id.uuidString.lowercased()
    return validName(name) ? name : nil
  }
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard running, central === scanner else { return }
    if central.state == .poweredOn {
      central.scanForPeripherals(
        withServices: [bleService], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    } else if central.state != .unknown && central.state != .resetting {
      startupFailed(
        central.state == .unauthorized
          ? "Allow Bluetooth access in device settings, then retry."
          : "Turn on Bluetooth, then retry.")
    }
  }
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard running, peripheral === advertiser else { return }
    if peripheral.state == .poweredOn && !serviceAdded {
      serviceAdded = true
      let identity = CBMutableCharacteristic(
        type: bleIdentity, properties: [.read], value: identifier(name), permissions: [.readable])
      let stream = CBMutableCharacteristic(
        type: bleStream, properties: [.write, .notify], value: nil, permissions: [.writeable])
      self.stream = stream
      let service = CBMutableService(type: bleService, primary: true)
      service.characteristics = [identity, stream]
      peripheral.add(service)
    } else if peripheral.state != .poweredOn && peripheral.state != .unknown
      && peripheral.state != .resetting
    {
      startupFailed("Bluetooth is unavailable. Enable Bluetooth access and retry.")
    }
  }
  func peripheralManager(
    _ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?
  ) {
    guard running, peripheral === advertiser else { return }
    if let error {
      startupFailed(error.localizedDescription)
      return
    }
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [bleService]])
  }
  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    guard running, peripheral === advertiser else { return }
    if let error {
      startupFailed(error.localizedDescription)
      return
    }
    startup?.resolve()
    startup = nil
  }
  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber
  ) {
    guard running, !probing, central === scanner else { return }
    if candidates.count < 32 || candidates[peripheral.identifier] != nil {
      candidates[peripheral.identifier] = (peripheral, Date())
    }
    dial()
  }
  private func dial() {
    guard running, !probing, links.count < 3,
      !links.values.contains(where: { $0.peripheral != nil && !$0.announced })
    else { return }
    let now = Date()
    guard
      let candidate = candidates.values.sorted(by: {
        (cooldown[$0.0.identifier] ?? .distantPast) < (cooldown[$1.0.identifier] ?? .distantPast)
      }).first(where: {
        links["c:" + $0.0.identifier.uuidString] == nil && !disconnecting.contains($0.0.identifier)
          && (cooldown[$0.0.identifier] ?? .distantPast) <= now
      })
    else { return }
    let peripheral = candidate.0
    let link = BleLink("c:" + peripheral.identifier.uuidString)
    link.peripheral = peripheral
    links[link.id] = link
    peripheral.delegate = self
    scanner?.connect(peripheral)
  }
  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard running, central === scanner,
      links["c:" + peripheral.identifier.uuidString]?.peripheral === peripheral
    else {
      central.cancelPeripheralConnection(peripheral)
      return
    }
    peripheral.discoverServices([bleService])
  }
  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?
  ) {
    if central === scanner {
      disconnecting.remove(peripheral.identifier)
      retire("c:" + peripheral.identifier.uuidString)
    }
  }
  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?
  ) {
    if central === scanner {
      disconnecting.remove(peripheral.identifier)
      retire("c:" + peripheral.identifier.uuidString)
    }
  }
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    let id = "c:" + peripheral.identifier.uuidString
    guard links[id]?.peripheral === peripheral else { return }
    guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == bleService })
    else {
      drop(id)
      return
    }
    peripheral.discoverCharacteristics([bleIdentity, bleStream], for: service)
  }
  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?
  ) {
    let id = "c:" + peripheral.identifier.uuidString
    guard let link = links[id], link.peripheral === peripheral else { return }
    guard error == nil,
      let identity = service.characteristics?.first(where: { $0.uuid == bleIdentity }),
      let stream = service.characteristics?.first(where: { $0.uuid == bleStream })
    else {
      drop(id)
      return
    }
    link.characteristic = stream
    peripheral.readValue(for: identity)
  }
  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    let id = "c:" + peripheral.identifier.uuidString
    guard let link = links[id], link.peripheral === peripheral else { return }
    guard error == nil, let data = characteristic.value else {
      drop(id)
      return
    }
    if characteristic.uuid == bleIdentity {
      guard let remote = remoteName(data), name < remote, let stream = link.characteristic else {
        drop(id)
        return
      }
      link.expectedName = remote
      peripheral.setNotifyValue(true, for: stream)
    } else if characteristic.uuid == bleStream {
      receive(data, link)
    }
  }
  func peripheral(
    _ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    let id = "c:" + peripheral.identifier.uuidString
    guard let link = links[id], link.peripheral === peripheral else { return }
    guard error == nil, characteristic.isNotifying, link.session == nil,
      let session = pb_create(name, 1)
    else {
      drop(id)
      return
    }
    link.session = session
    flush(link)
  }
  func peripheral(
    _ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    let id = "c:" + peripheral.identifier.uuidString
    guard let link = links[id], link.peripheral === peripheral, link.writing else { return }
    guard error == nil else {
      drop(id)
      return
    }
    pb_consume(link.session, link.sentCount)
    link.writing = false
    flush(link)
  }
  func peripheralManager(
    _ peripheral: CBPeripheralManager, central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic
  ) {
    guard running, !probing, peripheral === advertiser, characteristic.uuid == bleStream,
      links.count < 3
    else { return }
    let id = "p:" + central.identifier.uuidString
    guard links[id] == nil, let session = pb_create(name, 0) else { return }
    let link = BleLink(id)
    link.central = central
    link.session = session
    links[id] = link
  }
  func peripheralManager(
    _ peripheral: CBPeripheralManager, central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic
  ) {
    if peripheral === advertiser { drop("p:" + central.identifier.uuidString) }
  }
  func peripheralManager(
    _ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]
  ) {
    guard peripheral === advertiser, let request = requests.first else { return }
    let id = "p:" + request.central.identifier.uuidString
    // Our stream uses single ATT writes, never prepared/atomic multi-writes.
    // Core Bluetooth requires exactly one response for the entire callback.
    guard requests.count == 1, running, request.characteristic.uuid == bleStream,
      request.offset == 0, let data = request.value, let link = links[id]
    else {
      peripheral.respond(to: request, withResult: .unlikelyError)
      return
    }
    receive(data, link)
    peripheral.respond(to: request, withResult: links[id] != nil ? .success : .unlikelyError)
  }
  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    guard peripheral === advertiser else { return }
    for link in Array(links.values) { flush(link) }
  }
  private func receive(_ data: Data, _ link: BleLink) {
    guard link.session != nil else {
      drop(link.id)
      return
    }
    let result = data.withUnsafeBytes {
      pb_receive(link.session, $0.bindMemory(to: UInt8.self).baseAddress, data.count)
    }
    if result != 0 {
      drop(link.id)
      return
    }
    link.touched = Date()
    drain(link)
    if links[link.id] === link { flush(link) }
  }
  func flush(_ link: BleLink) {
    guard running, links[link.id] === link, let session = link.session, !link.writing else {
      return
    }
    if pb_failed(session) != 0 {
      drop(link.id)
      return
    }
    if let peripheral = link.peripheral, let characteristic = link.characteristic {
      // With-response limits can include long writes, which use ATT prepare/execute.
      // The without-response limit bounds a single ATT payload on this connection.
      let capacity = min(
        512, peripheral.maximumWriteValueLength(for: .withResponse),
        peripheral.maximumWriteValueLength(for: .withoutResponse))
      var bytes = [UInt8](
        repeating: 0, count: capacity)
      let count = pb_peek(session, &bytes, bytes.count)
      guard count > 0 else { return }
      link.writing = true
      link.sentCount = count
      peripheral.writeValue(Data(bytes.prefix(count)), for: characteristic, type: .withResponse)
    } else if let central = link.central, let stream {
      var bytes = [UInt8](repeating: 0, count: min(512, central.maximumUpdateValueLength))
      while true {
        let count = pb_peek(session, &bytes, bytes.count)
        if count == 0 { break }
        guard
          advertiser?.updateValue(
            Data(bytes.prefix(count)), for: stream, onSubscribedCentrals: [central]) == true
        else { break }
        pb_consume(session, count)
      }
    }
  }
  private func drain(_ link: BleLink) {
    var text = [CChar](repeating: 0, count: 8193)
    var bytes: UInt32 = 0
    var total: UInt32 = 0
    while links[link.id] === link {
      let type = pb_event(link.session, &text, text.count, &bytes, &total)
      if type == 0 { break }
      if type < 0 {
        drop(link.id)
        break
      }
      let value = String(cString: text)
      switch type {
      case Int32(PB_READY):
        guard !link.announced,
          link.expectedName.map({ $0 == value }) ?? (value < name)
        else {
          drop(link.id)
          return
        }
        link.announced = true
        emit?(["type": "pairing", "peerId": link.id, "name": value, "code": ""])
      case Int32(PB_CONTROL):
        if link.accepted {
          emit?(["type": "control", "peerId": link.id, "text": value])
        } else if link.earlyControls.count < 8 {
          link.earlyControls.append(value)
        } else {
          drop(link.id)
        }
      case Int32(PB_FILE):
        emit?([
          "type": "file", "peerId": link.id, "uri": URL(fileURLWithPath: value).absoluteString,
        ])
      case Int32(PB_SENT), Int32(PB_RECEIVED):
        let sending = type == PB_SENT
        let lastProgress = sending ? link.sentProgressAt : link.receivedProgressAt
        let now = Date()
        if bytes == total || now.timeIntervalSince(lastProgress) >= 0.5 {
          if sending { link.sentProgressAt = now } else { link.receivedProgressAt = now }
          emit?([
            "type": "progress", "peerId": link.id,
            "direction": sending ? "sending" : "receiving", "bytes": bytes, "total": total,
          ])
        }
      default: drop(link.id)
      }
    }
  }
  func link(_ id: String) throws -> BleLink {
    guard let link = links[id], link.accepted, link.session != nil else {
      throw failure("Bluetooth connection is not ready.")
    }
    return link
  }
  func verify(_ id: String, _ accept: Bool) throws {
    guard let link = links[id], link.announced else {
      throw failure("Bluetooth connection expired.")
    }
    if !accept {
      drop(id)
      return
    }
    if link.accepted { return }
    link.accepted = true
    emit?(["type": "connected", "peerId": id])
    for text in link.earlyControls { emit?(["type": "control", "peerId": id, "text": text]) }
    link.earlyControls.removeAll()
  }
  func check(_ result: Int32, _ link: BleLink) throws {
    if result != 0 {
      drop(link.id)
      throw failure("Bluetooth transfer interrupted. It will retry automatically.")
    }
  }
  private func retire(_ id: String) {
    guard let link = links.removeValue(forKey: id) else { return }
    if let peripheral = link.peripheral {
      cooldown[peripheral.identifier] = Date().addingTimeInterval(15)
    }
    if link.announced { emit?(["type": "disconnected", "peerId": id]) }
  }
  func drop(_ id: String) {
    guard let link = links.removeValue(forKey: id) else { return }
    if let peripheral = link.peripheral {
      cooldown[peripheral.identifier] = Date().addingTimeInterval(15)
      disconnecting.insert(peripheral.identifier)
      scanner?.cancelPeripheralConnection(peripheral)
    }
    // Core Bluetooth has no peripheral-side disconnect API. Ignore further bytes
    // until the central unsubscribes; its write error causes it to close the link.
    if link.announced { emit?(["type": "disconnected", "peerId": id]) }
  }
  func ownedFile(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw failure("Invalid media file.") }
    let file = url.resolvingSymlinksInPath()
    let roots = [
      FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0],
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0],
    ]
    guard roots.contains(where: { file.path.hasPrefix($0.resolvingSymlinksInPath().path + "/") }),
      FileManager.default.fileExists(atPath: file.path)
    else { throw failure("Invalid media file.") }
    return file
  }
  func expect(_ peer: String, _ bytes: Int, _ hash: String) throws {
    let link = try link(peer)
    guard bytes > 0, bytes <= 5 * 1024 * 1024,
      hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    else { throw failure("Invalid Bluetooth file offer.") }
    try cleanCache(reserving: bytes, hash: hash)
    let attrs = try FileManager.default.attributesOfFileSystem(forPath: cache.path)
    guard let space = attrs[.systemFreeSize] as? NSNumber,
      space.int64Value > Int64(bytes * 3 + 10 * 1024 * 1024)
    else { throw failure("Not enough device storage.") }
    try check(
      pb_expect(
        link.session, cache.appendingPathComponent(hash + ".part").path, hash, UInt32(bytes)), link)
  }
  private func cleanCache(reserving bytes: Int = 0, hash: String? = nil) throws {
    try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    let files = try FileManager.default.contentsOfDirectory(
      at: cache, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
    var total = 0
    var count = 0
    var retained: Int?
    for file in files {
      let values = try file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
      if Date().timeIntervalSince(values.contentModificationDate ?? .distantPast) > 86400 {
        try FileManager.default.removeItem(at: file)
      } else {
        total += values.fileSize ?? 0
        count += 1
        if file.lastPathComponent == hash.map({ $0 + ".part" }) {
          retained = values.fileSize ?? 0
        }
      }
    }
    if bytes > 0
      && (total + max(0, bytes - (retained ?? 0)) > 50 * 1024 * 1024
        || count + (retained == nil ? 1 : 0) > 128)
    {
      throw failure("Bluetooth receive cache is full. Try again after older transfers expire.")
    }
  }
  private func tick() {
    guard running else { return }
    let now = Date()
    if startup != nil && now.timeIntervalSince(startupAt) > 30 {
      startupFailed("Bluetooth startup timed out. Allow access and retry.")
      return
    }
    for link in Array(links.values) {
      if !link.accepted && now.timeIntervalSince(link.created) > 20 {
        drop(link.id)
      } else if link.accepted && pb_busy(link.session) == 0
        && now.timeIntervalSince(link.touched) > 30 && candidates.count > links.count
      {
        drop(link.id)
      } else if now.timeIntervalSince(link.touched) > 100 {
        drop(link.id)
      }
    }
    candidates = candidates.filter { now.timeIntervalSince($0.value.1) < 60 }
    cooldown = cooldown.filter { $0.value > now }
    dial()
  }
}
