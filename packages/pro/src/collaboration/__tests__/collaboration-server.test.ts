/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The extension that `collaborationServerExtension` returns, driven hook by hook with
// the payloads Hocuspocus passes. `collaboration-server-rooms.test.ts` runs it in a server.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import * as Y from 'yjs';
import {
  collaborationServerExtension,
  type CollaborationRoomStorage,
  type CollaborationServerEvent,
  type CollaborationServerOptions,
  type StoredCollaborationRoom,
} from '../collaboration-server.ts';
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { COLLABORATION_FORMAT_VERSION } from '../document-format.ts';
import { readCollaborationDocument } from '../document-read.ts';
import { COLLABORATION_FORMAT_PARAMETER } from '../format-parameter.ts';
import { collaborationMigrationNeed } from '../room-migration.ts';
import { readCollaborationRoomGeneration } from '../room-generation.ts';
import { createCollaborationState } from '../server-document.ts';
import { zipDocument } from './document-peer-support.ts';

const ROOM = 'room-1234567890abcdefghij';
const SECRET = 'Indemnification cap';
const META = 'docx-package-meta-v1';

const extensionOf = (options: CollaborationServerOptions = {}) =>
  collaborationServerExtension(options) as unknown as {
    readonly extensionName: string;
    readonly priority: number;
    onAuthenticate(payload: unknown): Promise<void>;
    onLoadDocument(payload: unknown): Promise<void>;
    afterLoadDocument(payload: unknown): Promise<void>;
    beforeHandleMessage(payload: unknown): Promise<void>;
    beforeUnloadDocument(payload: unknown): Promise<void>;
    afterUnloadDocument(payload: unknown): Promise<void>;
    onStoreDocument?(payload: unknown): Promise<void>;
  };

