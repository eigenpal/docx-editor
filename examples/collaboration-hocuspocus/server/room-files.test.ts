import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeAtomically, writeNewFile } from './room-files.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'room-files-'));
  directories.push(created);
  return created;
}

describe('room files', () => {
  test('a create-only write keeps the first file and leaves no temporary file', async () => {
    const dir = directory();
    const file = path.join(dir, 'room.ydoc');
    expect(await writeNewFile(file, new Uint8Array([1]))).toBe(true);
    expect(await writeNewFile(file, new Uint8Array([2]))).toBe(false);
    expect([...readFileSync(file)]).toEqual([1]);
    expect(readdirSync(dir)).toEqual(['room.ydoc']);
  });

  test('a failed write leaves no temporary file', async () => {
    const dir = directory();
    const file = path.join(dir, 'room.ydoc');
    // A value the write rejects, standing in for a full disk.
    await expect(writeNewFile(file, null as never)).rejects.toThrow();
    await expect(writeAtomically(file, null as never)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});
