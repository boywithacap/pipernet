#include "PiperBle.h"
#include <noise/protocol.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define MAX_FRAME 8220
#define MAX_QUEUE (64 * 1024)
#define MAX_FILE (5 * 1024 * 1024)
#define CHUNK 4096
/* Encrypted record types; 2-byte big-endian length prefixes are untrusted. */
enum { IDENTITY = 0, CONTROL = 1, START = 2, ACK = 3, DATA = 4, CANCEL = 5 };
typedef struct Packet {
  struct Packet *next;
  size_t size, offset;
  uint8_t data[];
} Packet;
typedef struct Event {
  struct Event *next;
  int type;
  uint32_t bytes, total;
  char text[];
} Event;
struct PiperBle {
  NoiseHandshakeState *handshake;
  NoiseCipherState *tx, *rx;
  int failed, ready, event_count;
  char name[41];
  Packet *head, *tail;
  size_t queued, used, needed;
  uint8_t input[MAX_FRAME + 2];
  Event *events, *last_event;
  FILE *sending, *receiving;
  uint8_t send_id[32], receive_id[32];
  uint32_t send_total, send_offset, receive_total, receive_offset;
  int waiting_ack, started;
  char receive_path[1024];
};
static int fail(PiperBle *p) {
  if (p)
    p->failed = 1;
  return -1;
}
static uint32_t u32(const uint8_t *b) {
  return ((uint32_t)b[0] << 24) | ((uint32_t)b[1] << 16) |
         ((uint32_t)b[2] << 8) | b[3];
}
static void put32(uint8_t *b, uint32_t n) {
  b[0] = n >> 24;
  b[1] = n >> 16;
  b[2] = n >> 8;
  b[3] = n;
}
static int valid_name(const char *s) {
  if (!s || strlen(s) != 40 || strncmp(s, "PN1:", 4))
    return 0;
  for (int i = 4; i < 40; i++) {
    if (i == 12 || i == 17 || i == 22 || i == 27) {
      if (s[i] != '-')
        return 0;
    } else if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f')))
      return 0;
  }
  return s[18] == '4' &&
         (s[23] == '8' || s[23] == '9' || s[23] == 'a' || s[23] == 'b');
}
static int hex_id(const char *s, uint8_t *id) {
  if (!s || strlen(s) != 64)
    return -1;
  for (int i = 0; i < 32; i++) {
    unsigned n = 0;
    for (int j = 0; j < 2; j++) {
      char c = s[2 * i + j];
      if (c >= '0' && c <= '9')
        n = n * 16 + c - '0';
      else if (c >= 'a' && c <= 'f')
        n = n * 16 + c - 'a' + 10;
      else
        return -1;
    }
    id[i] = n;
  }
  return 0;
}
static int event(PiperBle *p, int type, const char *text, uint32_t bytes,
                 uint32_t total) {
  if (p->event_count >= 32)
    return fail(p);
  size_t n = strlen(text);
  Event *e = calloc(1, sizeof(Event) + n + 1);
  if (!e)
    return fail(p);
  e->type = type;
  e->bytes = bytes;
  e->total = total;
  memcpy(e->text, text, n + 1);
  if (p->last_event)
    p->last_event->next = e;
  else
    p->events = e;
  p->last_event = e;
  p->event_count++;
  return 0;
}
static int enqueue(PiperBle *p, const uint8_t *data, size_t size) {
  if (size > MAX_FRAME || p->queued + size + 2 > MAX_QUEUE)
    return fail(p);
  Packet *q = calloc(1, sizeof(Packet) + size + 2);
  if (!q)
    return fail(p);
  q->size = size + 2;
  q->data[0] = size >> 8;
  q->data[1] = size;
  memcpy(q->data + 2, data, size);
  if (p->tail)
    p->tail->next = q;
  else
    p->head = q;
  p->tail = q;
  p->queued += q->size;
  return 0;
}
static int encrypt(PiperBle *p, const uint8_t *data, size_t size) {
  if (!p || p->failed || !p->tx || size > MAX_FRAME - 16)
    return fail(p);
  uint8_t frame[MAX_FRAME];
  memcpy(frame, data, size);
  NoiseBuffer b;
  noise_buffer_set_inout(b, frame, size, sizeof(frame));
  if (noise_cipherstate_encrypt(p->tx, &b))
    return fail(p);
  return enqueue(p, frame, b.size);
}
static int advance(PiperBle *p) {
  int action = noise_handshakestate_get_action(p->handshake);
  if (action == NOISE_ACTION_WRITE_MESSAGE) {
    uint8_t frame[256];
    NoiseBuffer b;
    noise_buffer_set_output(b, frame, sizeof(frame));
    if (noise_handshakestate_write_message(p->handshake, &b, 0) ||
        enqueue(p, frame, b.size))
      return fail(p);
    action = noise_handshakestate_get_action(p->handshake);
  }
  if (action == NOISE_ACTION_SPLIT) {
    if (noise_handshakestate_split(p->handshake, &p->tx, &p->rx))
      return fail(p);
    noise_handshakestate_free(p->handshake);
    p->handshake = 0;
    uint8_t identity[41];
    identity[0] = IDENTITY;
    memcpy(identity + 1, p->name, 40);
    return encrypt(p, identity, sizeof(identity));
  }
  return action == NOISE_ACTION_READ_MESSAGE ? 0 : fail(p);
}
PiperBle *pb_create(const char *name, int initiator) {
  if (!valid_name(name))
    return 0;
  PiperBle *p = calloc(1, sizeof(PiperBle));
  if (!p)
    return 0;
  memcpy(p->name, name, 41);
  /* NN provides ephemeral link encryption, not trusted-person authentication.
     Auto-joining broadcast peers are untrusted, as with unverified Nearby. */
  const char *prologue = "PiperNet BLE stream v1";
  if (noise_handshakestate_new_by_name(
          &p->handshake, "Noise_NN_25519_ChaChaPoly_SHA256",
          initiator ? NOISE_ROLE_INITIATOR : NOISE_ROLE_RESPONDER) ||
      noise_handshakestate_set_prologue(p->handshake, prologue,
                                        strlen(prologue)) ||
      noise_handshakestate_start(p->handshake) || advance(p)) {
    pb_free(p);
    return 0;
  }
  return p;
}
void pb_free(PiperBle *p) {
  if (!p)
    return;
  if (p->handshake)
    noise_handshakestate_free(p->handshake);
  if (p->tx)
    noise_cipherstate_free(p->tx);
  if (p->rx)
    noise_cipherstate_free(p->rx);
  if (p->sending)
    fclose(p->sending);
  if (p->receiving)
    fclose(p->receiving);
  while (p->head) {
    Packet *q = p->head;
    p->head = q->next;
    free(q);
  }
  while (p->events) {
    Event *e = p->events;
    p->events = e->next;
    free(e);
  }
  memset(p, 0, sizeof(*p));
  free(p);
}
static int send_ack(PiperBle *p) {
  uint8_t b[37];
  b[0] = ACK;
  memcpy(b + 1, p->receive_id, 32);
  put32(b + 33, p->receive_offset);
  return encrypt(p, b, sizeof(b));
}
static int next_chunk(PiperBle *p) {
  uint8_t b[37 + CHUNK];
  b[0] = DATA;
  memcpy(b + 1, p->send_id, 32);
  put32(b + 33, p->send_offset);
  size_t count = p->send_total - p->send_offset;
  if (count > CHUNK)
    count = CHUNK;
  if (fseek(p->sending, p->send_offset, SEEK_SET) ||
      fread(b + 37, 1, count, p->sending) != count)
    return fail(p);
  p->send_offset += count;
  p->waiting_ack = 1;
  return encrypt(p, b, 37 + count);
}
static int record(PiperBle *p, uint8_t *data, size_t size) {
  if (p->handshake) {
    NoiseBuffer b;
    noise_buffer_set_input(b, data, size);
    if (noise_handshakestate_get_action(p->handshake) !=
            NOISE_ACTION_READ_MESSAGE ||
        noise_handshakestate_read_message(p->handshake, &b, 0))
      return fail(p);
    return advance(p);
  }
  NoiseBuffer b;
  noise_buffer_set_inout(b, data, size, size);
  if (!p->rx || noise_cipherstate_decrypt(p->rx, &b) || !b.size)
    return fail(p);
  size = b.size;
  int type = data[0];
  if (type == IDENTITY) {
    if (p->ready || size != 41)
      return fail(p);
    char name[41];
    memcpy(name, data + 1, 40);
    name[40] = 0;
    if (!valid_name(name) || !strcmp(name, p->name))
      return fail(p);
    p->ready = 1;
    return event(p, PB_READY, name, 0, 0);
  }
  if (!p->ready)
    return fail(p);
  if (type == CONTROL) {
    if (size < 2 || size > 8193)
      return fail(p);
    for (size_t i = 1; i < size; i++)
      if (data[i] < 32 || data[i] > 126)
        return fail(p);
    char text[8193];
    memcpy(text, data + 1, size - 1);
    text[size - 1] = 0;
    return event(p, PB_CONTROL, text, 0, 0);
  }
  if (type == START) {
    if (size != 37 || !p->receiving || p->started ||
        memcmp(data + 1, p->receive_id, 32) ||
        u32(data + 33) != p->receive_total)
      return fail(p);
    p->started = 1;
    if (send_ack(p))
      return -1;
    if (p->receive_offset == p->receive_total) {
      fclose(p->receiving);
      p->receiving = 0;
      return event(p, PB_FILE, p->receive_path, 0, 0);
    }
    return 0;
  }
  if (type == ACK) {
    if (size != 37 || !p->sending || memcmp(data + 1, p->send_id, 32))
      return fail(p);
    uint32_t offset = u32(data + 33);
    if (offset > p->send_total || (p->waiting_ack && offset != p->send_offset))
      return fail(p);
    p->send_offset = offset;
    if (event(p, PB_SENT, "", offset, p->send_total))
      return -1;
    if (offset == p->send_total) {
      fclose(p->sending);
      p->sending = 0;
      return 0;
    }
    return next_chunk(p);
  }
  if (type == DATA) {
    if (size <= 37 || size > 37 + CHUNK || !p->receiving || !p->started ||
        memcmp(data + 1, p->receive_id, 32) ||
        u32(data + 33) != p->receive_offset ||
        size - 37 > p->receive_total - p->receive_offset)
      return fail(p);
    size_t count = size - 37;
    if (fwrite(data + 37, 1, count, p->receiving) != count ||
        fflush(p->receiving))
      return fail(p);
    p->receive_offset += count;
    if (send_ack(p) ||
        event(p, PB_RECEIVED, "", p->receive_offset, p->receive_total))
      return -1;
    if (p->receive_offset == p->receive_total) {
      fclose(p->receiving);
      p->receiving = 0;
      return event(p, PB_FILE, p->receive_path, 0, 0);
    }
    return 0;
  }
  if (type == CANCEL) {
    if (size != 33)
      return fail(p);
    if (p->sending && !memcmp(data + 1, p->send_id, 32)) {
      fclose(p->sending);
      p->sending = 0;
    }
    if (p->receiving && !memcmp(data + 1, p->receive_id, 32)) {
      fclose(p->receiving);
      p->receiving = 0;
    }
    return 0;
  }
  return fail(p);
}
int pb_receive(PiperBle *p, const uint8_t *data, size_t size) {
  if (!p || p->failed)
    return -1;
  while (size) {
    size_t target = p->needed ? p->needed + 2 : 2;
    size_t count = target - p->used;
    if (count > size)
      count = size;
    memcpy(p->input + p->used, data, count);
    p->used += count;
    data += count;
    size -= count;
    if (p->used == 2 && !p->needed) {
      p->needed = ((size_t)p->input[0] << 8) | p->input[1];
      if (!p->needed || p->needed > MAX_FRAME)
        return fail(p);
    }
    if (p->needed && p->used == p->needed + 2) {
      if (record(p, p->input + 2, p->needed))
        return -1;
      p->used = 0;
      p->needed = 0;
    }
  }
  return 0;
}
size_t pb_peek(PiperBle *p, uint8_t *data, size_t capacity) {
  if (!p || p->failed || !p->head)
    return 0;
  size_t n = p->head->size - p->head->offset;
  if (n > capacity)
    n = capacity;
  memcpy(data, p->head->data + p->head->offset, n);
  return n;
}
void pb_consume(PiperBle *p, size_t size) {
  if (!p || !p->head || size > p->head->size - p->head->offset) {
    fail(p);
    return;
  }
  p->head->offset += size;
  p->queued -= size;
  if (p->head->offset == p->head->size) {
    Packet *q = p->head;
    p->head = q->next;
    if (!p->head)
      p->tail = 0;
    free(q);
  }
}
int pb_event(PiperBle *p, char *text, size_t capacity, uint32_t *bytes,
             uint32_t *total) {
  if (!p || !p->events || !capacity)
    return 0;
  Event *e = p->events;
  if (strlen(e->text) >= capacity)
    return fail(p);
  strcpy(text, e->text);
  *bytes = e->bytes;
  *total = e->total;
  int type = e->type;
  p->events = e->next;
  if (!p->events)
    p->last_event = 0;
  p->event_count--;
  free(e);
  return type;
}
int pb_control(PiperBle *p, const char *text) {
  if (!p || !p->ready || !text || !strlen(text) || strlen(text) > 8192)
    return fail(p);
  uint8_t b[8193];
  b[0] = CONTROL;
  size_t size = strlen(text);
  for (size_t i = 0; i < size; i++)
    if (text[i] < 32 || text[i] > 126)
      return fail(p);
  memcpy(b + 1, text, size);
  return encrypt(p, b, size + 1);
}
int pb_expect(PiperBle *p, const char *path, const char *hash, uint32_t total) {
  if (!p || !p->ready || p->receiving || !path ||
      strlen(path) >= sizeof(p->receive_path) || !total || total > MAX_FILE ||
      hex_id(hash, p->receive_id))
    return -1;
  FILE *f = fopen(path, "r+b");
  if (!f)
    f = fopen(path, "w+b");
  if (!f)
    return -1;
  if (fseek(f, 0, SEEK_END)) {
    fclose(f);
    return -1;
  }
  long offset = ftell(f);
  if (offset < 0 || (unsigned long)offset > total) {
    fclose(f);
    return -1;
  }
  p->receiving = f;
  p->receive_total = total;
  p->receive_offset = (uint32_t)offset;
  p->started = 0;
  strcpy(p->receive_path, path);
  return 0;
}
int pb_send_file(PiperBle *p, const char *path, const char *hash) {
  if (!p || !p->ready || p->sending || hex_id(hash, p->send_id))
    return -1;
  FILE *f = fopen(path, "rb");
  if (!f)
    return -1;
  if (fseek(f, 0, SEEK_END)) {
    fclose(f);
    return -1;
  }
  long size = ftell(f);
  if (size <= 0 || size > MAX_FILE) {
    fclose(f);
    return -1;
  }
  p->sending = f;
  p->send_total = (uint32_t)size;
  p->send_offset = 0;
  p->waiting_ack = 0;
  uint8_t b[37];
  b[0] = START;
  memcpy(b + 1, p->send_id, 32);
  put32(b + 33, p->send_total);
  return encrypt(p, b, sizeof(b));
}
int pb_cancel(PiperBle *p) {
  if (!p)
    return -1;
  uint8_t b[33];
  b[0] = CANCEL;
  if (p->sending) {
    memcpy(b + 1, p->send_id, 32);
    fclose(p->sending);
    p->sending = 0;
    if (encrypt(p, b, sizeof(b)))
      return -1;
  }
  if (p->receiving) {
    memcpy(b + 1, p->receive_id, 32);
    fclose(p->receiving);
    p->receiving = 0;
    if (encrypt(p, b, sizeof(b)))
      return -1;
  }
  return 0;
}
int pb_busy(PiperBle *p) { return p && (p->sending || p->receiving); }
int pb_failed(PiperBle *p) { return !p || p->failed; }
