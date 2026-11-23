/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The server half of a collaboration room, as one Hocuspocus extension.
 *
 * A room server has to do several things in the right hooks: refuse a client of another
 * collaboration format before it syncs, prepare the room document before any update reaches
 * it, refuse a replica of an earlier room generation, and check a saved room before it
 * becomes the live one. `collaborationServerExtension` does them in one extension, so a
 * server cannot leave one out.
 *
 * With `storage`, the extension also loads and stores the room. Each store keeps a `.docx`
 * export beside the room state, with a digest of the state it was exported from. Every
 * build reads a `.docx`, so a later build with another collaboration format creates the
 * room again from that export when it loads the room, and checks the result against it.
 */
import * as Y from 'yjs';
import { readCollaborationDocument } from './document-read.ts';
import {
  assertCollaborationFormatCompatibility,
  readCollaborationFormatVersion,
} from './document-format.ts';
import { CollaborationSchemaError } from './errors.ts';
import { COLLABORATION_FORMAT_PARAMETER } from './format-parameter.ts';
import {
  checkCollaborationRoomGeneration,
  compactCollaborationState,
  type CollaborationRoomGatePayload,
  type CompactCollaborationStateOptions,
} from './room-generation.ts';
import {
  collaborationMigrationNeed,
  migrateCollaborationRoom,
  type CollaborationMigrationCheck,
  type CollaborationMigrationPosition,
} from './room-migration.ts';
import { prepareCollaborationServerDocument } from './server-document.ts';

/**
 * The largest saved state, in bytes, that the server upgrades while it loads the room.
 *
 * An upgrade creates the room again from its export on the server's thread, and every
 * other room on the process waits meanwhile. A room state is much larger than its `.docx`
 * file: on a laptop, a 75 KB document was 4 MiB of state and upgraded in 0.5 seconds, and a
 * 521-page document was 46 MiB and took 7 seconds. The default admits both. A larger room
 * is refused, for a job outside the server to upgrade.
 */
const DEFAULT_MAX_UPGRADE_STATE_BYTES = 64 * 1024 * 1024;

/** A `.docx` export of a room, with the state it was exported from. @public */
export interface CollaborationRoomExport {
  /** The room's document as a `.docx` file. */
  readonly docx: Uint8Array;
  /** The SHA-256 of the room state that `docx` was exported from, in lowercase hex. */
  readonly stateDigest: string;
}

/** A room as storage holds it. @public */
export interface StoredCollaborationRoom {
  /** The room state: one Yjs update. */
  readonly state: Uint8Array;
  /**
   * The export of `state`. In `save`, `null` means that this store has no new export: keep
   * the export that storage already holds. In `load`, `null` means that storage holds none.
   */
  readonly export: CollaborationRoomExport | null;
}

/**
 * Where `collaborationServerExtension` keeps rooms. Implement it over your database or object
 * storage.
 *
 * Write `state` and `export` in one atomic operation where storage allows. If it does not,
 * write the state first, and the export and its digest together. The digest then protects
 * an upgrade: an export of another state is never used, and the next load replaces it.
 *
 * @public
 */
export interface CollaborationRoomStorage {
  /** The stored room, or `null` when storage holds no room of this name. */
  load(roomName: string): Promise<StoredCollaborationRoom | null> | StoredCollaborationRoom | null;
  /** Store the room. When `room.export` is `null`, keep the stored export. */
  save(roomName: string, room: StoredCollaborationRoom): Promise<void> | void;
  /**
   * Keep the state of an earlier format before an upgraded room replaces it. Called once
   * for each upgrade, before `save`. An error from it stops the upgrade and leaves the
   * stored room as it is. Without this method, the earlier state is not kept.
   */
  backUp?(roomName: string, state: Uint8Array): Promise<void> | void;
}

/**
 * Why the server did not upgrade a saved room of an earlier format.
 *
 * - `disabled`: `upgradeOnLoad` is `false`.
 * - `no-export`: storage holds no export of the room.
 * - `stale-export`: the export was made from another state than the stored one.
 * - `too-large`: the state is larger than `maxUpgradeStateBytes`.
 * - `check-failed`: the upgraded room differs from the export.
 * - `error`: the state or the export cannot be read; `code` says why.
 *
 * @public
 */
export type CollaborationRoomUpgradeRefusal =
  'disabled' | 'no-export' | 'stale-export' | 'too-large' | 'check-failed' | 'error';

