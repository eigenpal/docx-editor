// Capability integration + distribution boundary (document-engine tasks 9.1, 9.6).

import { describe, expect, test } from 'bun:test';
import {
  checkEditableComplete,
  buildBaseRegistry,
  PARAGRAPH_CAPABILITY,
  REQUIRED_EDITABLE_ROLES,
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
