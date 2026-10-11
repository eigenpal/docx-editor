import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import {
  DOCUMENT_COLLABORATION_VERSIONS,
  prepareCollaborationServerDocument,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import { loadStoredReviewRoom } from './stored-room.ts';
import { sampleDocument } from './sample.ts';
import { seedGeneration } from '../../../packages/pro/src/collaboration/room-generation.ts';

async function withRoom(run: (live: Y.Doc, file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'review-saved-room-'));
  const live = new Y.Doc();
  prepareCollaborationServerDocument(live);
  try {
    await run(live, path.join(directory, 'room.ydoc'));
  } finally {
    live.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

for (const kind of ['malformed', 'incompatible', 'missing-content'] as const) {
  test(`${kind} saved state leaves the live room and saved bytes unchanged`, async () => {
    await withRoom(async (live, file) => {
      const candidate = new Y.Doc();
      let stored: Uint8Array;
      try {
        const meta = candidate.getMap('docx-package-meta-v1');
        meta.set('initialized', true);
        meta.set('documentId', 'review-room-12345678901234567890');
        for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS)) {
          meta.set(field, value);
        }
        if (kind === 'incompatible') {
          meta.set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion + 1);
        }
        stored = kind === 'malformed' ? new Uint8Array([255]) : Y.encodeStateAsUpdate(candidate);
      } finally {
        candidate.destroy();
      }
      await writeFile(file, stored);
      live.getMap('sentinel').set('value', 'unchanged');
      const before = Y.encodeStateAsUpdate(live);
      await expect(loadStoredReviewRoom(live, file)).rejects.toMatchObject({
        reason: kind === 'incompatible' ? 'schema-version-mismatch' : 'invalid-saved-room',
      });
      expect(Y.encodeStateAsUpdate(live)).toEqual(before);
      expect(Array.from(await readFile(file))).toEqual(Array.from(stored));
    });
  });
}

test('a missing saved file allows an empty room', async () => {
  await withRoom(async (live, file) => {
    const before = Y.encodeStateAsUpdate(live);
    await loadStoredReviewRoom(live, file);
    expect(Y.encodeStateAsUpdate(live)).toEqual(before);
  });
});

test('a valid saved room loads and exports its content', async () => {
  await withRoom(async (live, file) => {
    const stored = await seedGeneration(sampleDocument(), 'review-room-12345678901234567890');
    await writeFile(file, stored);
    await loadStoredReviewRoom(live, file);
    const expected = new Y.Doc();
    prepareCollaborationServerDocument(expected);
    try {
      Y.applyUpdate(expected, stored);
      expect(readCollaborationDocument(live)).toEqual(readCollaborationDocument(expected));
    } finally {
      expected.destroy();
    }
  });
});
