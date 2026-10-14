import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { MeshCoordinator, MESH_STORAGE_KEY } from "../src/lib/mesh/coordinator";
import { decodeFrame, MESH_LIMITS } from "../src/lib/mesh/protocol";
import {
  discoveryName,
  discoveryIdentity,
  DISCOVERY_LIMITS,
} from "../src/lib/mesh/discovery";
import type { MediaItem } from "../src/types/media";
import type {
  MeshDependencies,
  MeshEnvelope,
  MeshTransport,
  TransportEvent,
} from "../src/types/mesh";

const now = 1_800_000_000_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const envelope: MeshEnvelope = {
  id: hash("photo"),
  kind: "photo",
  bytes: 1000,
  createdAt: now,
  expiresAt: now + MESH_LIMITS.lifetime,
  hops: 1,
};

class Transport implements MeshTransport {
  select?: MeshTransport["select"];
  available = true;
  running = false;
  listeners = new Set<(event: TransportEvent) => void>();
  links = new Map<string, Transport>();
  controls: { peer: string; frame: ReturnType<typeof decodeFrame> }[] = [];
  sent = 0;
  name = "";
  dialed: string[] = [];
  verifications: { peer: string; accept: boolean }[] = [];
  onConnect?: (peer: string) => Promise<void>;
  onVerify?: (peer: string, accept: boolean) => Promise<void>;
  expected = new Map<string, number>();
  fileMap = new Map<
    string,
    { hash: string; bytes: number; kind: "photo" | "video" }
  >();
  constructor(readonly id: string) {}
  emit(event: TransportEvent) {
    this.listeners.forEach((fn) => fn(event));
  }
  subscribe = (fn: (event: TransportEvent) => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  start = async (name: string) => {
    this.name = name;
    this.running = true;
  };
  stop = async () => {
    this.running = false;
    this.links.forEach((other) =>
      other.emit({ type: "disconnected", peerId: this.id }),
    );
    this.links.clear();
    this.expected.clear();
  };
  connect = async (peer: string) => {
    this.dialed.push(peer);
    await this.onConnect?.(peer);
  };
  verify = async (peer: string, accept: boolean) => {
    this.verifications.push({ peer, accept });
    await this.onVerify?.(peer, accept);
  };
  disconnect = async (peer: string) => {
    const other = this.links.get(peer);
    other?.links.delete(this.id);
    other?.emit({ type: "disconnected", peerId: this.id });
    this.links.delete(peer);
    this.emit({ type: "disconnected", peerId: peer });
  };
  sendControl = async (peer: string, text: string) => {
    this.controls.push({ peer, frame: decodeFrame(text, now) });
    this.links.get(peer)?.emit({ type: "control", peerId: this.id, text });
  };
  expectFile = async (peer: string, bytes: number) => {
    this.expected.set(peer, bytes);
  };
  cancelFile = async (peer: string) => {
    this.expected.delete(peer);
  };
  sendFile = async (peer: string, uri: string) => {
    const other = this.links.get(peer);
    assert.ok(other);
    assert.ok(
      other.expected.has(this.id),
      "bytes cannot precede an accepted offer",
    );
    other.expected.delete(this.id);
    this.sent++;
    const receivedUri = `file:///cache/${peer}/${this.id}-${this.sent}.bin`;
    other.fileMap.set(receivedUri, this.fileMap.get(uri)!);
    other.emit({ type: "file", peerId: this.id, uri: receivedUri });
  };
}

function node(
  id: number,
  existing?: { data: Map<string, string>; items: MediaItem[] },
) {
  let time = now;
  const data = existing?.data ?? new Map<string, string>();
  const items: MediaItem[] = existing?.items ?? [];
  const transport = new Transport(`peer-${id}`);
  const discarded: string[] = [];
  let failWrite = false;
  let receives = 0;
  const deps: MeshDependencies = {
    storage: {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        if (failWrite) throw new Error("Disk full");
        data.set(key, value);
      },
    },
    transport,
    uuid: () => `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`,
    now: () => time,
    media: {
      items: () => items,
      uri: (item) => `file:///library/${item.fileName}`,
      hash: async (uri) => {
        const file = transport.fileMap.get(uri);
        assert.ok(file);
        return file;
      },
      validate: async (uri, offer) => ({
        uri,
        kind: offer.kind,
        bytes: offer.bytes,
      }),
      receive: async (messageId, sender, draft) => {
        const existing = items.find((item) => item.id === messageId);
        if (existing) return existing;
        receives++;
        const item: MediaItem = {
          id: messageId,
          sender,
          kind: draft.kind,
          bytes: draft.bytes,
          direction: "received",
          fileName: `${messageId}.jpg`,
          read: false,
          createdAt: time,
        };
        transport.fileMap.set(
          `file:///library/${item.fileName}`,
          transport.fileMap.get(draft.uri)!,
        );
        items.push(item);
        return item;
      },
      discard: (uri) => {
        discarded.push(uri);
        transport.fileMap.delete(uri);
      },
    },
  };
  const engine = new MeshCoordinator(deps);
  return {
    engine,
    transport,
    data,
    items,
    discarded,
    deps,
    receives: () => receives,
    setTime: (value: number) => {
      time = value;
    },
    failWrite: (value: boolean) => {
      failWrite = value;
    },
  };
}
type Node = ReturnType<typeof node>;
const identity = (id: number) =>
  `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`;
