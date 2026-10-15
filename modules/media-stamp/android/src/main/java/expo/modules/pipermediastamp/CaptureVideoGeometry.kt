package expo.modules.pipermediastamp

import kotlin.math.max
import kotlin.math.min

internal data class CaptureVideoSize(val width: Int, val height: Int)

/** Camera quality is a preference: CameraX may return 720x480 or an HD fallback. */
internal fun captureVideoSize(width: Int, height: Int, rotation: Int): CaptureVideoSize {
  require(width in 32..8192 && height in 32..8192 && width.toLong() * height <= 33_554_432L) {
    "Invalid capture dimensions."
  }
  val turn = ((rotation % 360) + 360) % 360
  require(turn % 90 == 0) { "Invalid capture orientation." }
  val displayWidth = if (turn == 90 || turn == 270) height else width
  val displayHeight = if (turn == 90 || turn == 270) width else height
  val scale = min(1.0, 640.0 / max(displayWidth, displayHeight))
  // H.264 requires even dimensions. Fit within the budget without upscaling.
  val outputWidth = (displayWidth * scale).toInt() / 2 * 2
  val outputHeight = (displayHeight * scale).toInt() / 2 * 2
  require(outputWidth >= 32 && outputHeight >= 32) { "Invalid capture dimensions." }
  return CaptureVideoSize(outputWidth, outputHeight)
}
