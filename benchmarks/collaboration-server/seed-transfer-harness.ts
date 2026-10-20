// A real Hocuspocus room server in this process, which counts the bytes of every connection.
//
// The seed-transfer tests use it to measure what a new room costs each participant. Hocuspocus
// sends every document update to every connection in the room, including the connection that
// sent it. A participant that seeds a new room therefore receives its own seed back. A server
// that seeds the room itself with `createCollaborationState` avoids that transfer and the
// upload before it.
//
// Hocuspocus's own Server runs on the Node.js WebSocket adapter, which refuses Bun. This is the
// same wiring over Bun's server: one Hocuspocus connection per socket.

import { HocuspocusProvider } from '@hocuspocus/provider';
import { Hocuspocus } from '@hocuspocus/server';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  checkCollaborationRoomGeneration,
  compactCollaborationState,
  createCollaborationState,
  prepareCollaborationServerDocument,
} from '@docx-editor.dev/pro/collaboration';
import type { CollaborationBootstrap } from '@docx-editor.dev/pro/collaboration';
import {
  createHocuspocusCollaboration,
  type HocuspocusCollaborationRoom,
} from '@docx-editor.dev/pro/collaboration/hocuspocus';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import {
  paragraphTextOf,
  type OoxmlNode,
  type StoryScope,
  type TreeDocOp,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import { zipDocument } from '../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';
import { HOCUSPOCUS_PROVIDER_FOR_TESTS } from '../../packages/pro/src/collaboration/hocuspocus-test-provider.ts';
import { storeFrom } from './document-text.ts';

const BODY: StoryScope = { kind: 'body' };

/**
 * The runtime's own WebSocket. The test preload installs a test DOM whose `WebSocket` raises
 * an error event nothing can listen to when a connecting socket closes, which fails the run.
 * Browsers and Node do not, so every provider here uses Bun's WebSocket, as production would.
 * Bun serves it from its built-in `undici` module.
 */
export const NativeWebSocket = (
  (await import('undici' as string)) as { readonly WebSocket: typeof WebSocket }
).WebSocket;

/** The provider `createHocuspocusCollaboration` builds, on the runtime's own WebSocket. */
function nativeProvider(init: {
  readonly url: string;
  readonly name: string;
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly token?: string | (() => string | Promise<string>);
}): HocuspocusProvider {
  return new HocuspocusProvider({
    url: init.url,
    name: init.name,
    document: init.document,
    awareness: init.awareness,
    ...(init.token !== undefined ? { token: init.token as string } : {}),
    WebSocketPolyfill: NativeWebSocket,
  } as ConstructorParameters<typeof HocuspocusProvider>[0]);
}

/** Hocuspocus message type of document sync messages. */
const SYNC = 0;

/** The bytes one connection carried, as the server saw them. */
export interface ConnectionTraffic {
  /** The `peer` query parameter of the connection URL. */
  readonly peer: string;
  /** Sync bytes the server sent to the participant. */
  syncReceived: number;
  /** Sync bytes the participant sent to the server. */
  syncSent: number;
  /** All bytes the server sent to the participant. */
  received: number;
  /** All bytes the participant sent to the server. */
  sent: number;
  /** The size of each sync message the server sent to the participant. */
  readonly syncReceivedSizes: number[];
  /** The size of each sync message the participant sent to the server. */
  readonly syncSentSizes: number[];
  /** The socket closed. */
  closed: boolean;
  /** The Hocuspocus message type of each message the participant sent, in order. */
  readonly sentTypes: number[];
}

/** Traffic summed over every connection of one participant. */
export interface PeerTraffic extends ConnectionTraffic {
  /** The largest sync message the participant sent. */
  readonly largestSyncSent: number;
  /** How many sync messages of at least `bytes` the participant received. */
  largeSyncReceived(bytes: number): number;
}

export interface SeedServerOptions {
  /** `server` seeds each new room with `createCollaborationState`; `none` leaves it empty. */
  readonly seed: 'server' | 'none';
  /** The `.docx` bytes the server seeds new rooms from. */
  readonly document: Uint8Array;
  /** Wait this long, in ms, inside `onLoadDocument`, so connections can race the load. */
  readonly loadDelayMs?: () => number;
  /** Send the loaded state to nobody before the first connection joins. Default true. */
  readonly flushAfterLoad?: boolean;
  /** Refuse a known room whose state is missing. Default true; false seeds it again. */
  readonly refuseLostRooms?: boolean;
  /** Compact a stored room when it loads, whatever the gain, while this returns true. */
  readonly compactOnLoad?: () => boolean;
}

export interface SeedServer {
  readonly url: string;
  /** Stored room states, by room name. The server writes a seeded room here at once. */
  readonly storage: Map<string, Uint8Array>;
  /**
   * The rooms the server created: a durable record kept apart from the room state. A known
   * room whose state is missing is refused with `saved-room-unavailable`, never seeded again.
   */
  readonly created: Set<string>;
  /** How many times the server compacted a room. */
  readonly compactions: () => number;
  /** The peers the server authenticated, in order. */
  readonly authenticated: readonly string[];
  /** Every connection's traffic, in the order the connections opened. */
  readonly connections: readonly ConnectionTraffic[];
  /** How many times the server seeded a room. */
  readonly seeds: () => number;
  /** The room document the server holds, or undefined when the room is not loaded. */
  document(room: string): Y.Doc | undefined;
  /** Traffic summed over every connection of one peer. */
  traffic(peer: string): PeerTraffic;
  stop(): Promise<void>;
}

function messageType(bytes: Uint8Array): number {
  // A frame starts with the document name as a lib0 string, then the message type.
  let at = 0;
  const varUint = (): number => {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = bytes[at++];
      if (byte === undefined) return -1;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 0x80;
    }
  };
  const nameLength = varUint();
  if (nameLength < 0) return -1;
  at += nameLength;
  return varUint();
}

