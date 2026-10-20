// One simulated participant and the network between participants.
//
// A replica is a Yjs document with a collaboration session and a canonical store attached,
// as the editor attaches one. The network delivers updates at once, through a server, or per
// link out of order, and holds them while a replica is offline.

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { TreePackageStore } from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../../packages/pro/src/collaboration/document-session.ts';
import { prepareCollaborationServerDocument } from '../../packages/pro/src/collaboration/server-document.ts';
import { storeFrom } from './document-text.ts';

/**
 * How the simulated network delivers updates:
 *
 * - `in-order`: every update reaches everyone at once. No concurrency.
 * - `server`: one relay orders all updates, and each replica receives that order late, as a
 *   room on a relay server does. Concurrent, but never causally reordered.
 * - `peer`: every pair of replicas has its own link, as a peer-to-peer mesh does. A replica
 *   can receive an edit before the edit it was built on.
 */
export type Delivery = 'in-order' | 'server' | 'peer';

export const NETWORK = 'network';
export const JOIN = 'join';
const PRESENCE = 'presence';

/**
 * What can go wrong with one delivery. A duplicate arrives again later, a dropped update never
 * arrives, and a truncated one arrives cut short; the last two leave the receiver behind until
 * a state-vector sync, as a reconnecting provider runs, brings what it missed.
 */
export type Fault = 'duplicate' | 'drop' | 'truncate';

export interface Replica {
  readonly index: number;
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly handle: DocumentCollaborationHandle;
  readonly store: TreePackageStore;
  readonly port: CollaborationDocumentPort;
  readonly detach: () => void;
  readonly failures: string[];
  online: boolean;
  /** Each local deletion and the origin of its transaction, to explain a divergence. */
  readonly deletions: {
    readonly origin: string;
    readonly client: number;
    readonly clock: number;
    readonly len: number;
  }[];
}

/**
 * The simulated network. Applying a remote update can throw out of a Yjs observer; that is a
 * failure of the library, so it is recorded rather than allowed to end the scenario.
 */
export class Network {
  /** `peer`: one FIFO per ordered pair. */
  private readonly links = new Map<string, Uint8Array[]>();
  /** `server`: the relay's order, and how far each replica has read it. */
  private readonly log: { readonly from: number; readonly update: Uint8Array }[] = [];
  private readonly cursors = new Map<number, number>();
  /**
   * `server`: the room document a server holds, as Hocuspocus does. It receives every update
   * and must never write a change of its own, which it would send to every participant.
   */
  private readonly room = new Y.Doc();
  private roomWrote = false;
  /** `server`: updates a replica made while offline, sent to the relay when it returns. */
  private readonly outbox = new Map<number, Uint8Array[]>();
  /**
   * Updates replicas wrote during the current action, by replica, or null outside one. An
   * action such as an undo writes several transactions at once, and a provider sends them in
   * the same tick, before the receiver renders: they arrive as one message here.
   */
  private batch: Map<number, Uint8Array[]> | null = null;
  /** Called around every update a replica receives, to carry a caret across it. */
  private readonly receivers: {
    readonly before: (replica: Replica) => void;
    readonly after: (replica: Replica) => void;
  }[] = [];

