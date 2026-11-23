import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRoomStorage } from './room-storage.ts';

const ROOM = 'room-1234567890abcdefghij';
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'room-storage-'));
  directories.push(created);
  return created;
}

const reasonOf = async (run: () => unknown): Promise<string | undefined> => {
  try {
    await run();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

describe('room storage', () => {
  test('a room that was never stored loads as no room', async () => {
    expect(await createRoomStorage(directory()).load(ROOM)).toBeNull();
  });

  test('a stored room loads with its export and the digest of the exported state', async () => {
    const dir = directory();
    const storage = createRoomStorage(dir);
    const room = {
      state: new Uint8Array([1, 2, 3]),
      export: { docx: new Uint8Array([80, 75]), stateDigest: 'abc123' },
    };
    await storage.save(ROOM, room);
    expect(await storage.load(ROOM)).toEqual(room);
    expect(readdirSync(dir).sort()).toEqual([
      `${ROOM}.room`,
      `${ROOM}.ydoc`,
      `${ROOM}.ydoc.docx`,
      `${ROOM}.ydoc.docx.sha256`,
    ]);
  });

  test('a store without an export keeps the stored export and its digest', async () => {
    const storage = createRoomStorage(directory());
    const exported = { docx: new Uint8Array([80, 75]), stateDigest: 'abc123' };
    await storage.save(ROOM, { state: new Uint8Array([1]), export: exported });
    await storage.save(ROOM, { state: new Uint8Array([2]), export: null });
    // The digest still names the first state, so the export reads as stale.
    expect(await storage.load(ROOM)).toEqual({ state: new Uint8Array([2]), export: exported });
  });

  test('an export without its digest is no export', async () => {
    const dir = directory();
    const storage = createRoomStorage(dir);
    await storage.save(ROOM, {
      state: new Uint8Array([1]),
      export: { docx: new Uint8Array([80, 75]), stateDigest: 'abc123' },
    });
    unlinkSync(path.join(dir, `${ROOM}.ydoc.docx.sha256`));
    expect((await storage.load(ROOM))!.export).toBeNull();
  });

  test('a known room whose state is missing is refused, never created again', async () => {
    const dir = directory();
    const storage = createRoomStorage(dir);
    await storage.save(ROOM, { state: new Uint8Array([1]), export: null });
    unlinkSync(path.join(dir, `${ROOM}.ydoc`));
    expect(await reasonOf(() => storage.load(ROOM))).toBe('saved-room-unavailable');
  });

  test('a backup keeps the earlier state beside the room', async () => {
    const dir = directory();
    const storage = createRoomStorage(dir);
    await storage.backUp!(ROOM, new Uint8Array([9]));
    expect(readdirSync(dir)).toEqual([`${ROOM}.ydoc.previous`]);
  });

  test('a name that is not a room ID reaches no file', async () => {
    const dir = directory();
    const storage = createRoomStorage(dir);
    writeFileSync(path.join(dir, 'secret.ydoc'), new Uint8Array([7]));
    for (const name of ['../secret', 'secret', `../${ROOM}`, `${ROOM}/x`]) {
      expect(await storage.load(name)).toBeNull();
      await expect(
        storage.save(name, { state: new Uint8Array([1]), export: null })
      ).rejects.toThrow('not a room ID');
      await expect(storage.backUp!(name, new Uint8Array([1]))).rejects.toThrow('not a room ID');
    }
    expect(readdirSync(dir)).toEqual(['secret.ydoc']);
  });
});
