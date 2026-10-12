import { nodePattern } from "./protocol";

// Fits both native adapters' 40-byte discovery context. Only one side dials.
export function discoveryName(nodeId: string) {
  if (!nodePattern.test(nodeId)) throw new Error("Invalid mesh identity.");
  return `PN1:${nodeId}`;
}

export function discoveryIdentity(name: string) {
  const nodeId = name.startsWith("PN1:") ? name.slice(4) : "";
  return nodePattern.test(nodeId) ? nodeId : undefined;
}

export const DISCOVERY_LIMITS = {
  candidates: 32,
  connectTimeout: 30_000,
  retryBase: 5_000,
  retryMax: 60_000,
  rotationAfter: 30_000,
  rotationCooldown: 30_000,
  handshakeTimeout: 15_000,
} as const;
