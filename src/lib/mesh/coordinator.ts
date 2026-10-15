import type {
  MeshDependencies,
  MeshEnvelope,
  MeshFrame,
  MeshJournal,
  MeshPeer,
  MeshSnapshot,
  TransportEvent,
} from "../../types/mesh";
import type { MediaDraft } from "../../types/media";
import { APP } from "../../constants/app";
import {
  discoveryIdentity,
  discoveryName,
  DISCOVERY_LIMITS,
} from "./discovery";
import {
  decodeFrame,
  encodeFrame,
  hashPattern,
  MESH_LIMITS,
  nodePattern,
  validateEnvelope,
} from "./protocol";

export const MESH_STORAGE_KEY = `${APP.storagePrefix}.mesh.v1`;
type Session = {
  nodeId?: string;
  connectedAt: number;
  lastActivity: number;
  have: Set<string>;
  sent: number;
  received: number;
  controls: number;
  windowAt: number;
};
type Candidate = {
  nodeId: string;
  visible: boolean;
  attempts: number;
  retryAfter: number;
  deadline?: number;
  accepted?: boolean;
};
type Work = {
  peerId: string;
  envelope: MeshEnvelope;
  deadline: number;
  bytes: number;
  attempts?: number;
  mediaId?: string;
};

/** Foreground, opt-in broadcast mesh. Transport callbacks and journal mutations are serialized. */
export class MeshCoordinator {
  private journal?: MeshJournal;
  private active = false;
  private running = false;
  private lastError?: string;
  private peers = new Map<string, MeshPeer>();
  private sessions = new Map<string, Session>();
  private candidates = new Map<string, Candidate>();
  private generation = 0;
  private outgoing?: Work;
  private incoming?: Work;
  private retries = new Map<string, { attempts: number; after: number }>();
  private examined = new Set<string>();
  private listeners = new Set<(state: MeshSnapshot) => void>();
  private operations = Promise.resolve();
  private initialization?: Promise<void>;
  private unsubscribe?: () => void;
  private snapshot: MeshSnapshot = {
    updatedAt: 0,
    status: "loading",
    enabled: false,
    relay: false,
    peers: [],
    records: [],
  };
  private now: () => number;

