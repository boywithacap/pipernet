import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureGesture } from "../src/lib/capture-gesture";

test("a tap captures one photo and a hold never captures a photo on release", () => {
  const gesture = createCaptureGesture();
  gesture.pressIn();
  gesture.pressOut();
  assert.equal(gesture.takePhoto(), true);
  assert.equal(gesture.takePhoto(), false);

  gesture.pressIn();
  const video = gesture.beginVideo()!;
  assert.equal(gesture.startVideo(video), true);
  assert.equal(gesture.pressOut(), video);
  assert.equal(video.released, true);
  gesture.finish(video);
  assert.equal(gesture.takePhoto(), false);
});

test("releasing while the camera starts prevents a late recording", () => {
  const gesture = createCaptureGesture();
  gesture.pressIn();
  const video = gesture.beginVideo()!;
  gesture.pressOut();
  assert.equal(gesture.startVideo(video), false);
  gesture.cancel();
  assert.equal(gesture.startVideo(video), false);
  assert.equal(gesture.takePhoto(), false);
});

test("a cancelled permission or camera session cannot start or finish a later hold", () => {
  const gesture = createCaptureGesture();
  gesture.pressIn();
  const old = gesture.beginVideo()!;
  gesture.cancel();
  gesture.pressIn();
  const next = gesture.beginVideo()!;
  assert.equal(gesture.startVideo(old), false);
  gesture.finish(old);
  assert.equal(gesture.startVideo(next), true);
  assert.equal(gesture.startVideo(next), false);
});

test("automatic completion cannot turn a held finger into a photo", () => {
  const gesture = createCaptureGesture();
  gesture.pressIn();
  const video = gesture.beginVideo()!;
  gesture.startVideo(video);
  gesture.finish(video);
  gesture.pressOut();
  assert.equal(gesture.takePhoto(), false);
  gesture.pressIn();
  gesture.pressOut();
  assert.equal(gesture.takePhoto(), true);
});

test("accessible video actions can record without a continuous touch", () => {
  const gesture = createCaptureGesture();
  const video = gesture.beginVideo(false)!;
  gesture.pressOut();
  assert.equal(gesture.startVideo(video), true);
  assert.equal(gesture.cancel(), video);
  assert.equal(video.cancelled, true);
});

test("accessible photo activations work again after a capture or a cancelled hold", () => {
  const gesture = createCaptureGesture();
  assert.equal(gesture.takePhoto(true), true);
  assert.equal(gesture.takePhoto(true), true);
  gesture.pressIn();
  const video = gesture.beginVideo()!;
  assert.equal(gesture.takePhoto(true), false);
  gesture.cancel();
  assert.equal(gesture.startVideo(video), false);
  assert.equal(gesture.takePhoto(), false);
  assert.equal(gesture.takePhoto(true), true);
});