async function start(n: Node, relay = false) {
  await n.engine.initialize();
  await n.engine.configure({ enabled: true, relay });
  await n.engine.setActive(true);
}
function capture(n: Node, content = "photo") {
  const item: MediaItem = {
    id: `local-${n.items.length}`,
    kind: "photo",
    bytes: 1000,
    createdAt: now,
    direction: "outgoing",
    fileName: `capture-${n.items.length}.jpg`,
    read: true,
  };
  n.items.push(item);
  n.transport.fileMap.set(`file:///library/${item.fileName}`, {
    hash: hash(content),
    bytes: 1000,
    kind: "photo",
  });
  return item;
}
function acceptPeer(n: Node, peerId: string, nodeId: string) {
  n.transport.emit({
    type: "pairing",
    peerId,
    name: discoveryName(nodeId),
    code: "1234",
  });
}
function link(a: Node, b: Node, handshake = true) {
  if (handshake) {
    acceptPeer(a, b.transport.id, discoveryIdentity(b.transport.name)!);
    acceptPeer(b, a.transport.id, discoveryIdentity(a.transport.name)!);
  }
  a.transport.links.set(b.transport.id, b.transport);
  b.transport.links.set(a.transport.id, a.transport);
  a.transport.emit({ type: "connected", peerId: b.transport.id });
  b.transport.emit({ type: "connected", peerId: a.transport.id });
}
// Model native discovery, verification, and connection callbacks. No manual connect.
function discover(a: Node, b: Node) {
  const approved = new Set<Transport>();
  for (const [local, remote] of [
    [a, b],
    [b, a],
  ]) {
    const previousConnect = local.transport.onConnect;
    const previousVerify = local.transport.onVerify;
    local.transport.onConnect = async (peer) => {
      if (peer !== remote.transport.id) return previousConnect?.(peer);
      local.transport.emit({
        type: "pairing",
        peerId: peer,
        name: remote.transport.name,
        code: "1234",
      });
      remote.transport.emit({
        type: "pairing",
        peerId: local.transport.id,
        name: local.transport.name,
        code: "1234",
      });
    };
    local.transport.onVerify = async (peer, accept) => {
      if (peer !== remote.transport.id) return previousVerify?.(peer, accept);
      if (!accept) return;
      approved.add(local.transport);
      if (approved.size === 2) {
        approved.clear();
        link(a, b, false);
      }
    };
  }
  a.transport.emit({
    type: "found",
    peerId: b.transport.id,
    name: b.transport.name,
  });
  b.transport.emit({
    type: "found",
    peerId: a.transport.id,
    name: a.transport.name,
  });
}
async function settle(...nodes: Node[]) {
  for (let i = 0; i < 8; i++)
    await Promise.all(nodes.map((n) => n.engine.tick()));
}

