package expo.modules.pipermediastamp

/** Compile alongside CaptureVideoGeometry.kt, then run this fixture on the JVM. */
fun main() {
  val cases =
    listOf(
      // Android's SD quality may be wider than the old 640 px stamp limit.
      listOf(720, 480, 0, 640, 426),
      listOf(720, 480, 90, 426, 640),
      listOf(1920, 1080, 0, 640, 360),
      listOf(1920, 1080, 180, 640, 360),
      listOf(3840, 2160, 270, 360, 640),
      listOf(7680, 4320, 90, 360, 640),
      listOf(640, 480, 0, 640, 480),
      listOf(640, 480, -90, 480, 640),
      listOf(640, 480, 360, 640, 480),
      listOf(641, 481, 0, 640, 480),
      listOf(320, 240, 0, 320, 240),
    )
  for ((width, height, rotation, expectedWidth, expectedHeight) in cases) {
    val actual = captureVideoSize(width, height, rotation)
    check(actual == CaptureVideoSize(expectedWidth, expectedHeight)) {
      "$width x $height at $rotation degrees produced $actual"
    }
    check(actual.width % 2 == 0 && actual.height % 2 == 0)
    check(actual.width <= 640 && actual.height <= 640)
  }
  val invalid =
    listOf(
      listOf(0, 480, 0),
      listOf(640, -1, 0),
      listOf(8193, 480, 0),
      listOf(8192, 8192, 0),
      listOf(Int.MAX_VALUE, Int.MAX_VALUE, 0),
      listOf(640, 480, 45),
      listOf(8192, 32, 0),
    )
  for ((width, height, rotation) in invalid) {
    check(
      runCatching { captureVideoSize(width, height, rotation) }.exceptionOrNull()
        is IllegalArgumentException
    )
  }
  println(
    "Capture video geometry: ${cases.size} valid sizes and ${invalid.size} invalid inputs passed."
  )
}