  constructor(
    private readonly replicas: Replica[],
    private readonly delivery: Delivery,
    private readonly problems: string[]
  ) {
    if (delivery !== 'server') return;
    prepareCollaborationServerDocument(this.room);
    this.room.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === NETWORK || this.roomWrote) return;
      this.roomWrote = true;
      this.problems.push('the room server wrote a change of its own');
    });
  }

  /** `server`: an update reaches the relay, and the room document the server holds. */
  private relay(from: number, update: Uint8Array): void {
    this.log.push({ from, update });
    try {
      Y.applyUpdate(this.room, update, NETWORK);
    } catch (error) {
      this.problems.push(`the room server could not apply an update: ${(error as Error).message}`);
    }
  }

  /** Hear every update a replica receives, before and after it applies. */
  onReceive(before: (replica: Replica) => void, after: (replica: Replica) => void): void {
    this.receivers.push({ before, after });
  }

  connect(replica: Replica, readFrom = this.log.length, lateJoin = false): void {
    this.cursors.set(replica.index, readFrom);
    // The room holds what the replica joined with, as a server holds the room it serves.
    if (this.delivery === 'server')
      Y.applyUpdate(this.room, Y.encodeStateAsUpdate(replica.ydoc), NETWORK);
    // Presence is not stored: a peer that is online hears it at once, and one that is offline
    // hears the next one after it returns.
    replica.awareness.on(
      'update',
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === PRESENCE || !replica.online) return;
        const clients = [...changes.added, ...changes.updated, ...changes.removed];
        const update = encodeAwarenessUpdate(replica.awareness, clients);
        for (const other of this.replicas) {
          if (other !== replica && other.online) {
            applyAwarenessUpdate(other.awareness, update, PRESENCE);
          }
        }
      }
    );
    // A peer that connects late runs the Yjs sync handshake with every peer, as y-webrtc does:
    // each sends its whole state, so nothing in flight elsewhere is missed.
    if (lateJoin && this.delivery === 'peer') {
      for (const other of this.replicas) {
        if (other === replica) continue;
        const key = `${other.index}>${replica.index}`;
        this.links.set(key, [...(this.links.get(key) ?? []), Y.encodeStateAsUpdate(other.ydoc)]);
      }
    }
    replica.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === NETWORK || origin === JOIN) return;
      if (this.batch) {
        this.batch.set(replica.index, [...(this.batch.get(replica.index) ?? []), update]);
        return;
      }
      this.send(replica, update);
    });
  }

  /** Collect what replicas write until `endAction`. */
  beginAction(): void {
    this.batch = new Map();
  }

  /** Send what each replica wrote during the action, as one message. */
  endAction(): void {
    const batch = this.batch;
    this.batch = null;
    if (!batch) return;
    for (const [index, updates] of batch) {
      const replica = this.replicas[index];
      if (!replica) continue;
      this.send(replica, updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates));
    }
  }

  private send(replica: Replica, update: Uint8Array): void {
    if (this.delivery === 'server') {
      if (replica.online) this.relay(replica.index, update);
      else this.outbox.set(replica.index, [...(this.outbox.get(replica.index) ?? []), update]);
      return;
    }
    for (const other of this.replicas) {
      if (other === replica) continue;
      if (this.delivery === 'in-order' && replica.online && other.online) {
        this.apply(other, update);
        continue;
      }
      const key = `${replica.index}>${other.index}`;
      this.links.set(key, [...(this.links.get(key) ?? []), update]);
    }
  }

  /** Change a replica's connection, and tell its session, as a provider's status event does. */
  setOnline(replica: Replica, online: boolean): void {
    if (replica.online !== online) {
      replica.handle.session.setTransportStatus(
        online ? 'ready' : 'disconnected',
        online ? undefined : 'transport-disconnected'
      );
    }
    replica.online = online;
    if (online && this.delivery === 'server') {
      for (const update of this.outbox.get(replica.index) ?? []) this.relay(replica.index, update);
      this.outbox.delete(replica.index);
    }
  }

  private apply(replica: Replica, update: Uint8Array, damaged = false): void {
    for (const receiver of this.receivers) receiver.before(replica);
    try {
      Y.applyUpdate(replica.ydoc, update, NETWORK);
    } catch (error) {
      // A cut-short update fails to decode: the provider drops it, and a later sync repairs.
      if (!damaged) {
        const stack = (error as Error).stack?.split('\n').slice(0, 4).join(' | ');
        this.problems.push(
          `replica ${replica.index}: applying a remote update threw ${stack ?? error}`
        );
      }
    }
    for (const receiver of this.receivers) receiver.after(replica);
  }

  /** Deliver one update as `fault` says: twice, not at all, or cut short. */
  private applyWith(replica: Replica, update: Uint8Array, fault: Fault | undefined): boolean {
    if (fault === 'drop') return true;
    if (fault === 'truncate') {
      this.apply(replica, update.subarray(0, Math.max(1, Math.floor(update.length / 2))), true);
      return true;
    }
    this.apply(replica, update);
    // A duplicate stays queued, so it arrives again.
    return fault !== 'duplicate';
  }

  /**
   * The Yjs sync a provider runs on reconnect: `to` sends its state vector, and `from` answers
   * with everything `to` is missing. Updates lost on the way arrive this way.
   */
  resync(target: { readonly to: number; readonly from: number }): void {
    const replica = this.replicas[target.to];
    const source = this.replicas[target.from];
    if (!replica?.online || !source?.online || replica === source) return;
    const missing = Y.encodeStateAsUpdate(source.ydoc, Y.encodeStateVector(replica.ydoc));
    this.apply(replica, missing);
  }

  /** Deliveries that could happen now: one per replica behind the relay, or per live link. */
  pending(): { readonly to: number; readonly from: number }[] {
    if (this.delivery === 'server') {
      return this.replicas
        .filter(
          (replica) => replica.online && (this.cursors.get(replica.index) ?? 0) < this.log.length
        )
        .map((replica) => ({ to: replica.index, from: -1 }));
    }
    return [...this.links]
      .filter(([key, queue]) => {
        if (queue.length === 0) return false;
        const [from, to] = key.split('>').map(Number);
        return this.replicas[from!]!.online && this.replicas[to!]!.online;
      })
      .map(([key]) => {
        const [from, to] = key.split('>').map(Number);
        return { to: to!, from: from! };
      });
  }

  /** Make one delivery. A delivery that is no longer possible does nothing. */
  deliver(target: { readonly to: number; readonly from: number; readonly fault?: Fault }): void {
    const replica = this.replicas[target.to];
    if (!replica?.online) return;
    if (this.delivery === 'server') {
      if ((this.cursors.get(target.to) ?? 0) < this.log.length) this.readOne(replica, target.fault);
      return;
    }
    if (!this.replicas[target.from]?.online) return;
    const queue = this.links.get(`${target.from}>${target.to}`);
    const update = queue?.[0];
    if (update && this.applyWith(replica, update, target.fault)) queue.shift();
  }

  private readOne(replica: Replica, fault?: Fault): void {
    const at = this.cursors.get(replica.index) ?? 0;
    const entry = this.log[at]!;
    const done = entry.from === replica.index || this.applyWith(replica, entry.update, fault);
    if (done) this.cursors.set(replica.index, at + 1);
  }

  /** Bring everyone online, deliver everything, and sync every pair for what was lost. */
  flush(): void {
    this.drain();
    for (const replica of this.replicas) {
      for (const other of this.replicas) this.resync({ to: replica.index, from: other.index });
    }
    this.drain();
  }

  private drain(): void {
    for (const replica of this.replicas) this.setOnline(replica, true);
    if (this.delivery === 'server') {
      // Reading an update can make a replica write one, such as the formatting cleanup Yjs
      // runs after a remote change, so drain until no replica is behind the relay.
      for (let guard = 0; guard < 1_000_000; guard += 1) {
        const behind = this.replicas.find(
          (replica) => (this.cursors.get(replica.index) ?? 0) < this.log.length
        );
        if (!behind) return;
        this.readOne(behind);
      }
      return;
    }
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const next = [...this.links].find(([, queue]) => queue.length > 0);
      if (!next) return;
      const [key, queue] = next;
      this.apply(this.replicas[Number(key.split('>')[1])]!, queue.shift()!);
    }
  }
}

