#include "PiperBle.h"
#include <assert.h>
#include <noise/protocol.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
static const char *alice = "PN1:00000000-0000-4000-8000-000000000001";
static const char *bob = "PN1:00000000-0000-4000-8000-000000000002";
static const char *hash =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
static int ready, controls, files;
static uint32_t sent;
static void events(PiperBle *p) {
  char text[8193];
  uint32_t bytes, total;
  int type;
  while ((type = pb_event(p, text, sizeof(text), &bytes, &total)) > 0) {
    if (type == PB_READY)
      ready++;
    if (type == PB_CONTROL) {
      assert(!strcmp(text, "{\"v\":1,\"type\":\"inventory\",\"ids\":[]}"));
      controls++;
    }
    if (type == PB_FILE) {
      struct stat st;
      assert(!stat(text, &st));
      files++;
    }
    if (type == PB_SENT)
      sent = bytes;
  }
  assert(type == 0);
}
static int ferry(PiperBle *a, PiperBle *b, int mtu) {
  uint8_t bytes[512];
  size_t n = pb_peek(a, bytes, mtu);
  if (!n)
    return 0;
  pb_consume(a, n);
  assert(pb_receive(b, bytes, n) == 0);
  events(b);
  return 1;
}
static void settle(PiperBle *a, PiperBle *b, int mtu) {
  int i = 0;
  while (ferry(a, b, mtu) | ferry(b, a, mtu)) {
    assert(++i < 1000000);
  }
  assert(!pb_failed(a) && !pb_failed(b));
}
static size_t unhex(const char *s, uint8_t *b) {
  size_t n = strlen(s) / 2;
  for (size_t i = 0; i < n; i++) {
    unsigned v;
    assert(sscanf(s + 2 * i, "%2x", &v) == 1);
    b[i] = v;
  }
  return n;
}
/* Independent Cacophony NN vector shipped by Noise-C at the pinned revision. */
static void vector(void) {
  NoiseHandshakeState *a, *b;
  NoiseBuffer payload, wire, plain;
  uint8_t key[32], out[256], received[256], input[256], expected[256];
  assert(!noise_handshakestate_new_by_name(
      &a, "Noise_NN_25519_ChaChaPoly_SHA256", NOISE_ROLE_INITIATOR));
  assert(!noise_handshakestate_new_by_name(
      &b, "Noise_NN_25519_ChaChaPoly_SHA256", NOISE_ROLE_RESPONDER));
  assert(!noise_handshakestate_set_prologue(a, "John Galt", 9));
  assert(!noise_handshakestate_set_prologue(b, "John Galt", 9));
  unhex("893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
        key);
  assert(!noise_dhstate_set_keypair_private(
      noise_handshakestate_get_fixed_ephemeral_dh(a), key, 32));
  unhex("bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
        key);
  assert(!noise_dhstate_set_keypair_private(
      noise_handshakestate_get_fixed_ephemeral_dh(b), key, 32));
  assert(!noise_handshakestate_start(a));
  assert(!noise_handshakestate_start(b));
  const char *messages[] = {"4c756477696720766f6e204d69736573",
                            "4d757272617920526f746862617264"};
  const char *ciphertexts[] = {
      "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c79444c756477"
      "696720766f6e204d69736573",
      "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f144808843a0ff96bd"
      "f86b579ef7dbf94e812a7470b903c20a85a87e3a1fe863264ae547"};
  for (int i = 0; i < 2; i++) {
    size_t n = unhex(messages[i], input),
           length = unhex(ciphertexts[i], expected);
    noise_buffer_set_input(payload, input, n);
    noise_buffer_set_output(wire, out, sizeof(out));
    noise_buffer_set_output(plain, received, sizeof(received));
    assert(!noise_handshakestate_write_message(i ? b : a, &wire, &payload));
    assert(wire.size == length && !memcmp(out, expected, length));
    assert(!noise_handshakestate_read_message(i ? a : b, &wire, &plain));
    assert(plain.size == n && !memcmp(received, input, n));
  }
  noise_handshakestate_free(a);
  noise_handshakestate_free(b);
}
int main(int argc, char **argv) {
  assert(argc == 2);
  vector();
  assert(!pb_create("not-a-peer", 1));
  PiperBle *a = pb_create(alice, 1), *b = pb_create(bob, 0);
  assert(a && b);
  settle(a, b, 1);
  assert(ready == 2);
  const char *control = "{\"v\":1,\"type\":\"inventory\",\"ids\":[]}";
  assert(!pb_control(a, control));
  assert(!pb_control(b, control));
  settle(a, b, 20);
  assert(controls == 2);
  char source[1024], dest[1024];
  snprintf(source, sizeof(source), "%s/source", argv[1]);
  snprintf(dest, sizeof(dest), "%s/partial", argv[1]);
  FILE *f = fopen(source, "wb");
  assert(f);
  for (int i = 0; i < 100 * 1024; i++)
    fputc(i % 251, f);
  fclose(f);
  assert(!pb_expect(b, dest, hash, 100 * 1024));
  assert(!pb_send_file(a, source, hash));
  for (int i = 0; i < 250; i++) {
    ferry(a, b, 244);
    ferry(b, a, 244);
  }
  struct stat partial;
  assert(!stat(dest, &partial) && partial.st_size > 0 &&
         partial.st_size < 100 * 1024);
  pb_free(a);
  pb_free(b); /* radio disconnection / process restart */
  a = pb_create(alice, 1);
  b = pb_create(bob, 0);
  settle(a, b, 20);
  assert(!pb_expect(b, dest, hash, 100 * 1024));
  assert(!pb_send_file(a, source, hash));
  /* Controls continue while the resumed bulk transfer is in progress. */
  assert(!pb_control(b, control));
  settle(a, b, 20);
  assert(files == 1 && sent == 100 * 1024 && controls == 3);
  FILE *left = fopen(source, "rb"), *right = fopen(dest, "rb");
  assert(left && right);
  int c;
  while ((c = fgetc(left)) != EOF)
    assert(c == fgetc(right));
  assert(fgetc(right) == EOF);
  fclose(left);
  fclose(right);
  /* Resume of a complete partial still reports a file for hash validation. */
  assert(!pb_expect(b, dest, hash, 100 * 1024));
  assert(!pb_send_file(a, source, hash));
  settle(a, b, 512);
  assert(files == 2);
  /* A modified encrypted record fails closed. */
  assert(!pb_control(a, control));
  uint8_t wire[512];
  size_t n = pb_peek(a, wire, sizeof(wire));
  assert(n > 4);
  wire[n - 1] ^= 1;
  assert(pb_receive(b, wire, n) < 0 && pb_failed(b));
  pb_free(a);
  pb_free(b);
  /* Length prefix and handshake parser never allocate from remote sizes. */
  a = pb_create(alice, 1);
  uint8_t huge[] = {255, 255};
  assert(pb_receive(a, huge, 2) < 0);
  pb_free(a);
  /* Unsolicited file streams fail before creating a file. */
  a = pb_create(alice, 1);
  b = pb_create(bob, 0);
  settle(a, b, 20);
  assert(!pb_send_file(a, source, hash));
  n = pb_peek(a, wire, sizeof(wire));
  assert(n > 0);
  assert(pb_receive(b, wire, n) < 0);
  pb_free(a);
  pb_free(b);
  /* Local admission rejects oversized media and invalid content identifiers. */
  a = pb_create(alice, 1);
  b = pb_create(bob, 0);
  settle(a, b, 20);
  assert(pb_expect(b, dest, hash, 5 * 1024 * 1024 + 1) < 0);
  assert(pb_expect(b, dest, "../escape", 10) < 0);
  /* Full-size videos and simultaneous sending/receiving use bounded chunks. */
  char video[1024], received_video[1024], reverse[1024];
  snprintf(video, sizeof(video), "%s/video", argv[1]);
  snprintf(received_video, sizeof(received_video), "%s/video-partial", argv[1]);
  snprintf(reverse, sizeof(reverse), "%s/reverse-partial", argv[1]);
  f = fopen(video, "wb");
  assert(f);
  for (int i = 0; i < 5 * 1024 * 1024; i++)
    fputc(i % 239, f);
  fclose(f);
  assert(!pb_expect(b, received_video, hash, 5 * 1024 * 1024));
  assert(!pb_send_file(a, video, hash));
  assert(!pb_expect(a, reverse, hash, 100 * 1024));
  assert(!pb_send_file(b, source, hash));
  settle(a, b, 182);
  assert(files == 4 && !pb_busy(a) && !pb_busy(b));
  left = fopen(video, "rb");
  right = fopen(received_video, "rb");
  assert(left && right);
  while ((c = fgetc(left)) != EOF)
    assert(c == fgetc(right));
  assert(fgetc(right) == EOF);
  fclose(left);
  fclose(right);
  /* Queue bounds prevent unlimited app/control buffering. */
  int count = 0;
  while (!pb_control(a, control))
    assert(++count < 10000);
  assert(pb_failed(a));
  pb_free(a);
  pb_free(b);
  puts("BLE core: Noise vector, MTU fragmentation, bidirectional control, file "
       "resume, tamper and resource bounds passed");
  return 0;
}