/** Something the collaboration server did to a room, for logs and metrics. @public */
export type CollaborationServerEvent =
  | {
      /** The server upgraded a saved room to this build's format and stored it. */
      readonly type: 'room-upgraded';
      readonly roomName: string;
      /** The earlier format, or `unversioned`. */
      readonly from: string;
      /** This build's format. */
      readonly to: string;
      /** Paragraphs the editor can neither show nor edit in the upgraded room. */
      readonly hidden: number;
      /** Where the first such paragraphs are, at most 20. */
      readonly hiddenAt: readonly CollaborationMigrationPosition[];
    }
  | {
      /**
       * The server left a saved room of an earlier format as it is, and refused the load.
       * Clients get `saved-room-unavailable`.
       */
      readonly type: 'room-upgrade-refused';
      readonly roomName: string;
      readonly reason: CollaborationRoomUpgradeRefusal;
      /** The failure code, for `error`. */
      readonly code?: string;
      /** The checks that failed, for `check-failed`. */
      readonly failed?: readonly CollaborationMigrationCheck[];
      /** The XML parts that differ, for `check-failed`. */
      readonly changedParts?: readonly string[];
      /** Where the first paragraphs differ, for `check-failed`. Positions, never text. */
      readonly differencesAt?: readonly CollaborationMigrationPosition[];
    }
  | {
      /**
       * The server refused to load a saved room, and left it as it is. `code` is
       * `collaboration-format-mismatch` for a room that a later release wrote, and
       * `invalid-saved-room` for state that forms no document.
       */
      readonly type: 'room-load-refused';
      readonly roomName: string;
      readonly code: string;
    }
  | {
      /** A compaction on load failed. The room loaded as it was stored. */
      readonly type: 'room-compaction-failed';
      readonly roomName: string;
      readonly code: string;
    }
  | {
      /**
       * The room does not export as a document, so the server did not store it. Storage
       * keeps the last room that exported.
       */
      readonly type: 'room-export-failed';
      readonly roomName: string;
      readonly code: string;
    };

/** What a new room starts from. @public */
export interface CreateCollaborationRoomRequest {
  /** The room's name on the server. */
  readonly roomName: string;
  /** The context that `onAuthenticate` returned for the connection that opens the room. */
  readonly context: unknown;
}

/** Options for {@link collaborationServerExtension}. @public */
export interface CollaborationServerOptions {
  /**
   * Where rooms are kept. With it, the server loads each room from storage, checks it, and
   * stores it with a `.docx` export. Without it, load and store the room in your own hooks.
   */
  readonly storage?: CollaborationRoomStorage;
  /**
   * The state of a room that storage does not hold, such as the result of
   * `createCollaborationState`. The server stores it before anyone syncs. Return `null` to
   * leave the room empty, for its first participant to seed. Throw to refuse the room. Used
   * only with `storage`.
   */
  readonly createRoom?: (
    request: CreateCollaborationRoomRequest
  ) => Promise<Uint8Array | null> | Uint8Array | null;
  /**
   * Upgrade a saved room of an earlier collaboration format when the server loads it, from
   * its stored export. Default `true`. With `false`, the server refuses such a room.
   */
  readonly upgradeOnLoad?: boolean;
  /**
   * The largest saved state, in bytes, that the server upgrades while it loads the room.
   * Default 64 MiB. The upgrade runs on the server's thread, so every room on the process
   * waits for it: on a laptop, 0.5 seconds for a 75 KB document (4 MiB of state) and
   * 7 seconds for a 521-page document (46 MiB). A larger room is refused with `too-large`;
   * upgrade it in a job with `migrateCollaborationRoom`. Lower the value to keep long
   * upgrades off the server.
   */
  readonly maxUpgradeStateBytes?: number;
  /**
   * Compact a stored room when the server loads it, with `compactCollaborationState`, and
   * store the result. Default `false`. Pass options to set the gain that makes a compaction
   * worth it. A compacted room is a new generation: a replica of the room before it is
   * refused with `room-generation-changed`, and rejoins.
   */
  readonly compactOnLoad?: boolean | CompactCollaborationStateOptions;
  /**
   * The shortest time, in milliseconds, between two exports of one room while people are
   * connected. Default 0: every store exports, so every stored state is one that exports.
   * An export runs on the server's thread: on a laptop, 0.2 seconds for a 75 KB document
   * and 2 seconds for a 521-page document. Raise this for large documents.
   *
   * A store inside the interval writes a state that the server did not check, and leaves
   * the stored export stale. A room always exports before it unloads. If the server stops
   * before that, the next load in the same format replaces the export; a load in a later
   * format refuses the room. If an unchecked state does not export, every later load
   * refuses it with `invalid-saved-room`, and the stored export holds the last document
   * that exported.
   */
  readonly exportIntervalMs?: number;
  /**
   * The collaboration format a connecting client names. The default reads the
   * `collaborationFormat` query parameter, which the provider hooks and
   * `createHocuspocusCollaboration` send. Replace it to read the format from your own
   * token. The claim prevents accidental mixed rooms; it does not authenticate a client.
   */
  readonly readClientFormat?: (connection: CollaborationServerConnection) => unknown;
  /** Called for each event. Errors it throws are ignored. Events hold no document text. */
  readonly onEvent?: (event: CollaborationServerEvent) => void;
}

