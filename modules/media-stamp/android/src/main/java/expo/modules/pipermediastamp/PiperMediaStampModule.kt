package expo.modules.pipermediastamp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

@androidx.annotation.OptIn(UnstableApi::class)
class PiperMediaStampModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private data class Export(val transformer: Transformer, val output: File, val bitmap: Bitmap, val promise: Promise)
  private val exports = mutableMapOf<String, Export>()
  @Volatile private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("PiperMediaStamp")
    AsyncFunction("stampPhoto") { uri: String, text: String, quality: Double ->
      validateText(text)
      require(quality.isFinite() && quality > 0 && quality <= 1) { "Invalid photo quality." }
      val source = ownedFile(uri)
      // Inspect dimensions before allocating a bitmap.
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(source.path, bounds)
      validateSize(bounds.outWidth, bounds.outHeight)
      val original = BitmapFactory.decodeFile(source.path) ?: error("Couldn’t read the photo.")
      val image = original.copy(Bitmap.Config.ARGB_8888, true)
      original.recycle()
      requireNotNull(image) { "Couldn’t timestamp the photo." }
      val output = outputFile("jpg")
      try {
        drawStamp(Canvas(image), text, image.width, image.height)
        output.outputStream().use {
          check(image.compress(Bitmap.CompressFormat.JPEG, (quality * 100).toInt(), it)) { "Couldn’t timestamp the photo." }
        }
        Uri.fromFile(output).toString()
      } catch (error: Throwable) {
        output.delete()
        throw error
      } finally { image.recycle() }
    }
    AsyncFunction("stampVideo") { uri: String, text: String, promise: Promise ->
      try {
        validateText(text)
        val source = ownedFile(uri)
        val metadata = MediaMetadataRetriever()
        val width: Int
        val height: Int
        try {
          metadata.setDataSource(source.path)
          val w = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
          val h = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
          val rotation = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
          val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
          require(duration in 1..60_500) { "Record a video of 60 seconds or less." }
          width = if (rotation == 90 || rotation == 270) h else w
          height = if (rotation == 90 || rotation == 270) w else h
        } finally { metadata.release() }
        validateSize(width, height)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        drawStamp(Canvas(bitmap), text, width, height)
        main.post { startExport(source, bitmap, promise) }
      } catch (error: Throwable) { promise.reject("ERR_MEDIA_STAMP", error.message, error) }
    }
    OnDestroy {
      destroyed = true
      main.post {
        val pending = exports.values.toList()
        exports.clear()
        pending.forEach {
          it.transformer.cancel()
          it.output.delete()
          it.bitmap.recycle()
          it.promise.reject("ERR_MEDIA_STAMP", "Video timestamping was interrupted.", null)
        }
      }
    }
  }

  private fun ownedFile(uri: String): File {
    val context = appContext.reactContext ?: error("Capture context unavailable.")
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Invalid capture file." }
    val file = File(requireNotNull(parsed.path)).canonicalFile
    require(file.path.startsWith(context.cacheDir.canonicalPath + File.separator)) { "Only temporary captures can be timestamped." }
    require(file.isFile) { "Capture file unavailable." }
    return file
  }

  private fun outputFile(extension: String): File = File(
    (appContext.reactContext ?: error("Capture context unavailable.")).cacheDir,
    "piper-stamp-${UUID.randomUUID()}.$extension",
  )

  private fun validateText(text: String) {
    require(text.length <= 64 && text.split('\n').size == 2) { "Invalid capture timestamp." }
  }

  private fun validateSize(width: Int, height: Int) {
    require(width in 32..640 && height in 32..640) { "Invalid capture dimensions." }
  }

  private fun drawStamp(canvas: Canvas, text: String, width: Int, height: Int) {
    val edge = min(width, height).toFloat()
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
      textSize = max(10f, edge * 0.055f)
    }
    val lines = text.split('\n')
    val padding = max(4f, edge * 0.02f)
    val margin = padding * 1.5f
    val lineHeight = paint.fontSpacing
    val rect = RectF(margin, height - lineHeight * 2 - padding * 2 - margin,
      margin + lines.maxOf { paint.measureText(it) } + padding * 2, height - margin)
    canvas.drawRoundRect(rect, padding, padding, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(166, 0, 0, 0) })
    lines.forEachIndexed { index, line ->
      canvas.drawText(line, rect.left + padding, rect.top + padding - paint.fontMetrics.ascent + index * lineHeight, paint)
    }
  }

  private fun startExport(source: File, bitmap: Bitmap, promise: Promise) {
    var output: File? = null
    try {
      check(!destroyed) { "Video timestamping was interrupted." }
      val context = appContext.reactContext ?: error("Capture context unavailable.")
      val destination = outputFile("mp4")
      output = destination
      val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(source)))
        .setEffects(Effects(emptyList(), listOf(OverlayEffect(listOf(BitmapOverlay.createStaticBitmapOverlay(bitmap))))))
        .build()
      val encoder = DefaultEncoderFactory.Builder(context)
        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(800_000).build())
        .build()
      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setEncoderFactory(encoder)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, result: ExportResult) {
            exports.remove(destination.path) ?: return
            bitmap.recycle()
            promise.resolve(Uri.fromFile(destination).toString())
          }
          override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
            exports.remove(destination.path) ?: return
            destination.delete()
            bitmap.recycle()
            promise.reject("ERR_MEDIA_STAMP", "Couldn’t timestamp the video.", exception)
          }
        }).build()
      exports[destination.path] = Export(transformer, destination, bitmap, promise)
      // Transformer preserves audio and handles the source's display rotation.
      transformer.start(item, destination.path)
    } catch (error: Throwable) {
      output?.let { exports.remove(it.path)?.transformer?.cancel(); it.delete() }
      bitmap.recycle()
      promise.reject("ERR_MEDIA_STAMP", error.message, error)
    }
  }
}
