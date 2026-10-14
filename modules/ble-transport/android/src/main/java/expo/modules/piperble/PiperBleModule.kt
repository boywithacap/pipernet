@file:Suppress("DEPRECATION", "MissingPermission")

package expo.modules.piperble

import android.bluetooth.*
import android.bluetooth.le.*
import android.location.LocationManager
import android.net.Uri
import android.os.*
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

private val SERVICE = UUID.fromString("BE516B00-5E69-4F91-A91F-3A86A4C10701")
private val IDENTITY = UUID.fromString("BE516B01-5E69-4F91-A91F-3A86A4C10701")
private val STREAM = UUID.fromString("BE516B02-5E69-4F91-A91F-3A86A4C10701")
private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
private val NAME =
  Regex("^PN1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$")

private class Link(val id: String, val device: BluetoothDevice) {
  var gatt: BluetoothGatt? = null
  var characteristic: BluetoothGattCharacteristic? = null
  var core = 0L
  var mtu = 23
  var writing = false
  var sentCount = 0
  var accepted = false
  var announced = false
  var expectedName: String? = null
  var touched = SystemClock.elapsedRealtime()
  var sentProgressAt = 0L
  var receivedProgressAt = 0L
  val created = SystemClock.elapsedRealtime()
  val earlyControls = mutableListOf<String>()
}

class PiperBleModule : Module() {
  private val worker = HandlerThread("pipernet-ble").apply { start() }
  private val handler = Handler(worker.looper)
  private val context
    get() = requireNotNull(appContext.reactContext)

  private var generation = 0
  private var running = false
  @Volatile private var foreground = true
  private var probing = false
  private var name = ""
  private var startup: Promise? = null
  private var startupAt = 0L
  private var adapter: BluetoothAdapter? = null
  private var server: BluetoothGattServer? = null
  private var stream: BluetoothGattCharacteristic? = null
  private var scanning: ScanCallback? = null
  private var advertising: AdvertiseCallback? = null
  private val links = mutableMapOf<String, Link>()
  private val candidates = mutableMapOf<String, Pair<BluetoothDevice, Long>>()
  private val cooldown = mutableMapOf<String, Long>()
  private val cache
    get() = File(context.cacheDir, "piper-ble")

  private fun emit(event: Map<String, Any>) {
    if (running) sendEvent("onEvent", event)
  }