/** What the server knows about a connecting client in `onAuthenticate`. @public */
export interface CollaborationServerConnection {
  /** The room the client asks for. */
  readonly documentName: string;
  /** The token the provider sent. */
  readonly token: string;
  /** The query parameters of the connection URL. */
  readonly requestParameters: URLSearchParams;
}

/** What Hocuspocus passes to `onLoadDocument`, as far as the extension reads it. @public */
export interface CollaborationServerLoad {
  /** The room's name on the server. */
  readonly documentName: string;
  /** The room's server-side `Y.Doc`, still empty. */
  readonly document: Y.Doc;
  /** The context that `onAuthenticate` returned for the connection that opens the room. */
  readonly context: unknown;
}

/** What Hocuspocus passes to `onStoreDocument`, as far as the extension reads it. @public */
export interface CollaborationServerStore {
  /** The room's name on the server. */
  readonly documentName: string;
  /** The room's server-side `Y.Doc`. */
  readonly document: Y.Doc;
  /** Connections to the room when Hocuspocus built the payload. */
  readonly clientsCount?: number;
}

/**
 * The Hocuspocus extension that {@link collaborationServerExtension} returns. Pass it in the
 * `extensions` of your server configuration.
 *
 * @public
 */
export interface CollaborationServerExtension {
  /** The extension's name in Hocuspocus. */
  readonly extensionName: string;
  /** High, so the extension runs before the other extensions and your own hooks. */
  readonly priority: number;
  /** Refuses a client of another collaboration format. */
  onAuthenticate(connection: CollaborationServerConnection): Promise<void>;
  /** Prepares the room document and, with `storage`, loads the room. */
  onLoadDocument(payload: CollaborationServerLoad): Promise<void>;
  /** Sends the loaded room to nobody, so the first participant receives it once. */
  afterLoadDocument(payload: CollaborationServerLoad): Promise<void>;
  /** Refuses a replica of an earlier room generation. */
  beforeHandleMessage(payload: CollaborationRoomGatePayload): Promise<void>;
  /** Stores a room whose last store wrote no export or failed, before the room unloads. */
  beforeUnloadDocument(payload: CollaborationServerStore): Promise<void>;
  /** Forgets when the room was last exported. */
  afterUnloadDocument(payload: { readonly documentName: string }): Promise<void>;
  /** Stores the room with its export. Present only with `storage`. */
  onStoreDocument?(payload: CollaborationServerStore): Promise<void>;
}

/** Runs before every other extension and your own hooks, and after a telemetry wrapper. */
const EXTENSION_PRIORITY = Number.MAX_SAFE_INTEGER - 1;

/** An error that Hocuspocus sends to the client as the reason of its refusal. */
function refusal(reason: string, cause?: unknown): Error & { readonly reason: string } {
  return Object.assign(new Error(reason, cause === undefined ? undefined : { cause }), { reason });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // The digest reads only a view over an `ArrayBuffer`; any other view is copied once.
  const view =
    bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', view));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const FORMAT_MISMATCHES = new Set([
  'collaboration-format-mismatch',
  'protocol-version-mismatch',
  'schema-version-mismatch',
]);