test("nearby discovery connects and broadcasts automatically; reconnects and relay loops do not duplicate media", async () => {
  const a = node(1),
    b = node(2),
    c = node(3);
  capture(a);
  for (const n of [a, b, c]) await start(n, true);
  discover(a, b);
  await settle(a, b);
  assert.deepEqual(a.transport.dialed, [b.transport.id]);
  assert.deepEqual(b.transport.dialed, []);
  assert.equal(b.receives(), 1);
  assert.ok(
    a.transport.verifications[0].accept && b.transport.verifications[0].accept,
  );
  await a.engine.setActive(false);
  discover(b, c);
  await settle(b, c);
  assert.equal(c.receives(), 1);
  await a.engine.setActive(true);
  discover(a, c);
  await settle(a, b, c);
  assert.equal(a.transport.sent, 1);
  assert.equal(c.transport.sent, 0);
  assert.equal(b.receives(), 1);
  assert.equal(c.receives(), 1);
});

test("repeated discovery reserves one connection and ignores incompatible or duplicate identities", async () => {
  const a = node(1);
  await start(a);
  for (let i = 0; i < 4; i++)
    a.transport.emit({
      type: "found",
      peerId: "b",
      name: discoveryName(identity(2)),
    });
  a.transport.emit({
    type: "found",
    peerId: "duplicate-b",
    name: discoveryName(identity(2)),
  });
  a.transport.emit({ type: "found", peerId: "self", name: a.transport.name });
  a.transport.emit({ type: "found", peerId: "old", name: "Piper abcd" });
  await settle(a);
  assert.deepEqual(a.transport.dialed, ["b"]);
  assert.deepEqual(
    a.engine.getSnapshot().peers.map((p) => p.id),
    ["b"],
  );
  assert.equal(a.transport.name.length, 40);
  assert.equal(discoveryIdentity(a.transport.name), identity(1));
});

test("automatic reconnect preserves receipts and sends only new captures", async () => {
  const a = node(1),
    b = node(2);
  capture(a);
  await start(a);
  await start(b);
  discover(a, b);
  await settle(a, b);
  await a.transport.disconnect(b.transport.id);
  await settle(a, b);
  for (const n of [a, b]) n.setTime(now + DISCOVERY_LIMITS.retryBase);
  await settle(a, b);
  assert.equal(a.transport.dialed.length, 2);
  assert.equal(b.receives(), 1);
  assert.equal(a.transport.sent, 1);
  capture(a, "new photo");
  await settle(a, b);
  assert.equal(b.receives(), 2);
  assert.equal(a.transport.sent, 2);
});

test("identical media arriving over two automatic links produces one received file", async () => {
  const a = node(1),
    b = node(2),
    c = node(3);
  capture(a, "same bytes");
  capture(b, "same bytes");
  for (const n of [a, b, c]) await start(n, true);
  discover(a, c);
  discover(b, c);
  await settle(a, b, c);
  for (const n of [a, b, c]) n.setTime(now + 10_000);
  await settle(a, b, c);
  assert.equal(c.receives(), 1);
  assert.equal(c.items.length, 1);
  assert.equal(a.transport.sent + b.transport.sent, 1);
});

test("duplicate handshakes and unknown or late connection callbacks cannot reset a connection", async () => {
  const a = node(1);
  await start(a);
  a.transport.emit({ type: "connected", peerId: "unknown" });
  acceptPeer(a, "b", identity(2));
  acceptPeer(a, "b", identity(2));
  await settle(a);
  assert.equal(a.transport.verifications.length, 1);
  assert.deepEqual(
    a.engine.getSnapshot().peers.map((p) => p.id),
    ["b"],
  );
  a.setTime(now + DISCOVERY_LIMITS.connectTimeout);
  await settle(a);
  a.transport.emit({ type: "connected", peerId: "b" });
  await settle(a);
  assert.equal(a.engine.getSnapshot().peers.length, 0);
  assert.equal(a.transport.controls.length, 0);
});