  private fun task(promise: Promise, action: () -> Unit) {
    handler.post {
      try {
        action()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("E_BLE", e.message ?: "Bluetooth operation failed.", e)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PiperBle")
    Events("onEvent")
    AsyncFunction("start") { displayName: String, promise: Promise ->
      handler.post { start(displayName, promise) }
      Unit
    }
    AsyncFunction("stop") { promise: Promise -> task(promise) { stop() } }
    AsyncFunction("connect") { peer: String -> Unit }
    AsyncFunction("verify") { peer: String, accept: Boolean, promise: Promise ->
      task(promise) { verify(peer, accept) }
    }
    AsyncFunction("disconnect") { peer: String, promise: Promise -> task(promise) { drop(peer) } }
    AsyncFunction("sendControl") { peer: String, text: String, promise: Promise ->
      task(promise) {
        val l = link(peer)
        check(BleCore.control(l.core, text), l)
        flush(l)
      }
    }
    AsyncFunction("expectFile") { peer: String, bytes: Int, hash: String, promise: Promise ->
      task(promise) { expect(peer, bytes, hash) }
    }
    AsyncFunction("sendFile") { peer: String, uri: String, hash: String, promise: Promise ->
      task(promise) {
        val l = link(peer)
        check(BleCore.sendFile(l.core, ownedFile(uri).path, hash), l)
        flush(l)
      }
    }
    AsyncFunction("cancelFile") { peer: String, promise: Promise ->
      task(promise) {
        val l = link(peer)
        check(BleCore.cancel(l.core), l)
        flush(l)
      }
    }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground {
      foreground = false
      handler.post { stop() }
    }
    OnDestroy {
      handler.post {
        stop()
        worker.quitSafely()
      }
    }
  }

  private fun start(displayName: String, promise: Promise) {
    stop()
    try {
      require(foreground) { "Return to PiperNet before starting Bluetooth sharing." }
      val manager =
        context.getSystemService(BluetoothManager::class.java)
          ?: error("Bluetooth LE is unavailable on this phone.")
      val bluetooth = manager.adapter ?: error("Bluetooth LE is unavailable on this phone.")
      require(bluetooth.isEnabled) { "Turn on Bluetooth, then retry." }
      require(
        bluetooth.isMultipleAdvertisementSupported && bluetooth.bluetoothLeAdvertiser != null
      ) {
        "This phone cannot advertise Bluetooth LE for mesh sharing. Try Nearby in Settings."
      }
      if (Build.VERSION.SDK_INT < 31) {
        val location = context.getSystemService(LocationManager::class.java)
        val enabled =
          if (Build.VERSION.SDK_INT >= 28) location?.isLocationEnabled == true
          else
            location?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true ||
              location?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
        require(enabled) {
          "This Android version needs device location services for Bluetooth discovery. PiperNet never collects your location."
        }
      }
      cleanCache()
      adapter = bluetooth
      name = displayName
      probing = !NAME.matches(name)
      running = true
      startup = promise
      startupAt = SystemClock.elapsedRealtime()
      val gen = generation
      server =
        manager.openGattServer(context, serverCallbacks(gen))
          ?: error("Could not open Bluetooth service.")
      val identity =
        BluetoothGattCharacteristic(
          IDENTITY,
          BluetoothGattCharacteristic.PROPERTY_READ,
          BluetoothGattCharacteristic.PERMISSION_READ,
        )
      val stream =
        BluetoothGattCharacteristic(
          STREAM,
          BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
          BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
      stream.addDescriptor(
        BluetoothGattDescriptor(
          CCCD,
          BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        )
      )
      this.stream = stream
      val service = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      service.addCharacteristic(identity)
      service.addCharacteristic(stream)
      require(server?.addService(service) == true) { "Could not publish Bluetooth service." }
      handler.postDelayed(ticker, 1000)
    } catch (e: Exception) {
      startup = null
      stop()
      promise.reject("E_BLE_START", e.message ?: "Allow Bluetooth access and retry.", e)
    }
  }

  private fun stop() {
    running = false
    generation++
    startup?.reject("E_BLE_CANCELLED", "Bluetooth startup was interrupted.", null)
    startup = null
    handler.removeCallbacks(ticker)
    try {
      scanning?.let { adapter?.bluetoothLeScanner?.stopScan(it) }
    } catch (_: Exception) {}
    try {
      advertising?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
    } catch (_: Exception) {}
    scanning = null
    advertising = null
    links.keys.toList().forEach { drop(it) }
    try {
      server?.close()
    } catch (_: Exception) {}
    server = null
    adapter = null
    stream = null
    candidates.clear()
    cooldown.clear()
  }

  private fun later(gen: Int, action: () -> Unit) {
    handler.post {
      if (running && gen == generation)
        try {
          action()
        } catch (e: Exception) {
          emit(mapOf("type" to "error", "message" to (e.message ?: "Bluetooth connection failed.")))
          stop()
        }
    }
  }

  private fun beginRadios(gen: Int) {
    val scan =
      object : ScanCallback() {
        override fun onScanResult(type: Int, result: ScanResult) =
          later(gen) {
            if (!probing) {
              if (candidates.size < 32 || candidates.containsKey(result.device.address))
                candidates[result.device.address] = result.device to SystemClock.elapsedRealtime()
              dial(gen)
            }
          }

        override fun onScanFailed(code: Int) =
          later(gen) { failed("Bluetooth scan failed ($code). Toggle Bluetooth and retry.") }
      }
    scanning = scan
    adapter
      ?.bluetoothLeScanner
      ?.startScan(
        listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()),
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build(),
        scan,
      )
    val advertise =
      object : AdvertiseCallback() {
        override fun onStartSuccess(settings: AdvertiseSettings) =
          later(gen) {
            startup?.resolve(null)
            startup = null
          }

        override fun onStartFailure(code: Int) =
          later(gen) { failed("Bluetooth advertising failed ($code). Try again or use Nearby.") }
      }
    advertising = advertise
    adapter
      ?.bluetoothLeAdvertiser
      ?.startAdvertising(
        AdvertiseSettings.Builder()
          .setConnectable(true)
          .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
          .build(),
        AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE)).build(),
        advertise,
      )
  }

  private fun failed(message: String) {
    val p = startup
    startup = null
    if (p != null) p.reject("E_BLE_START", message, null)
    else emit(mapOf("type" to "error", "message" to message))
    stop()
  }

  private fun identity(): ByteArray {
    val id = if (NAME.matches(name)) UUID.fromString(name.substring(4)) else UUID(0, 0)
    return ByteBuffer.allocate(16)
      .putLong(id.mostSignificantBits)
      .putLong(id.leastSignificantBits)
      .array()
  }

  private fun remoteName(data: ByteArray): String? {
    if (data.size != 16) return null
    val b = ByteBuffer.wrap(data)
    val value = "PN1:" + UUID(b.long, b.long).toString()
    return value.takeIf { NAME.matches(it) }
  }