/**
 * The collaboration room checks, as one Hocuspocus extension.
 *
 * The extension runs before your other extensions and your own hooks:
 *
 * - `onAuthenticate` refuses a client whose collaboration format differs from this
 *   build's, with `collaboration-format-mismatch`, before any sync. Authenticate the
 *   connection in your own `onAuthenticate`, which still runs.
 * - `onLoadDocument` prepares the room document before any update reaches it.
 * - `afterLoadDocument` flushes the loaded room, so the first participant receives it once.
 * - `beforeHandleMessage` refuses a replica of an earlier room generation.
 *
 * With `storage`, the extension also loads and stores the room:
 *
 * - A stored room is checked before it becomes the live room: it must be in this build's
 *   format and must export as a complete document.
 * - A stored room of an earlier format is created again from its stored export, checked
 *   against that export, and stored. The room keeps its ID. A replica that still holds the
 *   earlier room is refused with `room-generation-changed`, and rejoins.
 * - Each store writes the room state and a `.docx` export of it.
 * - A stored room with no export, or with the export of another state, gets a current
 *   export when the server loads it.
 *
 * Do not load or store the room in your own hooks when you pass `storage`.
 *
 * The upgraded room is checked against the export, not against the earlier state, which
 * this build cannot read. The digest is the only link between the two: store each export
 * with the digest it came with, and never one without the other.
 *
 * One process must hold a room at a time while rooms upgrade. If two servers load one
 * earlier-format room at once, each creates its own room, and the later store replaces the
 * other. Stop the servers of the earlier build before the servers of this build start.
 *
 * @example
 * ```ts
 * import { Server } from '@hocuspocus/server';
 * import { collaborationServerExtension } from '@docx-editor.dev/pro/collaboration';
 *
 * const server = new Server({
 *   port: 1234,
 *   onAuthenticate,
 *   extensions: [collaborationServerExtension({ storage: { load: loadRoom, save: saveRoom } })],
 * });
 * ```
 *
 * @throws `TypeError` when `maxUpgradeStateBytes` or `exportIntervalMs` is not a number of
 * 0 or more.
 * @public
 */