const docx = (text = SECRET) => zipDocument(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/>`);

const roomState = (text?: string) => createCollaborationState(docx(text), { documentId: ROOM });

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice())), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/** A stored room that an earlier build wrote: its state, and the export that build made. */
async function earlierRoom(text?: string): Promise<StoredCollaborationRoom> {
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, await roomState(text));
    const exported = readCollaborationDocument(room);
    room
      .getMap(META)
      .set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion - 1);
    const state = Y.encodeStateAsUpdate(room);
    return { state, export: { docx: exported, stateDigest: await sha256Hex(state) } };
  } finally {
    room.destroy();
  }
}

/** Storage in memory that records each call. */
function memoryStorage(initial?: StoredCollaborationRoom) {
  let room: StoredCollaborationRoom | null = initial ?? null;
  const saves: StoredCollaborationRoom[] = [];
  const backups: Uint8Array[] = [];
  const storage: CollaborationRoomStorage = {
    load: () => room,
    save: (_name, next) => {
      saves.push(next);
      room = { state: next.state, export: next.export ?? room?.export ?? null };
    },
    backUp: (_name, state) => {
      backups.push(state);
    },
  };
  return { storage, saves, backups, stored: () => room };
}

const loadPayload = (document = new Y.Doc()) => ({ documentName: ROOM, document, context: {} });

const reasonOf = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

const connection = (format?: string) => ({
  documentName: ROOM,
  token: 'token',
  requestParameters: new URLSearchParams(
    format === undefined ? '' : `${COLLABORATION_FORMAT_PARAMETER}=${encodeURIComponent(format)}`
  ),
});

describe('the extension', () => {
  test('runs before other extensions, and below a telemetry wrapper', () => {
    const extension = extensionOf();
    expect(extension.extensionName).toBe('docx-editor-collaboration');
    expect(extension.priority).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test('flushes the loaded room, and loads a room document that has no flush', async () => {
    let flushed = 0;
    const document = Object.assign(new Y.Doc(), { flush: () => (flushed += 1) });
    await extensionOf().afterLoadDocument(loadPayload(document));
    expect(flushed).toBe(1);
    await extensionOf().afterLoadDocument(loadPayload());
  });

  test('does not store rooms without storage', () => {
    expect(extensionOf().onStoreDocument).toBeUndefined();
  });

  test('refuses limits that are not numbers of 0 or more', () => {
    expect(() => extensionOf({ maxUpgradeStateBytes: -1 })).toThrow(TypeError);
    expect(() => extensionOf({ maxUpgradeStateBytes: Number.NaN })).toThrow(TypeError);
    expect(() => extensionOf({ exportIntervalMs: -1 })).toThrow(TypeError);
  });
});

describe('admission', () => {
  test('a client of this format is admitted', async () => {
    await extensionOf().onAuthenticate(connection(COLLABORATION_FORMAT_VERSION));
  });

  test('a client of another format, or of none, is refused before sync', async () => {
    const extension = extensionOf();
    for (const format of ['docx-collaboration:1.0.0.0', '', undefined]) {
      expect(await reasonOf(() => extension.onAuthenticate(connection(format)))).toBe(
        'collaboration-format-mismatch'
      );
    }
  });

  test('readClientFormat reads the format from elsewhere', async () => {
    const extension = extensionOf({
      readClientFormat: ({ token }) => JSON.parse(token).format,
    });
    await extension.onAuthenticate({
      ...connection(),
      token: JSON.stringify({ format: COLLABORATION_FORMAT_VERSION }),
    });
    expect(
      await reasonOf(() =>
        extension.onAuthenticate({ ...connection(), token: JSON.stringify({ format: 'other' }) })
      )
    ).toBe('collaboration-format-mismatch');
  });
});

describe('a room in storage', () => {
  test('a new room is created, stored before anyone syncs, and loaded', async () => {
    const memory = memoryStorage();
    const state = await roomState();
    const requests: unknown[] = [];
    const extension = extensionOf({
      storage: memory.storage,
      createRoom: (request) => {
        requests.push(request);
        return state;
      },
    });
    const payload = loadPayload();
    await extension.onLoadDocument(payload);
    expect(requests).toEqual([{ roomName: ROOM, context: {} }]);
    // The export is stored with the room: a room that nobody edits is never stored again.
    expect(memory.saves).toHaveLength(1);
    expect(memory.saves[0]!.state).toEqual(state);
    expect(memory.saves[0]!.export!.stateDigest).toBe(await sha256Hex(state));
    expect(memory.saves[0]!.export!.docx).toEqual(readCollaborationDocument(payload.document));
    expect(readCollaborationRoomGeneration(payload.document)).not.toBe('');
  });

  test('without createRoom, an unknown room stays empty for its first participant', async () => {
    const memory = memoryStorage();
    const payload = loadPayload();
    await extensionOf({ storage: memory.storage }).onLoadDocument(payload);
    expect(memory.saves).toEqual([]);
    expect(Y.encodeStateAsUpdate(payload.document).byteLength).toBeLessThan(8);
  });

  test('a stored room with a current export is checked and loaded, with no store', async () => {
    const state = await roomState();
    const memory = memoryStorage({
      state,
      export: { docx: docx(), stateDigest: await sha256Hex(state) },
    });
    const payload = loadPayload();
    await extensionOf({ storage: memory.storage }).onLoadDocument(payload);
    expect(memory.saves).toEqual([]);
    expect(readCollaborationDocument(payload.document).byteLength).toBeGreaterThan(0);
  });

  test.each([
    ['no export', null],
    ['the export of another state', { docx: docx('An earlier edit'), stateDigest: '00' }],
  ])('a stored room with %s gets a current export on load', async (_name, stale) => {
    const state = await roomState();
    const memory = memoryStorage({ state, export: stale });
    const payload = loadPayload();
    await extensionOf({ storage: memory.storage }).onLoadDocument(payload);
    expect(memory.saves).toHaveLength(1);
    expect(memory.saves[0]!.state).toEqual(state);
    expect(memory.saves[0]!.export).toEqual({
      docx: readCollaborationDocument(payload.document),
      stateDigest: await sha256Hex(state),
    });
  });

  test('bytes that are not a room are refused, and the room document stays empty', async () => {
    const memory = memoryStorage({ state: new Uint8Array([1, 2, 3]), export: null });
    const payload = loadPayload();
    const events: CollaborationServerEvent[] = [];
    expect(
      await reasonOf(() =>
        extensionOf({
          storage: memory.storage,
          onEvent: (event) => events.push(event),
        }).onLoadDocument(payload)
      )
    ).toBe('invalid-saved-room');
    expect(events).toEqual([
      { type: 'room-load-refused', roomName: ROOM, code: 'invalid-saved-room' },
    ]);
    expect(memory.saves).toEqual([]);
    expect(Y.encodeStateAsUpdate(payload.document).byteLength).toBeLessThan(8);
  });

  test('a room that a later build wrote is refused and left as it is', async () => {
    const room = new Y.Doc();
    Y.applyUpdate(room, await roomState());
    room
      .getMap(META)
      .set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion + 1);
    const memory = memoryStorage({ state: Y.encodeStateAsUpdate(room), export: null });
    const events: CollaborationServerEvent[] = [];
    expect(
      await reasonOf(() =>
        extensionOf({
          storage: memory.storage,
          onEvent: (event) => events.push(event),
        }).onLoadDocument(loadPayload())
      )
    ).toBe('collaboration-format-mismatch');
    expect(events).toEqual([
      { type: 'room-load-refused', roomName: ROOM, code: 'collaboration-format-mismatch' },
    ]);
    expect(memory.saves).toEqual([]);
    expect(memory.backups).toEqual([]);
  });

  test('a store writes the state with an export of exactly that state', async () => {
    const memory = memoryStorage();
    const document = new Y.Doc();
    Y.applyUpdate(document, await roomState());
    await extensionOf({ storage: memory.storage }).onStoreDocument!({
      documentName: ROOM,
      document,
      clientsCount: 1,
    });
    const [saved] = memory.saves;
    expect(saved!.state).toEqual(Y.encodeStateAsUpdate(document));
    expect(saved!.export!.stateDigest).toBe(await sha256Hex(saved!.state));
    expect(saved!.export!.docx).toEqual(readCollaborationDocument(document));
  });

  test('a room that cannot export is not stored, and the event says so', async () => {
    const memory = memoryStorage();
    const events: CollaborationServerEvent[] = [];
    const document = new Y.Doc();
    document.getMap('anything').set('key', 'value');
    await extensionOf({
      storage: memory.storage,
      onEvent: (event) => events.push(event),
    }).onStoreDocument!({ documentName: ROOM, document, clientsCount: 1 });
    // A load refuses a state that does not export, so storing it would lose the stored room.
    expect(memory.saves).toEqual([]);
    expect(events).toEqual([
      { type: 'room-export-failed', roomName: ROOM, code: 'not-initialized' },
    ]);
  });

  test('the connection count comes from the room document at store time', async () => {
    const memory = memoryStorage();
    const document = new Y.Doc();
    Y.applyUpdate(document, await roomState());
    let connections = 2;
    Object.assign(document, { getConnectionsCount: () => connections });
    const extension = extensionOf({ storage: memory.storage, exportIntervalMs: 60_000 });
    // Hocuspocus builds the payload at the last edit, when people were still connected.
    const store = () =>
      extension.onStoreDocument!({ documentName: ROOM, document, clientsCount: 2 });
    await store();
    await store();
    connections = 0;
    await store();
    expect(memory.saves.map((saved) => saved.export !== null)).toEqual([true, false, true]);
  });

  test('exportIntervalMs skips exports while people are connected, never the last store', async () => {
    const memory = memoryStorage();
    const document = new Y.Doc();
    Y.applyUpdate(document, await roomState());
    const extension = extensionOf({ storage: memory.storage, exportIntervalMs: 60_000 });
    const store = (clientsCount: number) =>
      extension.onStoreDocument!({ documentName: ROOM, document, clientsCount });
    await store(2);
    await store(2);
    await store(0);
    await store(1);
    expect(memory.saves.map((saved) => saved.export !== null)).toEqual([true, false, true, false]);
    // The interval starts again when the room unloads.
    await extension.afterUnloadDocument({ documentName: ROOM });
    await store(1);
    expect(memory.saves.at(-1)!.export).not.toBeNull();
    // Every store writes the state, with or without an export.
    expect(memory.saves.every((saved) => saved.state.byteLength > 0)).toBe(true);
  });

  test('compactOnLoad stores a new generation, and keeps a current export current', async () => {
    const state = await roomState();
    const exported = { docx: docx(), stateDigest: await sha256Hex(state) };
    const memory = memoryStorage({ state, export: exported });
    const payload = loadPayload();
    await extensionOf({
      storage: memory.storage,
      compactOnLoad: { minimumGain: 0 },
    }).onLoadDocument(payload);
    const [saved] = memory.saves;
    expect(saved!.state).not.toEqual(state);
    expect(saved!.export).toEqual({
      docx: readCollaborationDocument(payload.document),
      stateDigest: await sha256Hex(saved!.state),
    });
    expect(Y.encodeStateAsUpdate(payload.document)).toEqual(saved!.state);
  });

  test('compactOnLoad replaces a stale export with one of the loaded room', async () => {
    const state = await roomState();
    const stale = { docx: docx('An earlier edit'), stateDigest: '00' };
    const memory = memoryStorage({ state, export: stale });
    const payload = loadPayload();
    await extensionOf({
      storage: memory.storage,
      compactOnLoad: { minimumGain: 0 },
    }).onLoadDocument(payload);
    const saved = memory.stored()!;
    expect(saved.export).toEqual({
      docx: readCollaborationDocument(payload.document),
      stateDigest: await sha256Hex(saved.state),
    });
  });

  test('an error from the event sink does not refuse a room', async () => {
    const memory = memoryStorage();
    const document = new Y.Doc();
    await extensionOf({
      storage: memory.storage,
      onEvent: () => {
        throw new Error('sink failed');
      },
    }).onStoreDocument!({ documentName: ROOM, document, clientsCount: 1 });
    expect(memory.saves).toEqual([]);
  });

  test('a room whose last store failed in storage is stored before it unloads', async () => {
    const memory = memoryStorage();
    let failing = true;
    const storage: CollaborationRoomStorage = {
      ...memory.storage,
      save: (name, room) => {
        if (failing) throw new Error('storage is down');
        return memory.storage.save(name, room);
      },
    };
    const document = new Y.Doc();
    Y.applyUpdate(document, await roomState());
    const extension = extensionOf({ storage });
    const payload = { documentName: ROOM, document, clientsCount: 1 };
    await expect(extension.onStoreDocument!(payload)).rejects.toThrow('storage is down');
    // Storage is still down: the error stops the unload, and the room stays in memory.
    await expect(extension.beforeUnloadDocument(payload)).rejects.toThrow('storage is down');
    failing = false;
    await extension.beforeUnloadDocument(payload);
    expect(memory.saves).toHaveLength(1);
    expect(memory.saves[0]!.state).toEqual(Y.encodeStateAsUpdate(document));
    // Nothing is left to store.
    await extension.beforeUnloadDocument(payload);
    expect(memory.saves).toHaveLength(1);
  });

  test('a room whose last store wrote no export is exported before it unloads', async () => {
    const memory = memoryStorage();
    const document = new Y.Doc();
    Y.applyUpdate(document, await roomState());
    const extension = extensionOf({ storage: memory.storage, exportIntervalMs: 60_000 });
    const payload = { documentName: ROOM, document, clientsCount: 1 };
    await extension.onStoreDocument!(payload);
    await extension.beforeUnloadDocument(payload);
    expect(memory.saves).toHaveLength(1);
    await extension.onStoreDocument!(payload);
    await extension.beforeUnloadDocument(payload);
    expect(memory.saves.map((saved) => saved.export !== null)).toEqual([true, false, true]);
  });
});

describe('a stored room of an earlier format', () => {
  test('is created again from its export, backed up, stored, and loaded', async () => {
    const earlier = await earlierRoom();
    const memory = memoryStorage(earlier);
    const events: CollaborationServerEvent[] = [];
    const payload = loadPayload();
    await extensionOf({
      storage: memory.storage,
      onEvent: (event) => events.push(event),
    }).onLoadDocument(payload);

    expect(memory.backups).toEqual([earlier.state]);
    const [saved] = memory.saves;
    expect(collaborationMigrationNeed(saved!.state)).toBe('current');
    expect(saved!.export!.docx).toBe(earlier.export!.docx);
    expect(saved!.export!.stateDigest).toBe(await sha256Hex(saved!.state));
    // The live room is the stored one, and it holds the document.
    expect(Y.encodeStateAsUpdate(payload.document)).toEqual(saved!.state);
    const body = strFromU8(
      unzipSync(readCollaborationDocument(payload.document))['word/document.xml']!
    );
    expect(body).toContain(SECRET);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'room-upgraded',
      roomName: ROOM,
      to: COLLABORATION_FORMAT_VERSION,
      hidden: 0,
    });
  });

  test('loads as a current room the next time, with no second upgrade', async () => {
    const memory = memoryStorage(await earlierRoom());
    const extension = extensionOf({ storage: memory.storage });
    await extension.onLoadDocument(loadPayload());
    await extension.onLoadDocument(loadPayload());
    expect(memory.saves).toHaveLength(1);
    expect(memory.backups).toHaveLength(1);
  });

  const refusals: readonly [
    string,
    (room: StoredCollaborationRoom) => Promise<StoredCollaborationRoom> | StoredCollaborationRoom,
    CollaborationServerOptions,
  ][] = [
    ['disabled', (room) => room, { upgradeOnLoad: false }],
    ['no-export', (room) => ({ state: room.state, export: null }), {}],
    ['too-large', (room) => room, { maxUpgradeStateBytes: 16 }],
    [
      'stale-export',
      (room) => ({ state: room.state, export: { ...room.export!, stateDigest: '00' } }),
      {},
    ],
    [
      'error',
      (room) => ({
        state: room.state,
        export: { docx: new Uint8Array([80, 75, 3]), stateDigest: room.export!.stateDigest },
      }),
      {},
    ],
  ];

  for (const [reason, change, options] of refusals) {
    test(`${reason}: the load is refused and storage is unchanged`, async () => {
      const stored = await change(await earlierRoom());
      const memory = memoryStorage(stored);
      const events: CollaborationServerEvent[] = [];
      const payload = loadPayload();
      expect(
        await reasonOf(() =>
          extensionOf({
            ...options,
            storage: memory.storage,
            onEvent: (event) => events.push(event),
          }).onLoadDocument(payload)
        )
      ).toBe('saved-room-unavailable');
      expect(memory.saves).toEqual([]);
      expect(memory.backups).toEqual([]);
      expect(memory.stored()).toBe(stored);
      expect(Y.encodeStateAsUpdate(payload.document).byteLength).toBeLessThan(8);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'room-upgrade-refused', roomName: ROOM, reason });
      // Positions and part names only: an event never holds the document's text.
      expect(JSON.stringify(events)).not.toContain(SECRET);
    });
  }

  test('the digest is what ties an export to a state', async () => {
    // The upgraded room is created from the export and checked against the export. Nothing
    // can compare it with the earlier state, which this build cannot read. So an export of
    // another state must never be used, and only the digest can tell.
    const earlier = await earlierRoom();
    const other = docx('Another document');
    const memory = memoryStorage({
      state: earlier.state,
      export: { docx: other, stateDigest: await sha256Hex(other) },
    });
    expect(
      await reasonOf(() => extensionOf({ storage: memory.storage }).onLoadDocument(loadPayload()))
    ).toBe('saved-room-unavailable');
    expect(memory.saves).toEqual([]);
  });

  test('a failed backup stops the upgrade before the room is replaced', async () => {
    const earlier = await earlierRoom();
    const memory = memoryStorage(earlier);
    const storage: CollaborationRoomStorage = {
      ...memory.storage,
      backUp: () => {
        throw new Error('backup unavailable');
      },
    };
    await expect(extensionOf({ storage }).onLoadDocument(loadPayload())).rejects.toThrow(
      'backup unavailable'
    );
    expect(memory.saves).toEqual([]);
    expect(memory.stored()).toBe(earlier);
  });
});
