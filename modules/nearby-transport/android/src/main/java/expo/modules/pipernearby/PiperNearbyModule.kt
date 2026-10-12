package expo.modules.pipernearby

import android.graphics.BitmapFactory
import android.bluetooth.BluetoothManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.connection.*
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.CancellationException

class PiperNearbyModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val client get() = Nearby.getConnectionsClient(context)
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  @Volatile private var running = false
  @Volatile private var generation = 0
  private var name = "Piper"
  private val verified = mutableSetOf<String>()
  private val pending = mutableSetOf<String>()
  private val expected = mutableMapOf<String, Long>()
  private val received = mutableMapOf<Long, Pair<String, Payload>>()
  private val sending = mutableMapOf<String, Long>()
  private val progressAt = mutableMapOf<Long, Long>()
  private val service = "com.boywithacap.pipernet.mesh.v1"
  private val maxFile = 5L * 1024 * 1024

  private fun emit(event: Map<String, Any>) { if (running) sendEvent("onEvent", event) }
  private fun error(message: String) = emit(mapOf("type" to "error", "message" to message))
  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Only app-owned files can be used." }
    val file = File(requireNotNull(parsed.path)).canonicalFile
    val roots = listOf(context.filesDir, context.cacheDir).map { it.canonicalPath + File.separator }
    require(roots.any { file.path.startsWith(it) } && file.isFile) { "Invalid local media file." }
    return file
  }
  private fun stopMesh() {
    val wasRunning = running
    running = false
    generation++
    if (wasRunning) appContext.reactContext?.let { reactContext ->
      try {
        val connections = Nearby.getConnectionsClient(reactContext)
        connections.stopAdvertising(); connections.stopDiscovery(); connections.stopAllEndpoints()
      } catch (error: RuntimeException) {
        // Revoked permissions or disabled Play services must not crash a lifecycle callback.
        Log.w("PiperNearby", "Could not stop Nearby after a lifecycle change", error)
      }
    }
    received.values.forEach { it.second.asFile()?.asJavaFile()?.delete() }
    verified.clear(); pending.clear(); expected.clear(); received.clear(); sending.clear(); progressAt.clear()
  }

  override fun definition() = ModuleDefinition {
    Name("PiperNearby")
    Events("onEvent")
    AsyncFunction("start") { displayName: String, promise: Promise ->
      stopMesh()
      if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS) {
        promise.reject("E_PLAY_SERVICES", "Update or enable Google Play services to use nearby sharing.", null)
        return@AsyncFunction
      }
      try {
        val bluetooth = context.getSystemService(BluetoothManager::class.java)?.adapter
        if (bluetooth == null || !bluetooth.isEnabled) {
          promise.reject("E_BLUETOOTH_OFF", "Turn on Bluetooth, then try again.", null)
          return@AsyncFunction
        }
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
        if (wifi == null || !wifi.isWifiEnabled) {
          promise.reject("E_WIFI_OFF", "Turn on Wi-Fi, then try again. Internet is not required.", null)
          return@AsyncFunction
        }
        if (Build.VERSION.SDK_INT <= 32) {
          val location = context.getSystemService(LocationManager::class.java)
          val enabled = if (Build.VERSION.SDK_INT >= 28) location?.isLocationEnabled == true
            else location?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true || location?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
          if (!enabled) {
            promise.reject("E_LOCATION_OFF", "Turn on device location services for nearby discovery. PiperNet never collects your location.", null)
            return@AsyncFunction
          }
        }
      } catch (error: SecurityException) {
        promise.reject("E_NEARBY_PERMISSION", "Allow nearby access in device settings, then try again.", error)
        return@AsyncFunction
      }
      // Cache belongs exclusively to this module; recover abandoned copies after process death.
      File(context.cacheDir, "piper-mesh").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
      name = displayName.take(40); running = true
      val startGeneration = generation
      val strategy = Strategy.P2P_CLUSTER
      client.startAdvertising(name, service, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
        .continueWithTask { task ->
          if (!running || generation != startGeneration) throw CancellationException("Nearby startup was interrupted.")
          if (!task.isSuccessful) throw requireNotNull(task.exception)
          client.startDiscovery(service, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build())
        }.addOnSuccessListener {
          if (running && generation == startGeneration) promise.resolve(null)
          else promise.reject("E_NEARBY_CANCELLED", "Return to PiperNet and try again.", null)
        }.addOnFailureListener {
          if (generation == startGeneration) {
            stopMesh()
            Log.w("PiperNearby", "Nearby startup failed", it)
            val statusCode = generateSequence<Throwable>(it) { error -> error.cause }.filterIsInstance<ApiException>().firstOrNull()?.statusCode
            val message = when (statusCode) {
              ConnectionsStatusCodes.MISSING_PERMISSION_BLUETOOTH_ADVERTISE,
              ConnectionsStatusCodes.MISSING_PERMISSION_BLUETOOTH_CONNECT,
              ConnectionsStatusCodes.MISSING_PERMISSION_BLUETOOTH_SCAN,
              ConnectionsStatusCodes.MISSING_PERMISSION_NEARBY_WIFI_DEVICES -> "Allow nearby access in device settings, then try again."
              ConnectionsStatusCodes.MISSING_PERMISSION_ACCESS_COARSE_LOCATION,
              ConnectionsStatusCodes.MISSING_PERMISSION_ACCESS_FINE_LOCATION -> "Allow location access for nearby discovery, then try again. PiperNet never collects your location."
              else -> "Nearby sharing couldn’t start. Check Bluetooth and Wi-Fi, then retry."
            }
            promise.reject("E_NEARBY_START", message, it)
          } else promise.reject("E_NEARBY_CANCELLED", "Return to PiperNet and try again.", it)
        }
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { stopMesh() }.runOnQueue(Queues.MAIN)
    AsyncFunction("connect") { peer: String, promise: Promise ->
      require(running && pending.size + verified.size < 2) { "Nearby session is full or paused." }
      pending.add(peer)
      client.requestConnection(name, peer, lifecycle).addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { pending.remove(peer); promise.reject("E_CONNECT", "Couldn’t connect to nearby phone.", it) }
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("verify") { peer: String, accept: Boolean, promise: Promise ->
      require(running && pending.contains(peer)) { "No pairing request." }
      if (accept) {
        client.acceptConnection(peer, payloads).addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { promise.reject("E_VERIFY", "Pairing failed.", it) }
      } else {
        pending.remove(peer)
        client.rejectConnection(peer).addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { promise.reject("E_VERIFY", "Pairing rejection failed.", it) }
      }
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("disconnect") { peer: String -> client.disconnectFromEndpoint(peer) }.runOnQueue(Queues.MAIN)
    AsyncFunction("sendControl") { peer: String, text: String, promise: Promise ->
      val bytes = text.toByteArray(Charsets.UTF_8)
      require(verified.contains(peer) && bytes.size <= 8192) { "Invalid control payload." }
      client.sendPayload(peer, Payload.fromBytes(bytes)).addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.reject("E_CONTROL", "Nearby link lost.", it) }
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("expectFile") { peer: String, bytes: Long ->
      require(verified.contains(peer) && expected.isEmpty() && bytes in 1..maxFile) { "File admission denied." }
      require(context.filesDir.usableSpace > bytes * 3 + 10 * 1024 * 1024) { "Not enough device storage." }
      expected[peer] = bytes
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("sendFile") { peer: String, uri: String, promise: Promise ->
      require(verified.contains(peer) && sending.isEmpty()) { "File transfer unavailable." }
      val file = localFile(uri)
      require(file.length() in 1..maxFile) { "Media exceeds the wire limit." }
      val payload = Payload.fromFile(file)
      sending[peer] = payload.id
      client.sendPayload(peer, payload).addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { sending.remove(peer); promise.reject("E_FILE", "Nearby file send failed.", it) }
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancelFile") { peer: String ->
      expected.remove(peer)
      sending.remove(peer)?.let { client.cancelPayload(it) }
      received.filterValues { it.first == peer }.keys.toList().forEach { id ->
        client.cancelPayload(id); received.remove(id)?.second?.asFile()?.asJavaFile()?.delete()
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("hashFile") { uri: String ->
      val file = localFile(uri)
      require(file.length() in 1..maxFile) { "Media exceeds the wire limit." }
      val hash = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
      }
      mapOf("hash" to hash.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }, "bytes" to file.length())
    }
    AsyncFunction("inspectMedia") { uri: String -> inspect(localFile(uri)) }
    OnActivityEntersBackground { stopMesh() }
    OnDestroy { stopMesh(); io.shutdownNow() }
  }

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(id: String, info: DiscoveredEndpointInfo) {
      emit(mapOf("type" to "found", "peerId" to id, "name" to info.endpointName.take(40)))
    }
    override fun onEndpointLost(id: String) { emit(mapOf("type" to "lost", "peerId" to id)) }
  }
  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(id: String, info: ConnectionInfo) {
      if (!running || (!pending.contains(id) && pending.size + verified.size >= 2)) { client.rejectConnection(id); return }
      pending.add(id)
      emit(mapOf("type" to "pairing", "peerId" to id, "name" to info.endpointName.take(40), "code" to info.authenticationDigits))
      main.postDelayed({ if (pending.remove(id)) client.rejectConnection(id) }, 60_000)
    }
    override fun onConnectionResult(id: String, result: ConnectionResolution) {
      pending.remove(id)
      if (result.status.isSuccess && running) { verified.add(id); emit(mapOf("type" to "connected", "peerId" to id)) }
      else emit(mapOf("type" to "disconnected", "peerId" to id))
    }
    override fun onDisconnected(id: String) {
      verified.remove(id); pending.remove(id); expected.remove(id); sending.remove(id)
      received.filterValues { it.first == id }.keys.toList().forEach { key -> received.remove(key)?.second?.asFile()?.asJavaFile()?.delete() }
      emit(mapOf("type" to "disconnected", "peerId" to id))
    }
  }
  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(peer: String, payload: Payload) {
      if (!running || !verified.contains(peer)) { client.cancelPayload(payload.id); return }
      when (payload.type) {
        Payload.Type.BYTES -> {
          val bytes = payload.asBytes() ?: return
          if (bytes.size > 8192) { client.disconnectFromEndpoint(peer); return }
          emit(mapOf("type" to "control", "peerId" to peer, "text" to String(bytes, Charsets.UTF_8)))
        }
        Payload.Type.FILE -> {
          if (!expected.containsKey(peer) || received.values.any { it.first == peer }) { client.cancelPayload(payload.id); payload.asFile()?.asJavaFile()?.delete(); return }
          received[payload.id] = peer to payload
        }
        else -> client.cancelPayload(payload.id)
      }
    }
    override fun onPayloadTransferUpdate(peer: String, update: PayloadTransferUpdate) {
      val entry = received[update.payloadId]
      val isSending = sending[peer] == update.payloadId
      if (entry == null && !isSending) return // Ignore byte-message transfer callbacks.
      val limit = if (entry != null) expected[peer] ?: 0L else maxFile
      if (update.totalBytes > limit || update.bytesTransferred > limit) { client.cancelPayload(update.payloadId); error("Nearby peer exceeded the file limit."); return }
      if (update.status == PayloadTransferUpdate.Status.IN_PROGRESS) {
        val now = System.currentTimeMillis()
        if (now - (progressAt[update.payloadId] ?: 0) >= 500) {
          progressAt[update.payloadId] = now
          emit(mapOf("type" to "progress", "peerId" to peer, "direction" to if (isSending) "sending" else "receiving", "bytes" to update.bytesTransferred, "total" to update.totalBytes))
        }
        return
      }
      progressAt.remove(update.payloadId)
      if (isSending) sending.remove(peer)
      if (entry != null) {
        received.remove(update.payloadId)
        val expectedSize = expected.remove(peer) ?: 0L
        if (update.status == PayloadTransferUpdate.Status.SUCCESS && update.bytesTransferred == expectedSize) {
          // Payload descriptors are SDK-owned. Copy a bounded stream to an app-owned cache file;
          // never use the remote filename or put a full video in JavaScript memory.
          val transferGeneration = generation
          io.execute {
            val destination = File(File(context.cacheDir, "piper-mesh"), "${UUID.randomUUID()}.bin")
            try {
              val descriptor = requireNotNull(entry.second.asFile()?.asParcelFileDescriptor())
              android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                FileOutputStream(destination).use { output ->
                  val buffer = ByteArray(64 * 1024); var count = 0L
                  while (true) {
                    val read = input.read(buffer); if (read < 0) break
                    count += read; require(count <= expectedSize); output.write(buffer, 0, read)
                  }
                  require(count == expectedSize); output.fd.sync()
                }
              }
              main.post { if (running && generation == transferGeneration) emit(mapOf("type" to "file", "peerId" to peer, "uri" to Uri.fromFile(destination).toString())) else destination.delete() }
            } catch (_: Exception) { destination.delete(); main.post { error("Couldn’t save incoming media.") } }
            finally { entry.second.asFile()?.asJavaFile()?.delete() }
          }
        } else entry.second.asFile()?.asJavaFile()?.delete()
      }
      if (update.status != PayloadTransferUpdate.Status.SUCCESS) error("Nearby transfer interrupted. It will retry.")
    }
  }

  private fun inspect(file: File): Map<String, Any> {
    require(file.length() in 1..maxFile)
    val header = ByteArray(12)
    FileInputStream(file).use { require(it.read(header) == header.size) }
    if ((header[0].toInt() and 0xff) == 0xff && (header[1].toInt() and 0xff) == 0xd8) {
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, options)
      require(options.outMimeType == "image/jpeg" && options.outWidth in 1..640 && options.outHeight in 1..640) { "Invalid incoming photo." }
      return mapOf("kind" to "photo", "width" to options.outWidth, "height" to options.outHeight, "bytes" to file.length())
    }
    require(String(header, 4, 4, Charsets.US_ASCII) == "ftyp") { "Unsupported media container." }
    val retriever = MediaMetadataRetriever()
    val extractor = MediaExtractor()
    try {
      retriever.setDataSource(file.path); extractor.setDataSource(file.path)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 0
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 0
      val duration = (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDouble() ?: 0.0) / 1000
      require(width in 1..640 && height in 1..640 && duration > 0 && duration <= 60.5) { "Invalid incoming video dimensions or duration." }
      require((0 until extractor.trackCount).any { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == "video/avc" }) { "Video must use H.264." }
      return mapOf("kind" to "video", "width" to width, "height" to height, "duration" to duration, "bytes" to file.length())
    } finally { retriever.release(); extractor.release() }
  }
}