export function collaborationServerExtension(
  options: CollaborationServerOptions = {}
): CollaborationServerExtension {
  const { storage, createRoom } = options;
  const upgradeOnLoad = options.upgradeOnLoad ?? true;
  const maxUpgradeStateBytes = options.maxUpgradeStateBytes ?? DEFAULT_MAX_UPGRADE_STATE_BYTES;
  if (!Number.isFinite(maxUpgradeStateBytes) || maxUpgradeStateBytes < 0) {
    throw new TypeError('maxUpgradeStateBytes must be a number of bytes, 0 or more.');
  }
  const exportIntervalMs = options.exportIntervalMs ?? 0;
  if (!Number.isFinite(exportIntervalMs) || exportIntervalMs < 0) {
    throw new TypeError('exportIntervalMs must be a number of milliseconds, 0 or more.');
  }
  const compactOptions: CompactCollaborationStateOptions | null =
    options.compactOnLoad === true ? {} : options.compactOnLoad || null;
  /** When each open room was last exported, for `exportIntervalMs`. */
  const exportedAt = new Map<string, number>();
  /** Open rooms whose last store wrote no export. */
  const staleExports = new Set<string>();
  /** Open rooms whose last store failed in storage. Hocuspocus does not try such a store again. */
  const unsaved = new Set<string>();
  const readClientFormat =
    options.readClientFormat ??
    ((connection: CollaborationServerConnection) =>
      connection.requestParameters.get(COLLABORATION_FORMAT_PARAMETER));

  const emit = (event: CollaborationServerEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // A failing log sink must not refuse a room.
    }
  };

  /** Refuse the load of a room of an earlier format, and say why to the operator only. */
  const refuseUpgrade = (
    roomName: string,
    reason: CollaborationRoomUpgradeRefusal,
    detail: Partial<Extract<CollaborationServerEvent, { type: 'room-upgrade-refused' }>> = {},
    cause?: unknown
  ): never => {
    emit({ ...detail, type: 'room-upgrade-refused', roomName, reason });
    // The client is of this build's format, so an upgrade of the client would not help.
    throw refusal('saved-room-unavailable', cause);
  };

  /** The state of a stored room of an earlier format, in this build's format, and stored. */
  const upgrade = async (
    store: CollaborationRoomStorage,
    roomName: string,
    stored: StoredCollaborationRoom
  ): Promise<Uint8Array> => {
    if (!upgradeOnLoad) return refuseUpgrade(roomName, 'disabled');
    if (!stored.export) return refuseUpgrade(roomName, 'no-export');
    if (stored.state.byteLength > maxUpgradeStateBytes) return refuseUpgrade(roomName, 'too-large');
    if (stored.export.stateDigest !== (await sha256Hex(stored.state))) {
      return refuseUpgrade(roomName, 'stale-export');
    }
    let migrated;
    try {
      migrated = await migrateCollaborationRoom({
        state: stored.state,
        exported: stored.export.docx,
      });
    } catch (error) {
      if (!(error instanceof CollaborationSchemaError)) throw error;
      return refuseUpgrade(roomName, 'error', { code: error.code }, error);
    }
    if (!migrated.ok) {
      if (migrated.reason !== 'check-failed') {
        // The need was `earlier-format` a moment ago, so the state changed under the load.
        return refuseUpgrade(roomName, 'error', { code: migrated.reason });
      }
      return refuseUpgrade(roomName, 'check-failed', {
        failed: migrated.report.failed,
        changedParts: migrated.report.changedParts,
        differencesAt: migrated.report.differences.map(({ part, paragraph }) => ({
          part,
          paragraph,
        })),
      });
    }
    await store.backUp?.(roomName, stored.state);
    // The check proved that the upgraded room holds the document of this export, so the
    // export stays, now as the export of the upgraded state.
    await store.save(roomName, {
      state: migrated.state,
      export: { docx: stored.export.docx, stateDigest: await sha256Hex(migrated.state) },
    });
    emit({
      type: 'room-upgraded',
      roomName,
      from: migrated.report.from,
      to: migrated.report.to,
      hidden: migrated.report.hidden,
      hiddenAt: migrated.report.hiddenAt,
    });
    return migrated.state;
  };

  /**
   * Refuse saved state that is not a complete room of this build's format. Returns the
   * room's `.docx` export, which is the proof that the room forms a document.
   */
  const checkStoredRoom = (roomName: string, state: Uint8Array): Uint8Array => {
    const candidate = new Y.Doc();
    try {
      prepareCollaborationServerDocument(candidate);
      Y.applyUpdate(candidate, state);
      assertCollaborationFormatCompatibility(readCollaborationFormatVersion(candidate));
      return readCollaborationDocument(candidate);
    } catch (error) {
      const code =
        error instanceof CollaborationSchemaError && FORMAT_MISMATCHES.has(error.code)
          ? error.code
          : 'invalid-saved-room';
      emit({ type: 'room-load-refused', roomName, code });
      throw refusal(code, error);
    } finally {
      candidate.destroy();
    }
  };

  const loadFromStorage = async (
    store: CollaborationRoomStorage,
    payload: CollaborationServerLoad
  ) => {
    const roomName = payload.documentName;
    const stored = await store.load(roomName);
    if (!stored) {
      const created = (await createRoom?.({ roomName, context: payload.context })) ?? null;
      if (!created) return;
      const docx = checkStoredRoom(roomName, created);
      // Hocuspocus does not store state applied during a load, so a restart before the
      // first edit would create the room a second time. The export goes with it: a room
      // that nobody edits is never stored again, and must still upgrade.
      await store.save(roomName, {
        state: created,
        export: { docx, stateDigest: await sha256Hex(created) },
      });
      Y.applyUpdate(payload.document, created);
      return;
    }
    let need;
    try {
      need = collaborationMigrationNeed(stored.state);
    } catch (error) {
      emit({ type: 'room-load-refused', roomName, code: 'invalid-saved-room' });
      throw refusal('invalid-saved-room', error);
    }
    if (need === 'later-format') {
      emit({ type: 'room-load-refused', roomName, code: 'collaboration-format-mismatch' });
      throw refusal('collaboration-format-mismatch');
    }
    if (need === 'earlier-format') {
      // The migration read the upgraded room as a complete document already.
      Y.applyUpdate(payload.document, await upgrade(store, roomName, stored));
      return;
    }
    const docx = checkStoredRoom(roomName, stored.state);
    // The room loads as it was stored when a compaction fails: the check above passed.
    const compacted = compactOptions
      ? await compactCollaborationState(stored.state, compactOptions).catch((error: unknown) => {
          emit({
            type: 'room-compaction-failed',
            roomName,
            code: error instanceof CollaborationSchemaError ? error.code : 'error',
          });
          return null;
        })
      : null;
    const state = compacted ?? stored.state;
    // The check exported the room already, so a room with no export, or with the export of
    // another state, gets a current one here. That covers a room stored before the server
    // used the extension, and a server that stopped between two exports. A compacted room
    // holds the same document, so the same export is its export.
    const current =
      stored.export !== null && stored.export.stateDigest === (await sha256Hex(stored.state));
    if (compacted || !current) {
      await store.save(roomName, {
        state,
        export: { docx, stateDigest: await sha256Hex(state) },
      });
    }
    Y.applyUpdate(payload.document, state);
  };

  const storeToStorage = async (
    store: CollaborationRoomStorage,
    payload: CollaborationServerStore,
    force = false
  ) => {
    const roomName = payload.documentName;
    const state = Y.encodeStateAsUpdate(payload.document);
    // Hocuspocus builds the payload when the room changes and may run the store later, so
    // `clientsCount` can be the count at the last edit. The document knows the count now.
    const connections =
      (payload.document as { getConnectionsCount?: () => number }).getConnectionsCount?.() ??
      payload.clientsCount;
    const unloading = connections === 0;
    const last = exportedAt.get(roomName);
    const due = force || unloading || last === undefined || Date.now() - last >= exportIntervalMs;
    if (!due) {
      unsaved.add(roomName);
      await store.save(roomName, { state, export: null });
      unsaved.delete(roomName);
      staleExports.add(roomName);
      return;
    }
    let docx: Uint8Array;
    try {
      docx = readCollaborationDocument(payload.document);
    } catch (error) {
      // A room that is still empty, or that two creators seeded, refuses to export. A load
      // refuses such a state too, so storing it would replace a room that loads with one
      // that never does. Storage keeps the last room that exported.
      emit({
        type: 'room-export-failed',
        roomName,
        code: error instanceof CollaborationSchemaError ? error.code : 'error',
      });
      return;
    }
    unsaved.add(roomName);
    await store.save(roomName, { state, export: { docx, stateDigest: await sha256Hex(state) } });
    unsaved.delete(roomName);
    exportedAt.set(roomName, Date.now());
    staleExports.delete(roomName);
  };

  return {
    extensionName: 'docx-editor-collaboration',
    priority: EXTENSION_PRIORITY,
    async onAuthenticate(connection: CollaborationServerConnection): Promise<void> {
      try {
        assertCollaborationFormatCompatibility(readClientFormat(connection));
      } catch (error) {
        if (error instanceof CollaborationSchemaError) throw refusal(error.code, error);
        throw error;
      }
    },
    async onLoadDocument(payload: CollaborationServerLoad): Promise<void> {
      // First, before any update reaches it, so the server never writes a change of its own.
      prepareCollaborationServerDocument(payload.document);
      if (storage) await loadFromStorage(storage, payload);
    },
    async afterLoadDocument(payload: CollaborationServerLoad): Promise<void> {
      // Hocuspocus holds back a small update until its next turn, and then sends it to every
      // connection, which by then includes the first participant. That participant would
      // receive the loaded room twice: once here and once in its own sync.
      (payload.document as { flush?: () => void }).flush?.();
    },
    async beforeHandleMessage(payload: CollaborationRoomGatePayload): Promise<void> {
      checkCollaborationRoomGeneration(payload);
    },
    async beforeUnloadDocument(payload: CollaborationServerStore): Promise<void> {
      // Hocuspocus unloads a room with no store when nothing changed since the last one. If
      // that store wrote no export, the room would rest with a stale export. If that store
      // failed in storage, the room's edits would be lost. An error here keeps the room in
      // memory: Hocuspocus stops the unload.
      const roomName = payload.documentName;
      if (storage && (staleExports.has(roomName) || unsaved.has(roomName))) {
        await storeToStorage(storage, payload, true);
      }
    },
    async afterUnloadDocument(payload: { readonly documentName: string }): Promise<void> {
      exportedAt.delete(payload.documentName);
      staleExports.delete(payload.documentName);
      unsaved.delete(payload.documentName);
    },
    ...(storage
      ? {
          async onStoreDocument(payload: CollaborationServerStore): Promise<void> {
            await storeToStorage(storage, payload);
          },
        }
      : {}),
  };
}