export async function openReplica(
  index: number,
  documentId: string,
  bootstrap:
    | { readonly kind: 'create'; readonly document: Uint8Array }
    | { readonly kind: 'join'; readonly from: Y.Doc }
): Promise<Replica> {
  const ydoc = new Y.Doc();
  // lib0 binds its random source at import, so seeding `crypto` cannot reach this id. Set it:
  // Yjs orders concurrent inserts by client id, and a replay must pick the same winners.
  ydoc.clientID = 1_000 + index;
  if (bootstrap.kind === 'join') Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(bootstrap.from), JOIN);
  const awareness = new Awareness(ydoc);
  const handle = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId,
    identity: { actorId: `replica-${index}`, name: `Replica ${index}` },
    bootstrap:
      bootstrap.kind === 'create'
        ? { kind: 'create', document: bootstrap.document }
        : { kind: 'join', timeoutMs: 5_000 },
    offlineEditing: true,
  });
  const store = storeFrom(handle.document);
  const port = createCollaborationDocumentPort(store, { documentId });
  const detach = handle.session.attach(port);
  const failures: string[] = [];
  handle.session.subscribeStatus((status, reason, detail) => {
    if (status !== 'error') return;
    // A local split of text whose boundary a peer is still sending, or a write to a paragraph
    // whose text a peer is still sending, is refused and recovered in the same tick: an
    // expected refusal of one edit, not a session failure. A session
    // that stays in `error` still fails the run through its final status.
    if (detail?.startsWith('split of pending text') || detail?.startsWith('pending text of'))
      return;
    failures.push(`replica ${index}: ${reason ?? 'error'} ${detail ?? ''}`);
  });
  const deletions: Replica['deletions'][number][] = [];
  ydoc.on('afterTransaction', (transaction: Y.Transaction) => {
    const origin =
      transaction.origin === NETWORK || transaction.origin === JOIN
        ? 'network'
        : typeof transaction.origin === 'symbol'
          ? transaction.origin.toString()
          : String(
              (transaction.origin as { constructor?: { name?: string } } | null)?.constructor
                ?.name ?? transaction.origin
            );
    transaction.deleteSet.clients.forEach((ranges, client) => {
      for (const range of ranges)
        deletions.push({ origin, client, clock: range.clock, len: range.len });
    });
  });
  return {
    index,
    ydoc,
    awareness,
    handle,
    store,
    port,
    detach,
    failures,
    online: true,
    deletions,
  };
}
