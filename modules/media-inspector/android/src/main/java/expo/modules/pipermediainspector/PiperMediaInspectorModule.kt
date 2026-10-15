package expo.modules.pipermediainspector

import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class PiperMediaInspectorModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext)

  private val maxFile = 5L * 1024 * 1024

  override fun definition() = ModuleDefinition {
    Name("PiperMediaInspector")
    AsyncFunction("hashFile") { uri: String ->
      val file = localFile(uri)
      require(file.length() in 1..maxFile) { "Media exceeds the wire limit." }
      val hash = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          hash.update(buffer, 0, count)
        }
      }
      mapOf(
        "hash" to hash.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) },
        "bytes" to file.length(),
      )
    }
    AsyncFunction("inspectMedia") { uri: String -> inspect(localFile(uri)) }
  }

  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Only app-owned files can be used." }
    val file = File(requireNotNull(parsed.path)).canonicalFile
    val roots = listOf(context.filesDir, context.cacheDir).map { it.canonicalPath + File.separator }
    require(roots.any { file.path.startsWith(it) } && file.isFile) { "Invalid local media file." }
    return file
  }

  private fun inspect(file: File): Map<String, Any> {
    require(file.length() in 1..maxFile)
    val header = ByteArray(12)
    FileInputStream(file).use { require(it.read(header) == header.size) }
    if ((header[0].toInt() and 0xff) == 0xff && (header[1].toInt() and 0xff) == 0xd8) {
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, options)
      require(
        options.outMimeType == "image/jpeg" &&
          options.outWidth in 1..640 &&
          options.outHeight in 1..640
      ) {
        "Invalid incoming photo."
      }
      return mapOf(
        "kind" to "photo",
        "width" to options.outWidth,
        "height" to options.outHeight,
        "bytes" to file.length(),
      )
    }
    require(String(header, 4, 4, Charsets.US_ASCII) == "ftyp") { "Unsupported media container." }
    val retriever = MediaMetadataRetriever()
    val extractor = MediaExtractor()
    try {
      retriever.setDataSource(file.path)
      extractor.setDataSource(file.path)
      val width =
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 0
      val height =
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 0
      val duration =
        (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDouble()
          ?: 0.0) / 1000
      require(width in 1..640 && height in 1..640 && duration > 0 && duration <= 60.5) {
        "Invalid incoming video dimensions or duration."
      }
      require(
        (0 until extractor.trackCount).any {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == "video/avc"
        }
      ) {
        "Video must use H.264."
      }
      return mapOf(
        "kind" to "video",
        "width" to width,
        "height" to height,
        "duration" to duration,
        "bytes" to file.length(),
      )
    } finally {
      retriever.release()
      extractor.release()
    }
  }
}
