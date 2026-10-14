import type { MediaDraft, MediaItem, MediaKind } from "./media";

export interface MeshEnvelope {
  id: string; // SHA-256 of the compressed file: content identity, not sender identity.
  kind: MediaKind;
  bytes: number;
  createdAt: number;
  expiresAt: number;
  hops: number;
}

export type MeshFrame =
  | { v: 1; type: "hello"; nodeId: string }
  | { v: 1; type: "inventory"; ids: string[] }
  | { v: 1; type: "offer"; envelope: MeshEnvelope }
  | { v: 1; type: "accept" | "receipt" | "busy" | "cancel"; id: string };

export type TransportEvent =
  | { type: "found"; peerId: string; name: string }
  | { type: "lost" | "connected" | "disconnected"; peerId: string }
  | { type: "pairing"; peerId: string; name: string; code: string }
  | { type: "control"; peerId: string; text: string }
  | { type: "file"; peerId: string; uri: string }
  | {
      type: "progress";
      peerId: string;
      direction: "sending" | "receiving";
      bytes: number;
      total: number;
    }
  | { type: "error"; message: string };

export type MeshTransportMode = "ble" | "nearby";

export interface MeshTransport {
  select?: (mode: MeshTransportMode) => void;
  available: boolean;
  start: (name: string) => Promise<void>;
  stop: () => Promise<void>;
  connect: (peerId: string) => Promise<void>;
  verify: (peerId: string, accept: boolean) => Promise<void>;
  disconnect: (peerId: string) => Promise<void>;
  sendControl: (peerId: string, text: string) => Promise<void>;
  expectFile: (peerId: string, bytes: number, hash: string) => Promise<void>;
  sendFile: (peerId: string, uri: string, hash: string) => Promise<void>;
  cancelFile: (peerId: string) => Promise<void>;
  subscribe: (callback: (event: TransportEvent) => void) => () => void;
}

export interface MeshRecord {
  envelope: MeshEnvelope;
  mediaId: string;
  local: boolean;
  admittedAt: number;
  deliveredTo: string[];
  receivedFrom?: string;
}

export interface MeshJournal {
  transport?: MeshTransportMode;
  version: 1;
  nodeId: string;
  enabled: boolean;
  relay: boolean;
  records: MeshRecord[];
  seen: { id: string; until: number }[];
}

export interface MeshPeer {
  id: string;
  name: string;
  state: "nearby" | "connecting" | "connected";
}

export interface MeshSnapshot {
  transport: MeshTransportMode;
  updatedAt: number;
  status:
    "loading" | "off" | "paused" | "discovering" | "unavailable" | "error";
  enabled: boolean;
  relay: boolean;
  peers: MeshPeer[];
  records: MeshRecord[];
  transfer?: {
    mediaId?: string;
    direction: "sending" | "receiving";
    bytes: number;
    total: number;
  };
  error?: string;
}

export interface MeshDependencies {
  storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
  };
  transport: MeshTransport;
  uuid: () => string;
  now?: () => number;
  media: {
    ready?: () => Promise<void>;
    items: () => MediaItem[];
    uri: (item: MediaItem) => string;
    hash: (uri: string) => Promise<{ hash: string; bytes: number }>;
    validate: (uri: string, envelope: MeshEnvelope) => Promise<MediaDraft>;
    receive: (
      id: string,
      sender: string,
      draft: MediaDraft,
    ) => Promise<MediaItem>;
    discard: (uri: string) => void;
  };
}