test("incoming connections are automatically accepted within capacity and invalid peers are rejected", async () => {
  const a = node(9);
  await start(a);
  for (const id of [1, 2, 3])
    a.transport.emit({
      type: "pairing",
      peerId: `peer-${id}`,
      name: discoveryName(identity(id)),
      code: "1234",
    });
  a.transport.emit({
    type: "pairing",
    peerId: "invalid",
    name: "Other app",
    code: "1234",
  });
  await settle(a);
  assert.deepEqual(
    a.transport.verifications.map((v) => v.accept),
    [true, true, false, false],
  );
  assert.equal(a.engine.getSnapshot().peers.length, 2);
});

test("failed connection and verification retry without stopping the mesh or looping immediately", async () => {
  const a = node(1);
  await start(a);
  a.transport.onConnect = async () => {
    throw new Error("radio busy");
  };
  a.transport.emit({
    type: "found",
    peerId: "b",
    name: discoveryName(identity(2)),
  });
  await settle(a);
  assert.equal(a.transport.dialed.length, 1);
  assert.equal(a.engine.getSnapshot().status, "discovering");
  a.setTime(now + DISCOVERY_LIMITS.retryBase);
  await settle(a);
  assert.equal(a.transport.dialed.length, 2);
  a.transport.onVerify = async () => {
    throw new Error("connection cancelled");
  };
  a.transport.emit({
    type: "pairing",
    peerId: "c",
    name: discoveryName(identity(3)),
    code: "1234",
  });
  await settle(a);
  assert.equal(a.engine.getSnapshot().status, "discovering");
  assert.equal(
    a.engine.getSnapshot().peers.find((p) => p.id === "c"),
    undefined,
  );
});

test("late native connection failures cannot cancel a newer attempt or a resumed session", async () => {
  const a = node(1);
  let rejectOld!: (error: Error) => void;
  a.transport.onConnect = () =>
    new Promise((_, reject) => {
      rejectOld = reject;
    });
  await start(a);
  a.transport.emit({
    type: "found",
    peerId: "b",
    name: discoveryName(identity(2)),
  });
  await settle(a);
  a.setTime(now + DISCOVERY_LIMITS.connectTimeout);
  await settle(a);
  a.transport.onConnect = async () => {};
  a.setTime(now + DISCOVERY_LIMITS.connectTimeout + DISCOVERY_LIMITS.retryBase);
  await settle(a);
  assert.equal(a.transport.dialed.length, 2);
  rejectOld(new Error("old native callback"));
  await settle(a);
  assert.equal(a.engine.getSnapshot().peers[0].state, "connecting");
  await a.engine.setActive(false);
  a.transport.emit({ type: "connected", peerId: "b" });
  await settle(a);
  assert.equal(a.engine.getSnapshot().peers.length, 0);
});

test("endpoint changes preserve failure cooldown and lost candidates eventually free their slots", async () => {
  const a = node(1);
  a.transport.onConnect = async () => {
    throw new Error("busy");
  };
  await start(a);
  a.transport.emit({
    type: "found",
    peerId: "old",
    name: discoveryName(identity(2)),
  });
  await settle(a);
  a.transport.emit({ type: "lost", peerId: "old" });
  a.transport.emit({
    type: "found",
    peerId: "new",
    name: discoveryName(identity(2)),
  });
  await settle(a);
  assert.deepEqual(a.transport.dialed, ["old"]);
  a.setTime(now + DISCOVERY_LIMITS.retryBase);
  await settle(a);
  assert.deepEqual(a.transport.dialed, ["old", "new"]);
  a.transport.emit({ type: "lost", peerId: "new" });
  a.setTime(now + 100_000);
  await settle(a);
  a.transport.emit({
    type: "found",
    peerId: "fresh",
    name: discoveryName(identity(2)),
  });
  await settle(a);
  assert.deepEqual(a.transport.dialed, ["old", "new", "fresh"]);
});