  constructor(private deps: MeshDependencies) {
    this.now = deps.now ?? Date.now;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (callback: (state: MeshSnapshot) => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };

  private publish(error?: string) {
    if (error) this.lastError = error;
    this.snapshot = {
      updatedAt: this.now(),
      status: !this.deps.transport.available
        ? "unavailable"
        : this.lastError
          ? "error"
          : !this.journal?.enabled
            ? "off"
            : !this.active
              ? "paused"
              : "discovering",
      enabled: this.journal?.enabled ?? false,
      relay: this.journal?.relay ?? false,
      peers: [...this.peers.values()],
      records: this.journal?.records ?? [],
      error: this.lastError,
      transfer: this.outgoing
        ? {
            mediaId: this.outgoing.mediaId,
            direction: "sending",
            bytes: this.outgoing.bytes,
            total: this.outgoing.envelope.bytes,
          }
        : this.incoming
          ? {
              direction: "receiving",
              bytes: this.incoming.bytes,
              total: this.incoming.envelope.bytes,
            }
          : undefined,
    };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
  private serial(action: () => Promise<void>) {
    const next = this.operations.then(action);
    this.operations = next.catch((error) =>
      this.publish(
        error instanceof Error ? error.message : "Bluetooth sharing failed.",
      ),
    );
    return next;
  }
  private async commit(next: MeshJournal) {
    await this.deps.storage.setItem(MESH_STORAGE_KEY, JSON.stringify(next));
    this.journal = next;
    this.publish();
  }
  initialize() {
    if (this.journal) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      await this.deps.media.ready?.();
      const raw = await this.deps.storage.getItem(MESH_STORAGE_KEY);
      if (raw === null) {
        await this.commit({
          version: 1,
          nodeId: this.deps.uuid(),
          enabled: false,
          relay: false,
          records: [],
          seen: [],
        });
      } else {
        const j = JSON.parse(raw) as MeshJournal & { transport?: unknown };
        if (
          !j ||
          j.version !== 1 ||
          !nodePattern.test(j.nodeId) ||
          typeof j.enabled !== "boolean" ||
          typeof j.relay !== "boolean" ||
          (j.transport !== undefined &&
            j.transport !== "ble" &&
            j.transport !== "nearby") ||
          !Array.isArray(j.records) ||
          j.records.length > MESH_LIMITS.records ||
          !Array.isArray(j.seen) ||
          j.seen.length > MESH_LIMITS.tombstones
        )
          throw new Error("Couldn’t open the mesh journal.");
        const ids = new Set<string>();
        for (const record of j.records) {
          // Validate old records against their creation time, then prune expiry below.
          validateEnvelope(record.envelope, record.envelope.createdAt);
          if (
            ids.has(record.envelope.id) ||
            typeof record.mediaId !== "string" ||
            !/^[a-zA-Z0-9_-]{1,100}$/.test(record.mediaId) ||
            typeof record.local !== "boolean" ||
            !Number.isSafeInteger(record.admittedAt) ||
            record.admittedAt <= 0 ||
            !Array.isArray(record.deliveredTo) ||
            record.deliveredTo.length > MESH_LIMITS.receipts ||
            !record.deliveredTo.every((id) => nodePattern.test(id))
          )
            throw new Error("Invalid mesh journal.");
          if (
            record.receivedFrom !== undefined &&
            !nodePattern.test(record.receivedFrom)
          )
            throw new Error("Invalid mesh sender record.");
          ids.add(record.envelope.id);
        }
        if (
          j.seen.some(
            (s) =>
              !s || !hashPattern.test(s.id) || !Number.isSafeInteger(s.until),
          )
        )
          throw new Error("Invalid mesh receipts.");
        if (j.transport !== undefined) {
          // Older releases saved a transport choice. Preserve every record and
          // sharing preference while retiring that choice, including Nearby.
          delete j.transport;
          await this.commit(j);
        } else this.journal = j;
      }
      this.unsubscribe = this.deps.transport.subscribe((event) => {
        void this.serial(() => this.event(event)).catch(() => undefined);
      });
      await this.prune();
      this.publish();
    })()
      .catch((error) => {
        this.publish(error.message);
        throw error;
      })
      .finally(() => {
        this.initialization = undefined;
      });
    return this.initialization;
  }
  configure(options: { enabled?: boolean; relay?: boolean }) {
    return this.serial(async () => {
      await this.initialize();
      this.lastError = undefined;
      await this.commit({ ...this.journal!, ...options });
      if (options.enabled === true && this.running) {
        // An explicit Retry restarts radio discovery after permissions or radios change.
        await this.deps.transport.stop();
        this.running = false;
        this.peers.clear();
        this.sessions.clear();
        this.candidates.clear();
        this.generation++;
        this.outgoing = undefined;
        this.incoming = undefined;
      }
      if (
        options.relay === false &&
        this.outgoing &&
        !this.journal!.records.find((r) => r.mediaId === this.outgoing!.mediaId)
          ?.local
      ) {
        await this.cancel(this.outgoing);
        this.outgoing = undefined;
      }
      await this.reconcile();
    });
  }
  setActive(active: boolean) {
    return this.serial(async () => {
      await this.initialize();
      this.active = active;
      await this.reconcile();
    });
  }
  private async reconcile() {
    const shouldRun =
      !!this.journal?.enabled && this.active && this.deps.transport.available;
    if (!shouldRun && this.running) {
      this.running = false;
      await this.deps.transport.stop();
      this.peers.clear();
      this.sessions.clear();
      this.candidates.clear();
      this.generation++;
      this.outgoing = undefined;
      this.incoming = undefined;
    } else if (shouldRun && !this.running) {
      try {
        await this.deps.transport.start(discoveryName(this.journal!.nodeId));
        this.running = true;
        this.lastError = undefined;
      } catch (error) {
        await this.deps.transport.stop().catch(() => undefined);
        throw error;
      }
    }
    this.publish();
    if (this.running) await this.sync();
  }
  tick() {
    return this.serial(async () => {
      await this.initialize();
      await this.prune();
      for (const work of [this.outgoing, this.incoming]) {
        if (
          work &&
          (work.deadline <= this.now() || work.envelope.expiresAt <= this.now())
        ) {
          await this.cancel(work);
          if (work === this.outgoing) {
            this.defer(work.peerId, work.envelope.id);
            this.outgoing = undefined;
          }
          if (work === this.incoming) this.incoming = undefined;
        }
      }
      if (this.running) {
        await this.schedulePeers();
        await this.sync();
      }
      this.publish();
    });
  }
  private async prune() {
    const j = this.journal!;
    const items = new Set(this.deps.media.items().map((i) => i.id));
    const records = j.records.filter(
      (r) =>
        r.envelope.expiresAt > this.now() &&
        r.admittedAt + MESH_LIMITS.lifetime > this.now() &&
        items.has(r.mediaId),
    );
    const seen = j.seen.filter((s) => s.until > this.now());
    if (records.length !== j.records.length || seen.length !== j.seen.length)
      await this.commit({ ...j, records, seen });
    if (
      this.outgoing &&
      !records.some((r) => r.envelope.id === this.outgoing!.envelope.id)
    ) {
      await this.cancel(this.outgoing);
      this.outgoing = undefined;
    }
    const currentIds = new Set(this.deps.media.items().map((i) => i.id));
    for (const id of this.examined)
      if (!currentIds.has(id)) this.examined.delete(id);
  }
  private async cancel(work: Work) {
    await this.deps.transport.cancelFile(work.peerId).catch(() => undefined);
    if (this.sessions.has(work.peerId))
      await this.send(work.peerId, {
        v: 1,
        type: "cancel",
        id: work.envelope.id,
      }).catch(() => undefined);
  }
  private async sync() {
    const j = this.journal!;
    // Reconcile captures from the library, including captures saved while radios were unavailable.
    for (const item of this.deps.media
      .items()
      .filter((i) => i.direction === "outgoing")) {
      if (item.createdAt + MESH_LIMITS.lifetime <= this.now()) continue;
      if (this.examined.has(item.id)) continue;
      if (
        j.records.some((r) => r.mediaId === item.id) ||
        this.journal!.records.some((r) => r.mediaId === item.id)
      )
        continue;
      if (
        this.journal!.records.length >= MESH_LIMITS.records ||
        this.journal!.seen.length >= MESH_LIMITS.tombstones
      )
        break;
      const digest = await this.deps.media.hash(this.deps.media.uri(item));
      if (this.journal!.seen.some((s) => s.id === digest.hash)) {
        this.examined.add(item.id);
        continue;
      }
      const now = this.now();
      // A capture expires relative to capture time. Old captures never re-enroll after expiry.
      const envelope = validateEnvelope(
        {
          id: digest.hash,
          kind: item.kind,
          bytes: digest.bytes,
          createdAt: item.createdAt,
          expiresAt: item.createdAt + MESH_LIMITS.lifetime,
          hops: 0,
        },
        now,
      );
      if (this.cacheBytes() + envelope.bytes > MESH_LIMITS.cacheBytes) break;
      await this.commit({
        ...this.journal!,
        records: [
          ...this.journal!.records,
          {
            envelope,
            mediaId: item.id,
            local: true,
            admittedAt: now,
            deliveredTo: [],
          },
        ],
        seen: [
          ...this.journal!.seen,
          { id: digest.hash, until: now + 2 * MESH_LIMITS.lifetime },
        ],
      });
      this.examined.add(item.id);
      await this.announce([envelope.id]);
    }
    await this.pump();
  }
  private cacheBytes() {
    return this.journal!.records.reduce(
      (total, r) => total + r.envelope.bytes,
      0,
    );
  }
  private send(peerId: string, frame: MeshFrame) {
    return this.deps.transport.sendControl(peerId, encodeFrame(frame));
  }
  private async announce(ids: string[], peerId?: string) {
    for (const id of peerId ? [peerId] : [...this.sessions.keys()]) {
      for (
        let offset = 0;
        offset < ids.length;
        offset += MESH_LIMITS.inventoryPage
      )
        await this.send(id, {
          v: 1,
          type: "inventory",
          ids: ids.slice(offset, offset + MESH_LIMITS.inventoryPage),
        });
    }
  }
  private async pump() {
    if (!this.running || this.outgoing) return;
    for (const [peerId, session] of this.sessions) {
      if (!session.nodeId) continue;
      if (this.incoming?.peerId === peerId) continue;
      const record = [...this.journal!.records]
        .sort((a, b) => Number(b.local) - Number(a.local))
        .find(
          (r) =>
            (r.local || this.journal!.relay) &&
            r.envelope.hops < MESH_LIMITS.hops &&
            !r.deliveredTo.includes(session.nodeId!) &&
            !session.have.has(r.envelope.id) &&
            r.receivedFrom !== session.nodeId &&
            session.sent + r.envelope.bytes <= MESH_LIMITS.sessionBytes &&
            (this.retries.get(`${peerId}:${r.envelope.id}`)?.after ?? 0) <=
              this.now(),
        );
      if (!record) continue;
      this.outgoing = {
        peerId,
        envelope: { ...record.envelope, hops: record.envelope.hops + 1 },
        mediaId: record.mediaId,
        deadline: this.now() + MESH_LIMITS.timeout,
        bytes: 0,
      };
      try {
        await this.send(peerId, {
          v: 1,
          type: "offer",
          envelope: this.outgoing.envelope,
        });
      } catch (error) {
        this.defer(peerId, record.envelope.id);
        this.outgoing = undefined;
        throw error;
      }
      this.publish();
      return;
    }
  }
  private defer(peerId: string, id: string) {
    const key = `${peerId}:${id}`;
    const attempts = (this.retries.get(key)?.attempts ?? 0) + 1;
    this.retries.set(key, {
      attempts,
      after:
        attempts >= MESH_LIMITS.retries
          ? Infinity
          : this.now() +
            Math.min(60_000, 2000 * 2 ** attempts) +
            Math.floor(Math.random() * 1000),
    });
  }
  private connectionCount(except?: string) {
    return [...this.peers.values()].filter(
      (peer) => peer.id !== except && peer.state !== "nearby",
    ).length;
  }
  private async releasePeer(
    peerId: string,
    failed: boolean,
    disconnect = true,
  ) {
    const candidate = this.candidates.get(peerId);
    if (candidate) {
      candidate.deadline = undefined;
      candidate.accepted = false;
      if (failed) candidate.attempts++;
      candidate.retryAfter =
        this.now() +
        (failed
          ? Math.min(
              DISCOVERY_LIMITS.retryMax,
              DISCOVERY_LIMITS.retryBase *
                2 ** Math.min(candidate.attempts - 1, 4),
            )
          : DISCOVERY_LIMITS.rotationCooldown);
      if (candidate.visible)
        this.peers.set(peerId, {
          id: peerId,
          name: `Piper ${candidate.nodeId.slice(0, 4)}`,
          state: "nearby",
        });
      else {
        this.peers.delete(peerId);
        this.candidates.delete(peerId);
      }
    } else this.peers.delete(peerId);
    this.sessions.delete(peerId);
    if (this.outgoing?.peerId === peerId) {
      this.defer(peerId, this.outgoing.envelope.id);
      this.outgoing = undefined;
    }
    if (this.incoming?.peerId === peerId) this.incoming = undefined;
    if (disconnect)
      await this.deps.transport.disconnect(peerId).catch(() => undefined);
  }
  private async schedulePeers() {
    if (!this.running) return;
    for (const [peerId, candidate] of this.candidates) {
      if (
        !candidate.visible &&
        !this.peers.has(peerId) &&
        candidate.retryAfter <= this.now()
      ) {
        this.candidates.delete(peerId);
        continue;
      }
      if (candidate.deadline && candidate.deadline <= this.now())
        await this.releasePeer(peerId, true);
    }
    // A connected peer that never sends a hello cannot occupy a slot forever.
    for (const [peerId, session] of this.sessions) {
      if (
        !session.nodeId &&
        session.connectedAt + DISCOVERY_LIMITS.handshakeTimeout <= this.now()
      )
        await this.releasePeer(peerId, true);
    }
    const waiting = [...this.candidates.entries()]
      .filter(
        ([peerId, c]) =>
          c.visible &&
          c.retryAfter <= this.now() &&
          this.peers.get(peerId)?.state === "nearby",
      )
      .sort(
        (a, b) =>
          a[1].retryAfter - b[1].retryAfter ||
          a[1].nodeId.localeCompare(b[1].nodeId),
      );
    if (waiting.length && this.connectionCount() >= MESH_LIMITS.peers) {
      const idle = [...this.sessions.entries()]
        .filter(
          ([peerId, s]) =>
            s.nodeId &&
            s.lastActivity + DISCOVERY_LIMITS.rotationAfter <= this.now() &&
            this.outgoing?.peerId !== peerId &&
            this.incoming?.peerId !== peerId,
        )
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity)[0];
      if (idle) await this.releasePeer(idle[0], false);
    }
    for (const [peerId, candidate] of waiting) {
      if (this.connectionCount() >= MESH_LIMITS.peers) break;
      if (this.journal!.nodeId >= candidate.nodeId) continue;
      // Reserve before calling native. Repeated discovery events cannot double-dial.
      candidate.deadline = this.now() + DISCOVERY_LIMITS.connectTimeout;
      candidate.accepted = false;
      this.peers.set(peerId, {
        ...this.peers.get(peerId)!,
        state: "connecting",
      });
      const generation = this.generation;
      const deadline = candidate.deadline;
      // Keep event processing alive while a radio connection is pending.
      void this.deps.transport.connect(peerId).catch(() => {
        void this.serial(async () => {
          if (
            generation !== this.generation ||
            this.candidates.get(peerId)?.deadline !== deadline ||
            this.peers.get(peerId)?.state !== "connecting"
          )
            return;
          await this.releasePeer(peerId, true);
          this.publish();
        }).catch(() => undefined);
      });
    }
  }
  private async event(event: TransportEvent) {
    if (
      event.type === "file" &&
      (!this.running || !this.incoming || this.incoming.peerId !== event.peerId)
    ) {
      this.deps.media.discard(event.uri);
      return;
    }
    if (!this.running) return;
    if (event.type === "found") {
      const nodeId = discoveryIdentity(event.name);
      if (!nodeId || nodeId === this.journal!.nodeId) return;
      let existing = this.candidates.get(event.peerId);
      if (existing && existing.nodeId !== nodeId) return;
      if (!existing) {
        const previous = [...this.candidates.entries()].find(
          ([, c]) => c.nodeId === nodeId,
        );
        if (previous) {
          if (
            this.peers.get(previous[0])?.state &&
            this.peers.get(previous[0])?.state !== "nearby"
          )
            return;
          existing = previous[1];
          this.candidates.delete(previous[0]);
          this.peers.delete(previous[0]);
        }
      }
      if (!existing && this.candidates.size >= DISCOVERY_LIMITS.candidates)
        return;
      this.candidates.set(
        event.peerId,
        existing
          ? { ...existing, visible: true }
          : { nodeId, visible: true, attempts: 0, retryAfter: 0 },
      );
      if (!this.peers.has(event.peerId))
        this.peers.set(event.peerId, {
          id: event.peerId,
          name: `Piper ${nodeId.slice(0, 4)}`,
          state: "nearby",
        });
      await this.schedulePeers();
    }
    if (event.type === "lost") {
      const candidate = this.candidates.get(event.peerId);
      if (candidate) candidate.visible = false;
      if (this.peers.get(event.peerId)?.state === "nearby") {
        this.peers.delete(event.peerId);
        if (!candidate || candidate.retryAfter <= this.now())
          this.candidates.delete(event.peerId);
      }
    }
    if (event.type === "pairing") {
      const nodeId = discoveryIdentity(event.name);
      const existing = this.candidates.get(event.peerId);
      if (
        !nodeId ||
        nodeId === this.journal!.nodeId ||
        (existing && existing.nodeId !== nodeId) ||
        this.connectionCount(event.peerId) >= MESH_LIMITS.peers ||
        (!existing && this.candidates.size >= DISCOVERY_LIMITS.candidates) ||
        [...this.candidates.entries()].some(
          ([id, c]) =>
            id !== event.peerId &&
            c.nodeId === nodeId &&
            this.peers.get(id)?.state !== "nearby",
        )
      ) {
        await this.deps.transport
          .verify(event.peerId, false)
          .catch(() => undefined);
        return;
      }
      if (this.sessions.has(event.peerId)) return;
      if (existing?.accepted) return;
      this.candidates.set(
        event.peerId,
        existing ?? { nodeId, visible: false, attempts: 0, retryAfter: 0 },
      );
      this.candidates.get(event.peerId)!.deadline =
        this.now() + DISCOVERY_LIMITS.connectTimeout;
      this.candidates.get(event.peerId)!.accepted = true;
      this.peers.set(event.peerId, {
        id: event.peerId,
        name: `Piper ${nodeId.slice(0, 4)}`,
        state: "connecting",
      });
      try {
        await this.deps.transport.verify(event.peerId, true);
      } catch {
        await this.releasePeer(event.peerId, true);
      }
    }
    if (event.type === "connected") {
      if (this.sessions.has(event.peerId)) return;
      if (this.connectionCount(event.peerId) >= MESH_LIMITS.peers) {
        await this.deps.transport.disconnect(event.peerId);
        return;
      }
      const candidate = this.candidates.get(event.peerId);
      if (
        !candidate?.accepted ||
        this.peers.get(event.peerId)?.state !== "connecting"
      ) {
        await this.deps.transport
          .disconnect(event.peerId)
          .catch(() => undefined);
        return;
      }
      if (candidate) {
        candidate.deadline = undefined;
        candidate.attempts = 0;
      }
      for (const key of this.retries.keys()) {
        if (key.startsWith(`${event.peerId}:`)) this.retries.delete(key);
      }
      this.peers.set(event.peerId, {
        id: event.peerId,
        name: this.peers.get(event.peerId)?.name ?? "Nearby",
        state: "connected",
      });
      this.sessions.set(event.peerId, {
        connectedAt: this.now(),
        lastActivity: this.now(),
        have: new Set(),
        sent: 0,
        received: 0,
        controls: 0,
        windowAt: this.now(),
      });
      await this.send(event.peerId, {
        v: 1,
        type: "hello",
        nodeId: this.journal!.nodeId,
      });
      await this.announce(
        this.journal!.seen.map((s) => s.id),
        event.peerId,
      );
    }
    if (event.type === "disconnected") {
      if (!this.peers.has(event.peerId) && !this.sessions.has(event.peerId))
        return;
      // Locally released peers already have their cooldown. Don't count twice.
      if (this.peers.get(event.peerId)?.state !== "nearby") {
        await this.releasePeer(event.peerId, true, false);
      }
      await this.schedulePeers();
      await this.pump();
    }
    if (event.type === "control") {
      const session = this.sessions.get(event.peerId);
      if (!session) return;
      session.lastActivity = this.now();
      if (this.now() - session.windowAt > 60_000) {
        session.controls = 0;
        session.windowAt = this.now();
      }
      try {
        if (++session.controls > 240)
          throw new Error("Peer exceeded the control limit.");
        await this.frame(event.peerId, decodeFrame(event.text, this.now()));
      } catch (error) {
        await this.deps.transport
          .disconnect(event.peerId)
          .catch(() => undefined);
        throw error;
      }
    }
    if (event.type === "file") await this.receiveFile(event.peerId, event.uri);
    if (event.type === "progress") {
      const work =
        event.direction === "sending" && this.outgoing?.peerId === event.peerId
          ? this.outgoing
          : event.direction === "receiving" &&
              this.incoming?.peerId === event.peerId
            ? this.incoming
            : undefined;
      if (work && event.bytes > work.bytes) {
        work.bytes = Math.min(event.bytes, work.envelope.bytes);
        work.deadline = this.now() + MESH_LIMITS.timeout;
      }
    }
    if (event.type === "error") throw new Error(event.message);
    this.publish();
  }
  private async frame(peerId: string, frame: MeshFrame) {
    const session = this.sessions.get(peerId)!;
    if (frame.type === "hello") {
      if (
        (session.nodeId && session.nodeId !== frame.nodeId) ||
        frame.nodeId === this.journal!.nodeId ||
        (this.candidates.has(peerId) &&
          this.candidates.get(peerId)!.nodeId !== frame.nodeId) ||
        [...this.sessions.entries()].some(
          ([id, s]) => id !== peerId && s.nodeId === frame.nodeId,
        )
      )
        throw new Error("Invalid session identity.");
      session.nodeId = frame.nodeId;
      await this.pump();
      return;
    }
    if (!session.nodeId) throw new Error("Missing mesh handshake.");
    if (frame.type === "inventory") {
      frame.ids.forEach((id) => session.have.add(id));
      if (session.have.size > MESH_LIMITS.tombstones)
        throw new Error("Peer inventory too large.");
      await this.pump();
      return;
    }
    if (frame.type === "cancel") {
      if (
        this.incoming?.peerId === peerId &&
        this.incoming.envelope.id === frame.id
      ) {
        await this.deps.transport.cancelFile(peerId);
        this.incoming = undefined;
      }
      if (
        this.outgoing?.peerId === peerId &&
        this.outgoing.envelope.id === frame.id
      ) {
        await this.deps.transport.cancelFile(peerId);
        this.defer(peerId, frame.id);
        this.outgoing = undefined;
      }
      return;
    }
    if (frame.type === "offer") {
      const envelope = frame.envelope;
      if (this.journal!.seen.some((s) => s.id === envelope.id)) {
        await this.send(peerId, { v: 1, type: "receipt", id: envelope.id });
        return;
      }
      // Resolve simultaneous offers deterministically to prevent symmetric busy/retry loops.
      if (this.outgoing?.peerId === peerId) {
        if (this.journal!.nodeId < session.nodeId) {
          await this.send(peerId, { v: 1, type: "busy", id: envelope.id });
          return;
        }
        const yielded = this.outgoing;
        await this.cancel(yielded);
        this.defer(peerId, yielded.envelope.id);
        this.outgoing = undefined;
      }
      if (
        this.incoming ||
        this.journal!.records.length >= MESH_LIMITS.records ||
        this.journal!.seen.length >= MESH_LIMITS.tombstones ||
        this.cacheBytes() + envelope.bytes > MESH_LIMITS.cacheBytes ||
        session.received + envelope.bytes > MESH_LIMITS.sessionBytes
      ) {
        await this.send(peerId, { v: 1, type: "busy", id: envelope.id });
        return;
      }
      await this.deps.transport.expectFile(peerId, envelope.bytes, envelope.id);
      session.received += envelope.bytes;
      session.have.add(envelope.id);
      this.incoming = {
        peerId,
        envelope,
        deadline: this.now() + MESH_LIMITS.timeout,
        bytes: 0,
      };
      await this.send(peerId, { v: 1, type: "accept", id: envelope.id });
      return;
    }
    if (
      !this.outgoing ||
      this.outgoing.peerId !== peerId ||
      this.outgoing.envelope.id !== frame.id
    )
      return;
    if (frame.type === "busy") {
      this.defer(peerId, frame.id);
      this.outgoing = undefined;
      await this.pump();
      return;
    }
    if (frame.type === "accept") {
      if (this.outgoing.attempts) return; // Duplicate accept must not launch another file.
      const item = this.deps.media
        .items()
        .find((i) => i.id === this.outgoing!.mediaId);
      if (!item) {
        this.outgoing = undefined;
        return;
      }
      this.outgoing.attempts = 1;
      session.sent += this.outgoing.envelope.bytes;
      await this.deps.transport.sendFile(
        peerId,
        this.deps.media.uri(item),
        this.outgoing.envelope.id,
      );
      return;
    }
    if (frame.type === "receipt") {
      await this.commit({
        ...this.journal!,
        records: this.journal!.records.map((r) =>
          r.envelope.id === frame.id
            ? {
                ...r,
                deliveredTo: [
                  ...new Set([...r.deliveredTo, session.nodeId!]),
                ].slice(-MESH_LIMITS.receipts),
              }
            : r,
        ),
      });
      session.have.add(frame.id);
      this.outgoing = undefined;
      this.lastError = undefined;
      await this.pump();
    }
  }
  private async receiveFile(peerId: string, uri: string) {
    const work = this.incoming!;
    const session = this.sessions.get(peerId)!;
    let draft: MediaDraft | undefined;
    try {
      validateEnvelope(work.envelope, this.now());
      const digest = await this.deps.media.hash(uri);
      if (
        digest.bytes !== work.envelope.bytes ||
        digest.hash !== work.envelope.id
      )
        throw new Error("Incoming media failed its integrity check.");
      draft = await this.deps.media.validate(uri, work.envelope);
      // Deterministic ID reconciles a crash between library commit and journal commit.
      const item = await this.deps.media.receive(
        `mesh-${work.envelope.id}`,
        this.peers.get(peerId)?.name ?? "Nearby",
        draft,
      );
      const now = this.now();
      await this.commit({
        ...this.journal!,
        records: [
          ...this.journal!.records,
          {
            envelope: work.envelope,
            mediaId: item.id,
            local: false,
            admittedAt: now,
            deliveredTo: [],
            receivedFrom: session.nodeId!,
          },
        ],
        seen: [
          ...this.journal!.seen,
          { id: work.envelope.id, until: now + 2 * MESH_LIMITS.lifetime },
        ],
      });
      await this.send(peerId, { v: 1, type: "receipt", id: work.envelope.id });
      this.lastError = undefined;
      await this.announce([work.envelope.id]);
    } catch (error) {
      // Release admission on both sides so a failed decode retries with backoff
      // instead of keeping the sender waiting for a receipt until timeout.
      await this.cancel(work);
      throw error;
    } finally {
      if (draft && draft.uri !== uri) this.deps.media.discard(draft.uri);
      this.deps.media.discard(uri);
      this.incoming = undefined;
    }
    await this.pump();
  }
  async dispose() {
    await this.setActive(false);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
  }
}
