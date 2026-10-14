package expo.modules.piperble

import androidx.annotation.Keep

@Keep
internal object BleCore {
  init {
    System.loadLibrary("piperble")
  }

  external fun create(name: String, initiator: Boolean): Long

  external fun free(session: Long)

  external fun receive(session: Long, bytes: ByteArray): Int

  external fun peek(session: Long, capacity: Int): ByteArray?

  external fun consume(session: Long, count: Int)

  external fun event(session: Long): Array<String>?

  external fun control(session: Long, text: String): Int

  external fun expect(session: Long, path: String, hash: String, total: Int): Int

  external fun sendFile(session: Long, path: String, hash: String): Int

  external fun cancel(session: Long): Int

  external fun busy(session: Long): Boolean

  external fun failed(session: Long): Boolean
}