test("idle links rotate to waiting phones so automatic broadcasts reach more than two neighbors", async () => {
  const a = node(1),
    b = node(2),
    c = node(3),
    d = node(4);
  capture(a);
  for (const n of [a, b, c, d]) await start(n);
  discover(a, b);
  discover(a, c);
  discover(a, d);
  await settle(a, b, c, d);
  assert.equal(b.receives() + c.receives() + d.receives(), 2);
  for (const n of [a, b, c, d])
    n.setTime(now + DISCOVERY_LIMITS.rotationAfter + 1);
  await settle(a, b, c, d);
  assert.equal(d.receives(), 1);
  assert.equal(a.transport.sent, 3);
  assert.equal(
    a.engine.getSnapshot().peers.filter((p) => p.state !== "nearby").length,
    2,
  );
});

test("a peer that connects without completing the application handshake cannot hold a slot indefinitely", async () => {
  const a = node(1);
  await start(a);
  a.transport.emit({
    type: "found",
    peerId: "silent",
    name: discoveryName(identity(2)),
  });
  await settle(a);
  acceptPeer(a, "silent", identity(2));
  a.transport.emit({ type: "connected", peerId: "silent" });
  await settle(a);
  a.setTime(now + DISCOVERY_LIMITS.handshakeTimeout);
  await settle(a);
  assert.equal(a.engine.getSnapshot().peers[0].state, "nearby");
  assert.equal(a.engine.getSnapshot().status, "discovering");
});

test("mesh wire rejects oversized, expired, future, invalid-hop and malformed offers", () => {
  const offer = (e: unknown) =>
    JSON.stringify({ v: 1, type: "offer", envelope: e });
  assert.equal(decodeFrame(offer(envelope), now).type, "offer");
  for (const change of [
    { id: "../escape" },
    { bytes: 102401 },
    { bytes: -1 },
    { kind: "executable" },
    { expiresAt: now },
    { expiresAt: now + 2 * MESH_LIMITS.lifetime },
    { createdAt: now + MESH_LIMITS.clockSkew + 1 },
    { hops: 4 },
    { hops: -1 },
    { bytes: 1.5 },
  ]) {
    assert.throws(() => decodeFrame(offer({ ...envelope, ...change }), now));
  }
  assert.throws(() => decodeFrame(" ".repeat(8193), now));
  assert.throws(() => decodeFrame('{"v":2,"type":"hello"}', now));
  assert.throws(() =>
    decodeFrame(
      JSON.stringify({
        v: 1,
        type: "inventory",
        ids: Array(65).fill(envelope.id),
      }),
      now,
    ),
  );
});

test("captures wait offline, share automatically after connection, and receipts follow durable saves", async () => {
  const a = node(1),
    b = node(2);
  capture(a);
  await start(a);
  await start(b);
  assert.equal(a.transport.sent, 0);
  link(a, b);
  await settle(a, b);
  assert.equal(b.items.length, 1);
  assert.equal(b.receives(), 1);
  assert.equal(a.transport.sent, 1);
  assert.equal(a.engine.getSnapshot().records[0].deliveredTo.length, 1);
  assert.equal(b.discarded.length, 1);
  await settle(a, b);
  assert.equal(
    a.transport.sent,
    1,
    "inventories and receipts prevent redundant bytes",
  );
});

test("A → B → C carries files across disconnected encounters and suppresses loops", async () => {
  const a = node(1),
    b = node(2),
    c = node(3);
  capture(a);
  await start(a);
  await start(b, true);
  await start(c, true);
  link(a, b);
  await settle(a, b);
  await a.engine.setActive(false);
  await settle(b);
  link(b, c);
  await settle(b, c);
  assert.equal(c.receives(), 1);
  assert.equal(c.engine.getSnapshot().records[0].envelope.hops, 2);
  assert.equal(b.transport.sent, 1);
  await a.engine.setActive(true);
  link(a, c);
  await settle(a, b, c);
  assert.equal(c.receives(), 1);
  assert.equal(
    c.transport.sent,
    0,
    "do not send already-held content back around a loop",
  );
});

test("relay consent is enforced and can be enabled after receiving", async () => {
  const a = node(1),
    b = node(2),
    c = node(3);
  capture(a);
  await start(a);
  await start(b);
  await start(c);
  link(a, b);
  await settle(a, b);
  await a.engine.setActive(false);
  link(b, c);
  await settle(b, c);
  assert.equal(c.receives(), 0);
  await b.engine.configure({ relay: true });
  await settle(b, c);
  assert.equal(c.receives(), 1);
});