  private fun serverCallbacks(gen: Int) =
    object : BluetoothGattServerCallback() {
      override fun onServiceAdded(status: Int, service: BluetoothGattService) =
        later(gen) {
          if (status == BluetoothGatt.GATT_SUCCESS) beginRadios(gen)
          else failed("Could not publish Bluetooth service.")
        }

      override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) =
        later(gen) {
          if (newState == BluetoothProfile.STATE_DISCONNECTED) drop("p:" + device.address)
        }

      override fun onMtuChanged(device: BluetoothDevice, mtu: Int) =
        later(gen) { links["p:" + device.address]?.mtu = mtu.coerceIn(23, 517) }

      override fun onCharacteristicReadRequest(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        characteristic: BluetoothGattCharacteristic,
      ) =
        later(gen) {
          val bytes = identity()
          if (characteristic.uuid == IDENTITY && offset in 0..bytes.size)
            server?.sendResponse(
              device,
              requestId,
              BluetoothGatt.GATT_SUCCESS,
              offset,
              bytes.copyOfRange(offset, bytes.size),
            )
          else server?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
        }

      override fun onDescriptorReadRequest(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        descriptor: BluetoothGattDescriptor,
      ) =
        later(gen) {
          server?.sendResponse(
            device,
            requestId,
            if (offset == 0) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_FAILURE,
            offset,
            if (links.containsKey("p:" + device.address))
              BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE,
          )
        }