function bytesOf(data: unknown): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array();
}

export async function startSeedServer(options: SeedServerOptions): Promise<SeedServer> {
  const storage = new Map<string, Uint8Array>();
  const created = new Set<string>();
  const connections: ConnectionTraffic[] = [];
  let seeds = 0;
  let compactions = 0;
  const authenticated: string[] = [];
  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce: 50,
    maxDebounce: 200,
    async onAuthenticate({ requestParameters }) {
      authenticated.push(requestParameters.get('peer') ?? '');
    },
    async onLoadDocument({ documentName, document }) {
      prepareCollaborationServerDocument(document);
      const delay = options.loadDelayMs?.() ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      let state = storage.get(documentName);
      if (state && options.compactOnLoad?.()) {
        const compacted = await compactCollaborationState(state, { minimumGain: Number.MIN_VALUE });
        if (compacted) {
          storage.set(documentName, compacted);
          state = compacted;
          compactions += 1;
        }
      }
      if (!state && created.has(documentName) && options.refuseLostRooms !== false) {
        // A second seed would replace the room's edits with the original file.
        throw Object.assign(new Error('saved-room-unavailable'), {
          reason: 'saved-room-unavailable',
        });
      }
      if (!state && options.seed === 'server') {
        state = await createCollaborationState(options.document, { documentId: documentName });
        // Stored before any participant syncs: Hocuspocus does not store state applied while
        // it loads a room, and a restart must load this room instead of seeding another.
        storage.set(documentName, state);
        seeds += 1;
      }
      if (state) {
        created.add(documentName);
        Y.applyUpdate(document, state);
      }
      return document;
    },
    async afterLoadDocument({ document }) {
      if (options.flushAfterLoad !== false) document.flush();
    },
    async beforeHandleMessage(payload) {
      checkCollaborationRoomGeneration(payload);
    },
    async onStoreDocument({ documentName, document }) {
      storage.set(documentName, Y.encodeStateAsUpdate(document));
      created.add(documentName);
    },
  });
  type Socket = {
    request: Request;
    traffic: ConnectionTraffic;
    connection?: ReturnType<Hocuspocus['handleConnection']>;
  };
  const server = Bun.serve<Socket>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, bun) {
      const peer = new URL(request.url).searchParams.get('peer') ?? '';
      const traffic: ConnectionTraffic = {
        peer,
        syncReceived: 0,
        syncSent: 0,
        received: 0,
        sent: 0,
        syncReceivedSizes: [],
        syncSentSizes: [],
        closed: false,
        sentTypes: [],
      };
      return bun.upgrade(request, { data: { request, traffic } }) ? undefined : new Response('ok');
    },
    websocket: {
      open(socket) {
        const traffic = socket.data.traffic;
        connections.push(traffic);
        const counted = {
          send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
            const bytes = bytesOf(data);
            traffic.received += bytes.byteLength;
            if (messageType(bytes) === SYNC) {
              traffic.syncReceived += bytes.byteLength;
              traffic.syncReceivedSizes.push(bytes.byteLength);
            }
            socket.send(data as never);
          },
          close(code?: number, reason?: string) {
            socket.close(code, reason);
          },
          get readyState() {
            return socket.readyState;
          },
        };
        socket.data.connection = hocuspocus.handleConnection(
          counted as never,
          socket.data.request as never
        );
      },
      message(socket, message) {
        const bytes =
          typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message);
        const traffic = socket.data.traffic;
        traffic.sent += bytes.byteLength;
        traffic.sentTypes.push(messageType(bytes));
        if (messageType(bytes) === SYNC) {
          traffic.syncSent += bytes.byteLength;
          traffic.syncSentSizes.push(bytes.byteLength);
        }
        socket.data.connection?.handleMessage(bytes);
      },
      close(socket, code, reason) {
        socket.data.traffic.closed = true;
        socket.data.connection?.handleClose({ code, reason });
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}`,
    storage,
    created,
    connections,
    seeds: () => seeds,
    compactions: () => compactions,
    authenticated,
    document: (room) => hocuspocus.documents.get(room),
    traffic(peer) {
      const total: ConnectionTraffic = {
        peer,
        syncReceived: 0,
        syncSent: 0,
        received: 0,
        sent: 0,
        syncReceivedSizes: [],
        syncSentSizes: [],
        closed: true,
        sentTypes: [],
      };
      for (const entry of connections) {
        if (entry.peer !== peer) continue;
        total.syncReceived += entry.syncReceived;
        total.syncSent += entry.syncSent;
        total.received += entry.received;
        total.sent += entry.sent;
        total.syncReceivedSizes.push(...entry.syncReceivedSizes);
        total.syncSentSizes.push(...entry.syncSentSizes);
        total.closed &&= entry.closed;
        total.sentTypes.push(...entry.sentTypes);
      }
      return {
        ...total,
        largestSyncSent: total.syncSentSizes.reduce((largest, size) => Math.max(largest, size), 0),
        largeSyncReceived: (bytes) =>
          total.syncReceivedSizes.filter((size) => size >= bytes).length,
      };
    },
    async stop() {
      server.stop(true);
      for (const document of hocuspocus.documents.values()) document.destroy();
    },
  };
}

/** A `.docx` package with one body paragraph for each text. */
export function paragraphsDocx(texts: readonly string[]): Uint8Array {
  const body = texts.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`);
  return zipDocument(`${body.join('')}<w:sectPr/>`);
}