test("deleting received media and restarting does not resurrect it on a retry", async () => {
  const a = node(1),
    b = node(2);
  capture(a);
  await start(a);
  await start(b);
  link(a, b);
  await settle(a, b);
  b.items.splice(0);
  await b.engine.dispose();
  const restarted = node(2, b);
  await start(restarted);
  // Simulate a sender that lost its receipt journal and reconnects.
  a.data.delete(MESH_STORAGE_KEY);
  await a.engine.dispose();
  const sender = node(1, a);
  sender.transport.fileMap = a.transport.fileMap;
  await start(sender);
  link(sender, restarted);
  await settle(sender, restarted);
  assert.equal(restarted.items.length, 0);
  assert.equal(
    sender.transport.sent,
    0,
    "tombstone inventory avoids retransmitting deleted content",
  );
});

test("corrupt bytes never reach the Inbox or produce a receipt", async () => {
  const b = node(2);
  await start(b);
  acceptPeer(b, "attacker", identity(1));
  b.transport.emit({ type: "connected", peerId: "attacker" });
  b.transport.emit({
    type: "control",
    peerId: "attacker",
    text: JSON.stringify({
      v: 1,
      type: "hello",
      nodeId: "00000000-0000-4000-8000-000000000001",
    }),
  });
  b.transport.emit({
    type: "control",
    peerId: "attacker",
    text: JSON.stringify({ v: 1, type: "offer", envelope }),
  });
  await settle(b);
  b.transport.fileMap.set("file:///cache/corrupt.bin", {
    hash: hash("different"),
    bytes: 1000,
    kind: "photo",
  });
  b.transport.emit({
    type: "file",
    peerId: "attacker",
    uri: "file:///cache/corrupt.bin",
  });
  await settle(b);
  assert.equal(b.receives(), 0);
  assert.ok(b.discarded.includes("file:///cache/corrupt.bin"));
  assert.equal(
    b.transport.controls.filter((c) => c.frame.type === "receipt").length,
    0,
  );
});

test("interrupted offer times out, backs off, and retries the same content identity", async () => {
  const a = node(1);
  capture(a);
  await start(a);
  acceptPeer(a, "silent", identity(2));
  a.transport.emit({ type: "connected", peerId: "silent" });
  a.transport.emit({
    type: "control",
    peerId: "silent",
    text: JSON.stringify({
      v: 1,
      type: "hello",
      nodeId: "00000000-0000-4000-8000-000000000002",
    }),
  });
  await settle(a);
  const offers = () =>
    a.transport.controls.filter((c) => c.frame.type === "offer");
  assert.equal(offers().length, 1);
  a.setTime(now + MESH_LIMITS.timeout + 1);
  await settle(a);
  assert.equal(offers().length, 1);
  a.setTime(now + MESH_LIMITS.timeout + 10_000);
  await settle(a);
  assert.equal(offers().length, 2);
  assert.deepEqual(offers()[0].frame, offers()[1].frame);
});

test("expiry stops forwarding, and stale captures never re-enroll after restart", async () => {
  const a = node(1);
  capture(a);
  await start(a);
  a.setTime(now + MESH_LIMITS.lifetime + 1);
  await settle(a);
  assert.equal(a.engine.getSnapshot().records.length, 0);
  await a.engine.dispose();
  const restarted = node(1, a);
  restarted.setTime(now + 3 * MESH_LIMITS.lifetime);
  await start(restarted);
  assert.equal(restarted.engine.getSnapshot().records.length, 0);
});

test("a failed journal write keeps opt-in state unchanged and preserves unknown metadata", async () => {
  const a = node(1);
  await a.engine.initialize();
  a.failWrite(true);
  await assert.rejects(a.engine.configure({ enabled: true }));
  assert.equal(a.engine.getSnapshot().enabled, false);
  for (const raw of ['{"version":2}', "null", "broken"]) {
    const b = node(2);
    b.data.set(MESH_STORAGE_KEY, raw);
    await assert.rejects(b.engine.initialize());
    assert.equal(b.data.get(MESH_STORAGE_KEY), raw);
  }
});