      override fun onDescriptorWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        descriptor: BluetoothGattDescriptor,
        prepared: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) =
        later(gen) {
          val id = "p:" + device.address
          var ok = !probing && descriptor.uuid == CCCD && !prepared && offset == 0
          if (ok && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
            if (!links.containsKey(id) && links.size < 3) {
              val l = Link(id, device)
              l.core = BleCore.create(name, false)
              if (l.core != 0L) links[id] = l else ok = false
            } else if (!links.containsKey(id)) ok = false
          } else if (ok && value.contentEquals(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE))
            drop(id)
          else ok = false
          if (responseNeeded)
            server?.sendResponse(
              device,
              requestId,
              if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_FAILURE,
              offset,
              null,
            )
          if (!ok) server?.cancelConnection(device)
        }

      override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        prepared: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) =
        later(gen) {
          val l = links["p:" + device.address]
          val ok = l != null && characteristic.uuid == STREAM && !prepared && offset == 0
          if (ok) receive(l!!, value)
          if (responseNeeded)
            server?.sendResponse(
              device,
              requestId,
              if (ok && links[l.id] === l) BluetoothGatt.GATT_SUCCESS
              else BluetoothGatt.GATT_FAILURE,
              offset,
              null,
            )
        }

      override fun onNotificationSent(device: BluetoothDevice, status: Int) =
        later(gen) {
          val l = links["p:" + device.address] ?: return@later
          if (status != BluetoothGatt.GATT_SUCCESS) {
            drop(l.id)
            return@later
          }
          if (l.writing) {
            BleCore.consume(l.core, l.sentCount)
            l.writing = false
            flush(l)
          }
        }
    }

  private fun dial(gen: Int) {
    if (
      !running ||
        probing ||
        links.size >= 3 ||
        links.values.any { it.gatt != null && !it.announced }
    )
      return
    val now = SystemClock.elapsedRealtime()
    val entry =
      candidates.values
        .sortedBy { cooldown[it.first.address] ?: 0 }
        .firstOrNull {
          !links.containsKey("c:" + it.first.address) && (cooldown[it.first.address] ?: 0) <= now
        } ?: return
    val l = Link("c:" + entry.first.address, entry.first)
    links[l.id] = l
    l.gatt =
      entry.first.connectGatt(context, false, clientCallbacks(gen, l), BluetoothDevice.TRANSPORT_LE)
    if (l.gatt == null) drop(l.id)
  }

  private fun clientCallbacks(gen: Int, l: Link) =
    object : BluetoothGattCallback() {
      private fun live(gatt: BluetoothGatt, action: () -> Unit) =
        later(gen) { if (links[l.id] === l && l.gatt === gatt) action() }

      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) =
        live(gatt) {
          if (
            status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED
          )
            drop(l.id)
          else if (newState == BluetoothProfile.STATE_CONNECTED && !gatt.requestMtu(512)) {
            if (!gatt.discoverServices()) drop(l.id)
          }
        }

      override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) =
        live(gatt) {
          if (status == BluetoothGatt.GATT_SUCCESS) l.mtu = mtu.coerceIn(23, 517)
          if (!gatt.discoverServices()) drop(l.id)
        }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) =
        live(gatt) {
          val service = gatt.getService(SERVICE)
          val identity = service?.getCharacteristic(IDENTITY)
          l.characteristic = service?.getCharacteristic(STREAM)
          if (
            status != BluetoothGatt.GATT_SUCCESS ||
              identity == null ||
              l.characteristic == null ||
              !gatt.readCharacteristic(identity)
          )
            drop(l.id)
        }

      private fun identityRead(gatt: BluetoothGatt, value: ByteArray, status: Int) =
        live(gatt) {
          val remote = remoteName(value)
          val characteristic = l.characteristic
          if (
            status != BluetoothGatt.GATT_SUCCESS ||
              remote == null ||
              name >= remote ||
              characteristic == null
          ) {
            drop(l.id)
            return@live
          }
          val descriptor = characteristic.getDescriptor(CCCD)
          l.expectedName = remote
          if (descriptor == null || !gatt.setCharacteristicNotification(characteristic, true)) {
            drop(l.id)
            return@live
          }
          descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          if (!gatt.writeDescriptor(descriptor)) drop(l.id)
        }

      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
      ) {
        if (Build.VERSION.SDK_INT < 33)
          identityRead(gatt, characteristic.value ?: byteArrayOf(), status)
      }

      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int,
      ) {
        identityRead(gatt, value, status)
      }

      override fun onDescriptorWrite(
        gatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        status: Int,
      ) =
        live(gatt) {
          if (status != BluetoothGatt.GATT_SUCCESS || l.core != 0L) {
            drop(l.id)
            return@live
          }
          l.core = BleCore.create(name, true)
          if (l.core == 0L) drop(l.id) else flush(l)
        }

      override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
      ) {
        if (Build.VERSION.SDK_INT < 33)
          incoming(gatt, characteristic.value?.clone() ?: byteArrayOf())
      }

      override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
      ) {
        incoming(gatt, value)
      }

      private fun incoming(gatt: BluetoothGatt, value: ByteArray) = live(gatt) { receive(l, value) }

      override fun onCharacteristicWrite(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
      ) =
        live(gatt) {
          if (status != BluetoothGatt.GATT_SUCCESS) {
            drop(l.id)
            return@live
          }
          if (l.writing) {
            BleCore.consume(l.core, l.sentCount)
            l.writing = false
            flush(l)
          }
        }
    }

  private fun receive(l: Link, bytes: ByteArray) {
    if (l.core == 0L || BleCore.receive(l.core, bytes) != 0) {
      drop(l.id)
      return
    }
    l.touched = SystemClock.elapsedRealtime()
    drain(l)
    if (links[l.id] === l) flush(l)
  }

  private fun flush(l: Link) {
    if (!running || links[l.id] !== l || l.core == 0L || l.writing) return
    if (BleCore.failed(l.core)) {
      drop(l.id)
      return
    }
    val bytes = BleCore.peek(l.core, (l.mtu - 3).coerceIn(20, 512)) ?: return
    l.sentCount = bytes.size
    l.writing = true
    val gatt = l.gatt
    val ok =
      if (gatt != null) {
        val characteristic = l.characteristic ?: return
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        characteristic.value = bytes
        gatt.writeCharacteristic(characteristic)
      } else {
        val characteristic = stream ?: return
        if (Build.VERSION.SDK_INT >= 33)
          server?.notifyCharacteristicChanged(l.device, characteristic, false, bytes) ==
            BluetoothStatusCodes.SUCCESS
        else {
          characteristic.value = bytes
          server?.notifyCharacteristicChanged(l.device, characteristic, false) == true
        }
      }
    if (!ok) drop(l.id)
  }

  private fun drain(l: Link) {
    while (links[l.id] === l) {
      val event = BleCore.event(l.core) ?: break
      when (event[0].toInt()) {
        1 -> {
          if (l.announced || (l.expectedName?.let { it != event[1] } ?: (event[1] >= name))) {
            drop(l.id)
            return
          }
          l.announced = true
          emit(mapOf("type" to "pairing", "peerId" to l.id, "name" to event[1], "code" to ""))
        }
        2 ->
          if (l.accepted) emit(mapOf("type" to "control", "peerId" to l.id, "text" to event[1]))
          else if (l.earlyControls.size < 8) l.earlyControls.add(event[1]) else drop(l.id)
        3 ->
          emit(
            mapOf(
              "type" to "file",
              "peerId" to l.id,
              "uri" to Uri.fromFile(File(event[1])).toString(),
            )
          )
        4,
        5 -> {
          val now = SystemClock.elapsedRealtime()
          val sending = event[0] == "4"
          val lastProgress = if (sending) l.sentProgressAt else l.receivedProgressAt
          if (event[2] == event[3] || now - lastProgress >= 500) {
            if (sending) l.sentProgressAt = now else l.receivedProgressAt = now
            emit(
              mapOf(
                "type" to "progress",
                "peerId" to l.id,
                "direction" to if (sending) "sending" else "receiving",
                "bytes" to event[2].toInt(),
                "total" to event[3].toInt(),
              )
            )
          }
        }
      }
    }
  }

  private fun link(peer: String): Link =
    links[peer]?.takeIf { it.accepted && it.core != 0L }
      ?: error("Bluetooth connection is not ready.")

  private fun verify(peer: String, accept: Boolean) {
    val l = links[peer]?.takeIf { it.announced } ?: error("Bluetooth connection expired.")
    if (!accept) {
      drop(peer)
      return
    }
    if (l.accepted) return
    l.accepted = true
    emit(mapOf("type" to "connected", "peerId" to peer))
    l.earlyControls.forEach { emit(mapOf("type" to "control", "peerId" to peer, "text" to it)) }
    l.earlyControls.clear()
  }

  private fun check(result: Int, l: Link) {
    if (result != 0) {
      drop(l.id)
      error("Bluetooth transfer interrupted. It will retry automatically.")
    }
  }

  private fun drop(id: String) {
    val l = links.remove(id) ?: return
    if (l.core != 0L) {
      BleCore.free(l.core)
      l.core = 0
    }
    try {
      l.gatt?.disconnect()
      l.gatt?.close()
      if (l.gatt == null) server?.cancelConnection(l.device)
    } catch (_: Exception) {}
    cooldown[l.device.address] = SystemClock.elapsedRealtime() + 15000
    if (l.announced) emit(mapOf("type" to "disconnected", "peerId" to id))
  }

  private fun ownedFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Invalid media file." }
    val file = File(requireNotNull(parsed.path)).canonicalFile
    require(
      listOf(context.filesDir, context.cacheDir).any {
        file.path.startsWith(it.canonicalPath + File.separator)
      } && file.isFile
    ) {
      "Invalid media file."
    }
    return file
  }

  private fun expect(peer: String, bytes: Int, hash: String) {
    val l = link(peer)
    require(bytes in 1..5 * 1024 * 1024 && Regex("^[a-f0-9]{64}$").matches(hash)) {
      "Invalid Bluetooth file offer."
    }
    cleanCache(bytes, hash)
    require(cache.usableSpace > bytes.toLong() * 3 + 10 * 1024 * 1024) {
      "Not enough device storage."
    }
    check(BleCore.expect(l.core, File(cache, "$hash.part").path, hash, bytes), l)
  }

  private fun cleanCache(bytes: Int = 0, hash: String? = null) {
    require(cache.exists() || cache.mkdirs()) { "Could not open Bluetooth receive cache." }
    var total = 0L
    var count = 0
    var retained: Long? = null
    cache.listFiles()?.forEach {
      if (System.currentTimeMillis() - it.lastModified() > 86400000 && it.delete()) return@forEach
      total += it.length()
      count++
      if (it.name == "$hash.part") retained = it.length()
    }
    require(
      bytes == 0 ||
        (total + maxOf(0L, bytes.toLong() - (retained ?: 0L)) <= 50L * 1024 * 1024 &&
          count + (if (retained == null) 1 else 0) <= 128)
    ) {
      "Bluetooth receive cache is full. Try again after older transfers expire."
    }
  }

  private val ticker =
    object : Runnable {
      override fun run() {
        if (!running) return
        try {
          val now = SystemClock.elapsedRealtime()
          if (adapter?.isEnabled != true) {
            failed("Turn on Bluetooth, then retry.")
            return
          }
          if (startup != null && now - startupAt > 30000) {
            failed("Bluetooth startup timed out. Allow access and retry.")
            return
          }
          links.values.toList().forEach { l ->
            if (!l.accepted && now - l.created > 20000) drop(l.id)
            else if (
              l.accepted &&
                !BleCore.busy(l.core) &&
                now - l.touched > 30000 &&
                candidates.size > links.size
            )
              drop(l.id)
            else if (now - l.touched > 100000) drop(l.id)
          }
          candidates.entries.removeAll { now - it.value.second > 60000 }
          cooldown.entries.removeAll { it.value <= now }
          dial(generation)
          handler.postDelayed(this, 3000)
        } catch (e: Exception) {
          failed(e.message ?: "Bluetooth stopped. Retry sharing.")
        }
      }
    }
}