function bodyParagraphs(store: TreePackageStore): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      found.push(node);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return found;
}

/** The text of every body paragraph of a store, in order. */
export function paragraphTexts(store: TreePackageStore): string[] {
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  return bodyParagraphs(store).map(textOf);
}

/** One participant: a Hocuspocus replica with a document store attached, as the editor does. */
export interface SeedParticipant {
  readonly peer: string;
  readonly room: HocuspocusCollaborationRoom;
  readonly store: TreePackageStore;
  /** Every status the session reported, with its reason. */
  readonly statuses: string[];
  /** Insert `text` into body paragraph `index` at `fraction` of its length. */
  insert(index: number, fraction: number, text: string): void;
  /** Delete the first occurrence of `text`. Returns false when no paragraph shows it. */
  remove(text: string): boolean;
  /** Undo this participant's last step, through the shared undo history. */
  undo(): boolean;
  /** Redo this participant's last undone step. */
  redo(): boolean;
  /** Close the connection, once it is open. Edits stay local until `reconnect`. */
  disconnect(): Promise<void>;
  /** Open the connection again, once the previous socket has closed. */
  reconnect(): Promise<void>;
  destroy(): void;
}

export async function joinRoom(
  server: SeedServer,
  options: {
    readonly peer: string;
    readonly roomId: string;
    readonly bootstrap: CollaborationBootstrap;
  }
): Promise<SeedParticipant> {
  const room = await createHocuspocusCollaboration({
    url: `${server.url}/?peer=${encodeURIComponent(options.peer)}`,
    roomId: options.roomId,
    identity: { actorId: `actor-${options.peer}`, name: `Participant ${options.peer}` },
    bootstrap: options.bootstrap,
    syncedTimeoutMs: 15_000,
    [HOCUSPOCUS_PROVIDER_FOR_TESTS]: nativeProvider,
  } as Parameters<typeof createHocuspocusCollaboration>[0]);
  const store = storeFrom(room.document);
  const detach = room.session.attach(
    createCollaborationDocumentPort(store, { documentId: options.roomId })
  );
  const statuses: string[] = [];
  const stopStatus = room.session.subscribeStatus((status, reason) => {
    statuses.push(reason ? `${status}:${reason}` : status);
  });
  const apply = (ops: TreeDocOp[]): void => {
    const refusal = room.session.gateOperations(ops, BODY);
    if (refusal) throw new Error(`peer ${options.peer} refused ${ops[0]!.op}: ${refusal}`);
    const result = store.transact(BODY, (context) => {
      for (const op of ops) context.apply(op);
    });
    if (!result.ok) throw new Error(`peer ${options.peer} ${ops[0]!.op} failed: ${result.reason}`);
    room.session.flushPendingJournals();
  };
  let destroyed = false;
  // The provider ignores `connect()` while its socket still reads as connected, so a reconnect
  // right after a disconnect would leave it offline for good.
  let socketStatus = 'connected';
  const settled: (() => void)[] = [];
  room.provider.on('status', (event: { readonly status: string }) => {
    socketStatus = event.status;
    if (socketStatus !== 'connecting') for (const run of settled.splice(0)) run();
  });
  // Close a socket only once it opened or failed. A test DOM's WebSocket raises an error
  // event nothing can listen to when a connecting socket closes, and that fails the run.
  const whenSettled = (run: () => void): void => {
    if (socketStatus === 'connecting') settled.push(run);
    else run();
  };
  return {
    peer: options.peer,
    room,
    store,
    statuses,
    async disconnect() {
      await new Promise<void>((resolve) => whenSettled(resolve));
      room.provider.disconnect();
    },
    async reconnect() {
      await until(() => socketStatus === 'disconnected', `peer ${options.peer} to disconnect`);
      void room.provider.connect();
    },
    insert(index, fraction, text) {
      const paragraphs = bodyParagraphs(store);
      const paragraph = paragraphs[index % paragraphs.length];
      if (!paragraph) throw new Error('the document has no paragraph');
      const length = paragraphTextOf(store.bodyStore().part, paragraph.id)?.length ?? 0;
      apply([
        {
          op: 'insertText',
          paragraphId: paragraph.id,
          offset: Math.floor(fraction * (length + 1)),
          text,
        },
      ]);
    },
    remove(text) {
      for (const paragraph of bodyParagraphs(store)) {
        const shown = paragraphTextOf(store.bodyStore().part, paragraph.id) ?? '';
        const at = shown.indexOf(text);
        if (at < 0) continue;
        apply([{ op: 'deleteText', paragraphId: paragraph.id, start: at, end: at + text.length }]);
        return true;
      }
      return false;
    },
    undo: () => room.session.undo(),
    redo: () => room.session.redo(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopStatus();
      detach();
      whenSettled(() => room.destroy());
    },
  };
}

/** The body paragraph texts of a `.docx` file. */
export function docxParagraphTexts(bytes: Uint8Array): string[] {
  return paragraphTexts(storeFrom(bytes));
}

export async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = 15_000
): Promise<void> {
  // `performance.now`, because the scenario tests replace `Date.now` with a fixed clock.
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
