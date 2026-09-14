import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  DOCUMENT_COLLABORATION_VERSIONS,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import { authenticateDemoToken, encodeDemoToken } from '../shared/admission.ts';
import { loadStoredDemoDocument } from './stored-room.ts';
import {
  loadPackage,
  nodeText,
} from '../../../packages/pro/src/collaboration/__tests__/document-support.ts';
import {
  createPeerHarness,
  zipDocument,
} from '../../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';

for (const version of [2, DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion + 1]) {
  test(`a compatible client cannot load saved schema ${version} or change live state`, () => {
    const saved = new Y.Doc();
    const live = new Y.Doc();
    try {
      const meta = saved.getMap('docx-package-meta-v1');
      meta.set('initialized', true);
      meta.set('documentId', 'stored-room-12345678901234567890');
      for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS))
        meta.set(field, value);
      meta.set('sharedSchemaVersion', version);
      const bytes = Y.encodeStateAsUpdate(saved);
      const originalBytes = bytes.slice();
      live.getMap('sentinel').set('value', 'unchanged');
      const before = Y.encodeStateAsUpdate(live);
      authenticateDemoToken(encodeDemoToken('secret'), 'secret');
      expect(() => loadStoredDemoDocument(live, bytes)).toThrow('collaboration-format-mismatch');
      expect(Y.encodeStateAsUpdate(live)).toEqual(before);
      expect(bytes).toEqual(originalBytes);
    } finally {
      saved.destroy();
      live.destroy();
    }
  });
}

test('malformed saved updates are refused without touching the live document', () => {
  const live = new Y.Doc();
  try {
    const before = Y.encodeStateAsUpdate(live);
    expect(() => loadStoredDemoDocument(live, new Uint8Array([255]))).toThrow('invalid-saved-room');
    expect(Y.encodeStateAsUpdate(live)).toEqual(before);
  } finally {
    live.destroy();
  }
});

test('a current-version snapshot with a missing root gets saved-room recovery', () => {
  const saved = new Y.Doc();
  const live = new Y.Doc();
  try {
    const meta = saved.getMap('docx-package-meta-v1');
    meta.set('initialized', true);
    meta.set('documentId', 'stored-room-12345678901234567890');
    for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS))
      meta.set(field, value);
    saved.getMap('docx-package-parts-v1').set(
      '/word/document.xml',
      new Y.Map([
        ['id', '/word/document.xml'],
        ['rootId', 'missing-root'],
        [
          'contentType',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        ],
      ])
    );
    const before = Y.encodeStateAsUpdate(live);
    expect(() => loadStoredDemoDocument(live, Y.encodeStateAsUpdate(saved))).toThrow(
      'invalid-saved-room'
    );
    expect(Y.encodeStateAsUpdate(live)).toEqual(before);
  } finally {
    saved.destroy();
    live.destroy();
  }
});

test('a healthy current saved room loads and exports its complete document', async () => {
  const harness = createPeerHarness('stored-room-12345678901234567890');
  const live = new Y.Doc();
  try {
    const { alice } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Recovered from disk</w:t></w:r></w:p><w:sectPr/>')
    );
    loadStoredDemoDocument(live, Y.encodeStateAsUpdate(alice.ydoc));
    const reopened = loadPackage(readCollaborationDocument(live));
    const main = reopened.parts.get(reopened.mainDocumentPart)!;
    expect(nodeText(main.root)).toBe('Recovered from disk');
  } finally {
    harness.cleanup();
    live.destroy();
  }
});