test("unoffered incoming files are discarded and pausing stops discovery", async () => {
  const b = node(2);
  await start(b);
  b.transport.emit({
    type: "file",
    peerId: "unknown",
    uri: "file:///cache/unsolicited.bin",
  });
  await settle(b);
  assert.ok(b.discarded.includes("file:///cache/unsolicited.bin"));
  await b.engine.setActive(false);
  assert.equal(b.transport.running, false);
  assert.equal(b.engine.getSnapshot().status, "paused");
});

test("simultaneous captures exchange in both directions without a symmetric offer deadlock", async () => {
  const a = node(1),
    b = node(2);
  capture(a, "A photo");
  capture(b, "B photo");
  await start(a);
  await start(b);
  link(a, b);
  await settle(a, b);
  a.setTime(now + 10_000);
  b.setTime(now + 10_000);
  await settle(a, b);
  assert.equal(a.receives(), 1);
  assert.equal(b.receives(), 1);
  assert.equal(a.transport.sent, 1);
  assert.equal(b.transport.sent, 1);
});

test("forwarding stops after three hops and reaches phones beyond the first two encounters", async () => {
  const a = node(1),
    b = node(2),
    c = node(3),
    d = node(4),
    e = node(5);
  capture(a);
  for (const n of [a, b, c, d, e]) await start(n, true);
  link(a, b);
  await settle(a, b);
  await a.engine.setActive(false);
  link(b, c);
  await settle(b, c);
  await b.engine.setActive(false);
  link(c, d);
  await settle(c, d);
  await c.engine.setActive(false);
  link(d, e);
  await settle(d, e);
  assert.equal(d.receives(), 1);
  assert.equal(e.receives(), 0);
  assert.equal(d.engine.getSnapshot().records[0].envelope.hops, 3);

  const sender = node(10),
    first = node(11),
    second = node(12),
    third = node(13);
  capture(sender);
  for (const n of [sender, first, second, third]) await start(n);
  link(sender, first);
  link(sender, second);
  await settle(sender, first, second);
  assert.equal(sender.transport.sent, 2);
  await first.engine.setActive(false);
  await settle(sender);
  link(sender, third);
  await settle(sender, third);
  assert.equal(third.receives(), 1);
  assert.equal(sender.transport.sent, 3);
});

test("no receipt is sent if the library saves but the journal fails; restart reconciles the same Inbox ID", async () => {
  const a = node(1),
    b = node(2);
  capture(a);
  await start(a);
  await start(b);
  b.failWrite(true);
  link(a, b);
  await settle(a, b);
  assert.equal(b.receives(), 1);
  assert.equal(a.engine.getSnapshot().records[0].deliveredTo.length, 0);
  assert.equal(
    b.transport.controls.filter((c) => c.frame.type === "receipt").length,
    0,
  );
  b.failWrite(false);
  await b.engine.dispose();
  const restarted = node(2, b);
  restarted.transport.fileMap = b.transport.fileMap;
  await start(restarted);
  link(a, restarted);
  await settle(a, restarted);
  assert.equal(restarted.items.length, 1);
  assert.equal(
    restarted.receives(),
    0,
    "reuse the durable library commit after a crash",
  );
  assert.equal(a.engine.getSnapshot().records[0].deliveredTo.length, 1);
});

