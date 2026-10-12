import { assertMediaSize } from "../media-policy";
import type { MeshEnvelope, MeshFrame } from "../../types/mesh";

export const MESH_LIMITS = {
  lifetime: 24 * 60 * 60 * 1000,
  clockSkew: 5 * 60 * 1000,
  hops: 3,
  // Bound receipt history, not the total number of phones that may receive a broadcast.
  receipts: 128,
  records: 128,
  tombstones: 512,
  cacheBytes: 50 * 1024 * 1024,
  sessionBytes: 10 * 1024 * 1024,
  controlBytes: 8 * 1024,
  inventoryPage: 64,
  peers: 2,
  timeout: 90_000,
  retries: 4,
} as const;

export const hashPattern = /^[a-f0-9]{64}$/;
export const nodePattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function validateEnvelope(value: unknown, now: number): MeshEnvelope {
  const e = value as MeshEnvelope;
  if (
    !e ||
    !hashPattern.test(e.id) ||
    typeof e.id !== "string" ||
    !["photo", "video"].includes(e.kind) ||
    !Number.isSafeInteger(e.bytes) ||
    !Number.isSafeInteger(e.createdAt) ||
    !Number.isSafeInteger(e.expiresAt) ||
    e.createdAt <= 0 ||
    e.createdAt > now + MESH_LIMITS.clockSkew ||
    e.expiresAt <= now ||
    e.expiresAt <= e.createdAt ||
    e.expiresAt - e.createdAt > MESH_LIMITS.lifetime ||
    !Number.isInteger(e.hops) ||
    e.hops < 0 ||
    e.hops > MESH_LIMITS.hops
  ) {
    throw new Error("Invalid or expired mesh offer.");
  }
  assertMediaSize(e.kind, e.bytes);
  // Copy allowlisted fields. Remote paths, filenames, labels, and thumbnails never enter storage.
  return {
    id: e.id,
    kind: e.kind,
    bytes: e.bytes,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    hops: e.hops,
  };
}

export function decodeFrame(text: string, now: number): MeshFrame {
  // All wire fields are ASCII, so this also bounds UTF-8 input before JSON parsing.
  if (text.length > MESH_LIMITS.controlBytes || /[^\x20-\x7e]/.test(text))
    throw new Error("Oversized mesh control message.");
  const value = JSON.parse(text);
  if (!value || value.v !== 1) throw new Error("Unsupported mesh protocol.");
  if (
    value.type === "hello" &&
    typeof value.nodeId === "string" &&
    nodePattern.test(value.nodeId)
  ) {
    return { v: 1, type: "hello", nodeId: value.nodeId };
  }
  if (
    value.type === "inventory" &&
    Array.isArray(value.ids) &&
    value.ids.length <= MESH_LIMITS.inventoryPage &&
    value.ids.every(
      (id: unknown) => typeof id === "string" && hashPattern.test(id),
    )
  ) {
    return { v: 1, type: "inventory", ids: value.ids };
  }
  if (value.type === "offer")
    return {
      v: 1,
      type: "offer",
      envelope: validateEnvelope(value.envelope, now),
    };
  if (
    ["accept", "receipt", "busy", "cancel"].includes(value.type) &&
    typeof value.id === "string" &&
    hashPattern.test(value.id)
  ) {
    return { v: 1, type: value.type, id: value.id };
  }
  throw new Error("Malformed mesh control message.");
}

export function encodeFrame(frame: MeshFrame) {
  const text = JSON.stringify(frame);
  if (text.length > MESH_LIMITS.controlBytes)
    throw new Error("Mesh control message too large.");
  return text;
}
