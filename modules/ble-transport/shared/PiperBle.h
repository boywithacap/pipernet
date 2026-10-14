#ifndef PIPER_BLE_H
#define PIPER_BLE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* All calls for a session must run on one serial radio queue. Never share a
   session between links. GATT must deliver bytes in order with backpressure. */
typedef struct PiperBle PiperBle;
enum {
  PB_READY = 1,
  PB_CONTROL = 2,
  PB_FILE = 3,
  PB_SENT = 4,
  PB_RECEIVED = 5
};
PiperBle *pb_create(const char *name, int initiator);
void pb_free(PiperBle *p);
int pb_receive(PiperBle *p, const uint8_t *data, size_t size);
/* Peek/consume: do not consume until the OS has accepted the
 * write/notification. */
size_t pb_peek(PiperBle *p, uint8_t *data, size_t capacity);
void pb_consume(PiperBle *p, size_t size);
int pb_event(PiperBle *p, char *text, size_t capacity, uint32_t *bytes,
             uint32_t *total);
int pb_control(PiperBle *p, const char *text);
int pb_expect(PiperBle *p, const char *path, const char *hash, uint32_t total);
int pb_send_file(PiperBle *p, const char *path, const char *hash);
int pb_cancel(PiperBle *p);
int pb_busy(PiperBle *p);
int pb_failed(PiperBle *p);
#ifdef __cplusplus
}
#endif
#endif