test("failed incoming validation cancels admission, retries without a timeout, and clears the warning only after durable recovery", async () => {
  const a = node(1),
    b = node(2);
  capture(a);
  await start(a);
  await start(b);
  const validate = b.deps.media.validate;
  b.deps.media.validate = async () => {
    throw new Error(
      "Couldn’t prepare incoming media. It will retry automatically.",
    );
  };
  link(a, b);
  await settle(a, b);
  assert.equal(b.receives(), 0);
  assert.equal(b.engine.getSnapshot().status, "error");
  assert.equal(a.engine.getSnapshot().transfer, undefined);
  assert.equal(b.engine.getSnapshot().transfer, undefined);
  assert.equal(
    b.transport.controls.filter((c) => c.frame.type === "receipt").length,
    0,
  );
  assert.ok(b.transport.controls.some((c) => c.frame.type === "cancel"));
  let adopted: string | undefined;
  b.deps.media.validate = async (uri, offer) => {
    const draft = await validate(uri, offer);
    adopted = uri.replace(/\.bin$/, ".mp4");
    b.transport.fileMap.set(adopted, b.transport.fileMap.get(uri)!);
    return { ...draft, uri: adopted };
  };
  for (const n of [a, b]) n.setTime(now + 10_000);
  await settle(a, b);
  assert.equal(b.receives(), 1);
  assert.equal(a.engine.getSnapshot().records[0].deliveredTo.length, 1);
  assert.equal(b.engine.getSnapshot().error, undefined);
  assert.equal(b.engine.getSnapshot().status, "discovering");
  assert.ok(adopted && b.discarded.includes(adopted));
  assert.equal(b.transport.fileMap.has(adopted!), false);
});

test("an outgoing transfer warning clears after retry and a durable peer receipt", async () => {
  const a = node(1),
    b = node(2);
  capture(a);
  await start(a);
  await start(b);
  const sendFile = a.transport.sendFile;
  a.transport.sendFile = async () => {
    throw new Error("Couldn’t send media.");
  };
  discover(a, b);
  await settle(a, b);
  assert.equal(a.engine.getSnapshot().status, "error");
  a.transport.sendFile = sendFile;
  for (const n of [a, b]) n.setTime(now + 10_000);
  await settle(a, b);
  assert.equal(b.receives(), 1);
  assert.equal(a.engine.getSnapshot().error, undefined);
  assert.equal(a.engine.getSnapshot().status, "discovering");
});

test("admission rejects full tombstone journals without evicting deletion protection", async () => {
  const b = node(2);
  await b.engine.initialize();
  const journal = JSON.parse(b.data.get(MESH_STORAGE_KEY)!);
  journal.seen = Array.from({ length: MESH_LIMITS.tombstones }, (_, index) => ({
    id: hash(String(index)),
    until: now + MESH_LIMITS.lifetime,
  }));
  b.data.set(MESH_STORAGE_KEY, JSON.stringify(journal));
  const full = node(2, b);
  await start(full);
  acceptPeer(full, "peer-1", identity(1));
  full.transport.emit({ type: "connected", peerId: "peer-1" });
  full.transport.emit({
    type: "control",
    peerId: "peer-1",
    text: JSON.stringify({
      v: 1,
      type: "hello",
      nodeId: "00000000-0000-4000-8000-000000000001",
    }),
  });
  full.transport.emit({
    type: "control",
    peerId: "peer-1",
    text: JSON.stringify({ v: 1, type: "offer", envelope }),
  });
  await settle(full);
  assert.equal(full.transport.expected.size, 0);
  assert.ok(full.transport.controls.some((c) => c.frame.type === "busy"));
  assert.equal(
    JSON.parse(full.data.get(MESH_STORAGE_KEY)!).seen.length,
    MESH_LIMITS.tombstones,
  );
});

test("transport changes persist the queue and receipts, stop old links, and restore the selected mode", async () => {
  const a = node(1),
    b = node(2);
  const selected: string[] = [];
  a.transport.select = (mode) => {
    assert.equal(a.transport.running, false);
    selected.push(mode);
  };
  capture(a);
  await start(a);
  await start(b);
  link(a, b);
  await settle(a, b);
  const before = a.engine.getSnapshot().records;
  await a.engine.configure({ transport: "nearby" });
  assert.deepEqual(selected, ["ble", "nearby"]);
  assert.equal(a.engine.getSnapshot().transport, "nearby");
  assert.deepEqual(a.engine.getSnapshot().records, before);
  assert.equal(a.engine.getSnapshot().peers.length, 0);
  await a.engine.dispose();
  const restarted = node(1, a);
  const restored: string[] = [];
  restarted.transport.select = (mode) => restored.push(mode);
  await start(restarted);
  assert.deepEqual(restored, ["nearby"]);
  assert.deepEqual(restarted.engine.getSnapshot().records, before);
});
