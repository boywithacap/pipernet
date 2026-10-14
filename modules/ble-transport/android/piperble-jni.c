#include "PiperBle.h"
#include <jni.h>
#include <stdint.h>
#include <stdio.h>
#define CORE(name) Java_expo_modules_piperble_BleCore_##name
#define PTR(value) ((PiperBle *)(intptr_t)(value))
JNIEXPORT jlong JNICALL CORE(create)(JNIEnv *e, jobject o, jstring name,
                                     jboolean initiator) {
  const char *s = (*e)->GetStringUTFChars(e, name, 0);
  if (!s)
    return 0;
  PiperBle *p = pb_create(s, initiator);
  (*e)->ReleaseStringUTFChars(e, name, s);
  return (jlong)(intptr_t)p;
}
JNIEXPORT void JNICALL CORE(free)(JNIEnv *e, jobject o, jlong p) {
  pb_free(PTR(p));
}
JNIEXPORT jint JNICALL CORE(receive)(JNIEnv *e, jobject o, jlong p,
                                     jbyteArray data) {
  jbyte *b = (*e)->GetByteArrayElements(e, data, 0);
  if (!b)
    return -1;
  int result = pb_receive(PTR(p), (uint8_t *)b, (*e)->GetArrayLength(e, data));
  (*e)->ReleaseByteArrayElements(e, data, b, JNI_ABORT);
  return result;
}
JNIEXPORT jbyteArray JNICALL CORE(peek)(JNIEnv *e, jobject o, jlong p,
                                        jint capacity) {
  uint8_t b[512];
  if (capacity < 1 || capacity > 512)
    return 0;
  size_t n = pb_peek(PTR(p), b, capacity);
  if (!n)
    return 0;
  jbyteArray result = (*e)->NewByteArray(e, n);
  if (result)
    (*e)->SetByteArrayRegion(e, result, 0, n, (jbyte *)b);
  return result;
}
JNIEXPORT void JNICALL CORE(consume)(JNIEnv *e, jobject o, jlong p,
                                     jint count) {
  if (count > 0)
    pb_consume(PTR(p), count);
}
JNIEXPORT jobjectArray JNICALL CORE(event)(JNIEnv *e, jobject o, jlong p) {
  char text[8193], type_s[16], bytes_s[16], total_s[16];
  uint32_t bytes = 0, total = 0;
  int type = pb_event(PTR(p), text, sizeof(text), &bytes, &total);
  if (type <= 0)
    return 0;
  snprintf(type_s, sizeof(type_s), "%d", type);
  snprintf(bytes_s, sizeof(bytes_s), "%u", bytes);
  snprintf(total_s, sizeof(total_s), "%u", total);
  jclass string = (*e)->FindClass(e, "java/lang/String");
  if (!string)
    return 0;
  jobjectArray result = (*e)->NewObjectArray(e, 4, string, 0);
  if (!result)
    return 0;
  const char *values[] = {type_s, text, bytes_s, total_s};
  for (int i = 0; i < 4; i++) {
    jstring value = (*e)->NewStringUTF(e, values[i]);
    if (!value)
      return 0;
    (*e)->SetObjectArrayElement(e, result, i, value);
    (*e)->DeleteLocalRef(e, value);
  }
  return result;
}
JNIEXPORT jint JNICALL CORE(control)(JNIEnv *e, jobject o, jlong p,
                                     jstring text) {
  const char *s = (*e)->GetStringUTFChars(e, text, 0);
  if (!s)
    return -1;
  int r = pb_control(PTR(p), s);
  (*e)->ReleaseStringUTFChars(e, text, s);
  return r;
}
JNIEXPORT jint JNICALL CORE(expect)(JNIEnv *e, jobject o, jlong p, jstring path,
                                    jstring hash, jint total) {
  const char *s = (*e)->GetStringUTFChars(e, path, 0);
  if (!s)
    return -1;
  const char *h = (*e)->GetStringUTFChars(e, hash, 0);
  if (!h) {
    (*e)->ReleaseStringUTFChars(e, path, s);
    return -1;
  }
  int r = pb_expect(PTR(p), s, h, total);
  (*e)->ReleaseStringUTFChars(e, path, s);
  (*e)->ReleaseStringUTFChars(e, hash, h);
  return r;
}
JNIEXPORT jint JNICALL CORE(sendFile)(JNIEnv *e, jobject o, jlong p,
                                      jstring path, jstring hash) {
  const char *s = (*e)->GetStringUTFChars(e, path, 0);
  if (!s)
    return -1;
  const char *h = (*e)->GetStringUTFChars(e, hash, 0);
  if (!h) {
    (*e)->ReleaseStringUTFChars(e, path, s);
    return -1;
  }
  int r = pb_send_file(PTR(p), s, h);
  (*e)->ReleaseStringUTFChars(e, path, s);
  (*e)->ReleaseStringUTFChars(e, hash, h);
  return r;
}
JNIEXPORT jint JNICALL CORE(cancel)(JNIEnv *e, jobject o, jlong p) {
  return pb_cancel(PTR(p));
}
JNIEXPORT jboolean JNICALL CORE(busy)(JNIEnv *e, jobject o, jlong p) {
  return pb_busy(PTR(p)) != 0;
}
JNIEXPORT jboolean JNICALL CORE(failed)(JNIEnv *e, jobject o, jlong p) {
  return pb_failed(PTR(p)) != 0;
}
