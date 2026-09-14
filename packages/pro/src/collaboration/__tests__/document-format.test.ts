/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { RELEASE_2_17_0_ROOM_BASE64 } from './fixtures/release-2.17.0.ts';
import * as Y from 'yjs';
import {
  COLLABORATION_FORMAT_VERSION,
  DOCUMENT_COLLABORATION_VERSIONS,
  assertCollaborationFormatCompatibility,
  readCollaborationFormatVersion,
  readCollaborationDocument,
} from '../index.ts';
import { PACKAGE_META_KEY } from '../document/schema.ts';
import { CollaborationSchemaError } from '../schema.ts';

function savedRoom(): Y.Doc {
  const doc = new Y.Doc();
  const meta = doc.getMap(PACKAGE_META_KEY);
  meta.set('initialized', true);
  meta.set('documentId', 'format-version-test');
  for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS)) {
    meta.set(field, value);
  }
  return doc;
}

test.each([
  'collaboration-format-mismatch',
  'protocol-version-mismatch',
  'schema-version-mismatch',
] as const)(
  '%s includes actionable upgrade guidance without changing diagnostic fields',
  (code) => {
    const error = new CollaborationSchemaError(code, 'version diagnostic');
    expect(error.code).toBe(code);
    expect(error.detail).toBe('version diagnostic');
    expect(error.message).toContain('Collaboration upgrade required');
    expect(error.message).toContain('Save local changes');
    expect(error.message).toContain(
      'https://www.docx-editor.dev/docs/latest/pro/collaboration-versions'
    );
  }
);

test('unrelated failures do not suggest a collaboration migration', () => {
  const error = new CollaborationSchemaError('initialization-timeout', 'No response');
  expect(error.message).toBe('initialization-timeout: No response');
});

test('the public format version survives a JSON handshake', () => {
  const { version } = JSON.parse(JSON.stringify({ version: COLLABORATION_FORMAT_VERSION }));
  expect(() => assertCollaborationFormatCompatibility(version)).not.toThrow();
});

test('admission rejects invalid claims without coercion or exposing received data', () => {
  const hostile = {
    toString() {
      throw new Error('must not coerce');
    },
  };
  for (const value of [
    undefined,
    null,
    3,
    true,
    [],
    {},
    DOCUMENT_COLLABORATION_VERSIONS,
    hostile,
    `${COLLABORATION_FORMAT_VERSION}-different`,
    '<script>private data</script>',
    'x'.repeat(10000),
  ]) {
    try {
      assertCollaborationFormatCompatibility(value);
      throw new Error('expected refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(CollaborationSchemaError);
      expect(error).toMatchObject({ code: 'collaboration-format-mismatch' });
      expect((error as CollaborationSchemaError).detail).not.toContain('private data');
      expect((error as CollaborationSchemaError).detail!.length).toBeLessThan(120);
    }
  }
});

test('saved-room inspection is read-only and agrees with the client contract', () => {
  const original = savedRoom();
  const restored = new Y.Doc();
  try {
    const bytes = Y.encodeStateAsUpdate(original);
    Y.applyUpdate(restored, bytes);
    let updates = 0;
    restored.on('update', () => updates++);
    expect(readCollaborationFormatVersion(restored)).toBe(COLLABORATION_FORMAT_VERSION);
    expect(Y.encodeStateAsUpdate(restored)).toEqual(bytes);
    expect(updates).toBe(0);
  } finally {
    original.destroy();
    restored.destroy();
  }
});

for (const field of Object.keys(DOCUMENT_COLLABORATION_VERSIONS)) {
  test(`a different saved ${field} changes compatibility without requiring export`, () => {
    const doc = savedRoom();
    try {
      const meta = doc.getMap(PACKAGE_META_KEY);
      meta.set(field, (meta.get(field) as number) + 1);
      const before = Y.encodeStateAsUpdate(doc);
      const version = readCollaborationFormatVersion(doc);
      expect(version).not.toBe(COLLABORATION_FORMAT_VERSION);
      expect(() => assertCollaborationFormatCompatibility(version)).toThrow(
        'collaboration-format-mismatch'
      );
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    } finally {
      doc.destroy();
    }
  });
}

test('an older room can be inspected but remains incompatible and unchanged', () => {
  const doc = savedRoom();
  try {
    doc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', 2);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() =>
      assertCollaborationFormatCompatibility(readCollaborationFormatVersion(doc))
    ).toThrow('collaboration-format-mismatch');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    doc.destroy();
  }
});

test('a room seeded by release 2.17.0 is identifiable without upgrading or exporting it', () => {
  const bytes = new Uint8Array(Buffer.from(RELEASE_2_17_0_ROOM_BASE64, 'base64'));
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    const version = readCollaborationFormatVersion(doc);
    expect(version).toBe('docx-collaboration:1.2.1.1');
    expect(() => assertCollaborationFormatCompatibility(version)).toThrow(
      'collaboration-format-mismatch'
    );
    expect(() => readCollaborationDocument(doc)).toThrow('schema-version-mismatch');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
  } finally {
    doc.destroy();
  }
});

test('an unseeded room refuses without creating metadata', () => {
  const doc = new Y.Doc();
  try {
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => readCollaborationFormatVersion(doc)).toThrow('not-initialized');
    expect(doc.share.size).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    doc.destroy();
  }
});

test('missing or malformed saved versions refuse with a stable code', () => {
  const doc = savedRoom();
  try {
    for (const value of [
      undefined,
      null,
      '3',
      -1,
      NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      doc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', value);
      expect(() => readCollaborationFormatVersion(doc)).toThrow('collaboration-format-mismatch');
    }
  } finally {
    doc.destroy();
  }
});

test('a wrong metadata container refuses with a stable code without changing the room', () => {
  const doc = new Y.Doc();
  try {
    doc.getArray(PACKAGE_META_KEY).push(['invalid']);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => readCollaborationFormatVersion(doc)).toThrow('collaboration-format-mismatch');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    doc.destroy();
  }
});
