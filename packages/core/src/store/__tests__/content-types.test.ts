// Tests for authored content-type + relationship records (document-engine task
// 2.6). Covers Override>Default precedence, ASCII-case-insensitive matching
// (incl. the Turkish-I regression the OOXML review flagged), conflict/duplicate
// fail-closed, MIME validation, record-count N/N+1, and relationship retention.

import { describe, expect, test } from 'bun:test';
import {
  buildContentTypeIndex,
  resolveContentType,
  isValidMime,
  extensionKey,
  type ContentTypeRecords,
  buildRelationshipSet,
  resolveRelationship,
  type RelationshipRecord,
} from '../package/index.ts';

const records = (
  defaults: [string, string][],
  overrides: [string, string][] = []
): ContentTypeRecords => ({
  defaults: defaults.map(([extension, contentType], order) => ({ extension, contentType, order })),
  overrides: overrides.map(([partName, contentType], order) => ({ partName, contentType, order })),
});

describe('content-type index', () => {
  test('Override beats Default; Default resolves by extension', () => {
    const r = buildContentTypeIndex(
      records(
        [['xml', 'application/xml']],
        [
          [
            '/word/document.xml',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
          ],
        ]
      )
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveContentType(r.index, '/word/document.xml').source).toBe('override');
    expect(resolveContentType(r.index, '/word/other.xml')).toMatchObject({
      ok: true,
      contentType: 'application/xml',
      source: 'default',
    });
    expect(resolveContentType(r.index, '/word/media/x.bin').ok).toBe(false);
  });

  test('extension matching is ASCII case-insensitive, but not locale-folded', () => {
    const r = buildContentTypeIndex(records([['PNG', 'image/png']]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveContentType(r.index, '/word/media/a.png').contentType).toBe('image/png');
    expect(resolveContentType(r.index, '/word/media/a.PnG').contentType).toBe('image/png');
    // Turkish dotless-i must NOT fold to ASCII 'i' (regression from OOXML review).
    expect(extensionKey('I')).toBe('i');
    expect(extensionKey('İ')).toBe('İ'); // İ stays İ, never 'i'
  });

  test('conflicting Defaults on one extension fail closed', () => {
    const r = buildContentTypeIndex(
      records([
        ['xml', 'application/xml'],
        ['XML', 'text/xml'],
      ])
    );
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'conflicting-default', extension: 'xml' },
    });
  });

  test('identical duplicate Defaults are preserved (no error)', () => {
    const r = buildContentTypeIndex(
      records([
        ['xml', 'application/xml'],
        ['xml', 'application/xml'],
      ])
    );
    expect(r.ok).toBe(true);
  });

  test('duplicate Override part names with different MIME fail closed', () => {
    const r = buildContentTypeIndex(
      records(
        [],
        [
          ['/word/document.xml', 'application/xml'],
          ['/Word/Document.xml', 'text/xml'],
        ]
      )
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'duplicate-override' } });
  });

  test('invalid MIME syntax fails closed', () => {
    expect(isValidMime('application/xml')).toBe(true);
    expect(isValidMime('not-a-mime')).toBe(false);
    expect(buildContentTypeIndex(records([['xml', 'bogus']])).ok).toBe(false);
  });

  test('record count enforces N (ok) and N+1 (fail)', () => {
    const many = (n: number): ContentTypeRecords =>
      records(
        Array.from({ length: n }, (_, i) => [`e${i}`, 'application/xml'] as [string, string])
      );
    expect(buildContentTypeIndex(many(3), 3).ok).toBe(true); // N
    expect(buildContentTypeIndex(many(4), 3)).toMatchObject({
      ok: false,
      error: { code: 'too-many-records', limit: 3 },
    });
  });
});

describe('relationship records', () => {
  const rel = (
    id: string,
    rawTarget: string,
    targetMode: 'Internal' | 'External',
    order: number
  ): RelationshipRecord => ({
    ownerPart: '/word/document.xml',
    id,
    type: 'http://example/type',
    rawTarget,
    targetMode,
    order,
  });

  test('groups by owner in order and rejects duplicate ids', () => {
    const ok = buildRelationshipSet([
      rel('rId2', 'media/i.png', 'Internal', 1),
      rel('rId1', 'styles.xml', 'Internal', 0),
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.byOwner.get('/word/document.xml')!.map((r) => r.id)).toEqual(['rId1', 'rId2']);
    expect(
      buildRelationshipSet([rel('rId1', 'a', 'Internal', 0), rel('rId1', 'b', 'Internal', 1)])
    ).toMatchObject({
      ok: false,
      error: { code: 'duplicate-id' },
    });
  });

  test('internal resolves owner-relative; external retains raw and never resolves', () => {
    const internal = resolveRelationship(rel('rId1', 'media/i.png', 'Internal', 0));
    expect(internal).toMatchObject({ mode: 'Internal', raw: 'media/i.png' });
    if (internal.mode === 'Internal')
      expect(internal.target).toEqual({ ok: true, partName: '/word/media/i.png' });

    const external = resolveRelationship(rel('rId2', 'https://example.com/x', 'External', 1));
    expect(external).toMatchObject({ mode: 'External', raw: 'https://example.com/x' });
    if (external.mode === 'External') expect(external.sinkSafe.ok).toBe(true);

    const unsafe = resolveRelationship(rel('rId3', 'javascript:alert(1)', 'External', 2));
    // raw is retained verbatim even though the sink projection is rejected.
    expect(unsafe.raw).toBe('javascript:alert(1)');
    if (unsafe.mode === 'External') expect(unsafe.sinkSafe.ok).toBe(false);
  });
});
