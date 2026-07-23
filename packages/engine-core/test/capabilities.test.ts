// Capability integration + distribution boundary (document-engine tasks 9.1, 9.6).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  checkEditableComplete,
  buildBaseRegistry,
  PARAGRAPH_CAPABILITY,
  REQUIRED_EDITABLE_ROLES,
  assertCoreBlockRegistryComplete,
  resolveCoreRegistry,
  resetCoreRegistryCache,
  registerCoreBlockCapability,
  registerBlockElementParser,
  snapshotBlockRegistryForTest,
  restoreBlockRegistryForTest,
  isTopLevelEditable,
  parseDocx,
  writeDocx,
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  paragraphText,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '../src/index.ts';

describe('editable capability completeness (9.1)', () => {
  test('the base paragraph capability is complete and resolves through the registry', () => {
    expect(checkEditableComplete(PARAGRAPH_CAPABILITY).ok).toBe(true);
    const registry = buildBaseRegistry();
    expect(registry.get('capability', PARAGRAPH_CAPABILITY.id)).toBeDefined();
    expect(registry.get('command', 'dev.docx-editor.core.command.insert-text')).toBeDefined();
  });

  test('an editable capability missing a pipeline role is rejected as incomplete', () => {
    const incomplete = { id: 'dev.x.capability.broken', roles: ['parse', 'command', 'query'] as const }; // no 'serialize'
    const r = checkEditableComplete(incomplete);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('serialize');
    // Building a registry with it declared editable throws before any document opens.
    expect(() => buildBaseRegistry([], [incomplete])).toThrow(/incomplete/);
  });

  test('every required role is enumerated', () => {
    expect([...REQUIRED_EDITABLE_ROLES].sort()).toEqual(['command', 'parse', 'query', 'serialize']);
  });
});

describe('core registry unification: FeatureBundle connected to runtime handlers at open (3.9 / 9.1-9.3)', () => {
  test('the registered block capabilities are complete and resolve through the versioned registry', () => {
    expect(() => assertCoreBlockRegistryComplete()).not.toThrow();
    const registry = resolveCoreRegistry();
    // The resolved registry carries a capability contribution per registered block kind — the
    // versioned FeatureBundle registry is now connected to the real handlers.
    for (const kind of ['paragraph', 'table', 'sdt']) {
      expect(registry.get('capability', `dev.docx-editor.core.capability.block-${kind}`)).toBeDefined();
    }
  });

  test('a registration AFTER open re-validates: an incomplete editable kind is then rejected', () => {
    resolveCoreRegistry(); // prime the memoized cache
    const snap = snapshotBlockRegistryForTest();
    try {
      // Make SDT editable but with NO semantic operations — the version bump must invalidate the
      // cache so the next resolution catches it (the High: stale cache masked this).
      registerCoreBlockCapability({ kind: 'sdt', editPolicy: { topLevelEditable: true } });
      expect(() => resolveCoreRegistry()).toThrow(/editable block kind 'sdt' incomplete: missing semanticOps/);
    } finally {
      restoreBlockRegistryForTest(snap);
      resetCoreRegistryCache();
    }
    expect(() => resolveCoreRegistry()).not.toThrow(); // restored to a complete state
  });

  test('mutating a registered editPolicy object after registration cannot flip editability', () => {
    const snap = snapshotBlockRegistryForTest();
    try {
      const policy = { topLevelEditable: false };
      registerCoreBlockCapability({ kind: 'sdt', editPolicy: policy });
      resolveCoreRegistry(); // caches (sdt non-editable => complete)
      policy.topLevelEditable = true; // mutate the CALLER's object after registration
      // The stored editPolicy is a frozen CLONE, so this is a no-op — sdt stays non-editable and the
      // cached completeness result remains valid (the High: aliased metadata bypassed the cache).
      expect(isTopLevelEditable('sdt')).toBe(false);
    } finally {
      restoreBlockRegistryForTest(snap);
      resetCoreRegistryCache();
    }
  });

  test('semanticOps must name REAL DocOps (a bogus op id fails completeness)', () => {
    const snap = snapshotBlockRegistryForTest();
    try {
      registerCoreBlockCapability({ kind: 'sdt', editPolicy: { topLevelEditable: true }, semanticOps: ['not-a-docop'] });
      expect(() => assertCoreBlockRegistryComplete()).toThrow(/semanticOps\(unknown: not-a-docop\)/);
    } finally {
      restoreBlockRegistryForTest(snap);
      resetCoreRegistryCache();
    }
  });

  test('a duplicate element parser is rejected (no silent last-wins override)', () => {
    expect(() => registerBlockElementParser('w:p', () => ({ kind: 'paragraph', id: 'x', runs: [] }), 'paragraph')).toThrow(
      /duplicate parser for block element 'w:p'/,
    );
  });

  test('opening any document runs the core-registry resolution (parse succeeds with it wired in)', () => {
    resetCoreRegistryCache(); // force a fresh resolution on the next open
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>`),
    });
    const r = parseDocx(bytes);
    expect(r.ok).toBe(true);
  });
});

describe('distribution boundary: base parse/edit/save needs no PM/Yjs/PDF (9.6)', () => {
  test('a full parse -> edit -> save cycle uses only engine-core', () => {
    // Create + edit + save + reopen, importing ONLY @docx-editor.dev/engine-core symbols.
    const store = new DocumentStore(createEmptyModel());
    const p1 = (store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord).id;
    store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'base only' }));
    const reopened = parseDocx(writeDocx(store.currentModel));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      const text = (reopened.model.stories.get(bodyStoryId(reopened.model))!.blocks[0] as ParagraphRecord).runs
        .map((r) => r.text)
        .join('');
      expect(text).toBe('base only');
    }
  });

  test("engine-core's manifest declares no PM/Yjs/transport/PDF runtime dependency", () => {
    const pkg = require('../package.json');
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    const forbidden = /^(prosemirror|yjs|y-|pdf-lib|pdfkit|ws$|socket\.io|@react-pdf)/;
    for (const name of Object.keys(deps)) expect(forbidden.test(name)).toBe(false);
    // fflate + fast-xml-parser (parse/save) ARE allowed and present.
    expect('fflate' in deps).toBe(true);
    expect('fast-xml-parser' in deps).toBe(true);
  });
});
