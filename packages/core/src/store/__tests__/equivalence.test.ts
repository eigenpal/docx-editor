// Direct / API / MCP surface equivalence (document-engine task 11.8 core; goal
// gate 11 in-process surfaces). The same create+edit+query workflow expressed
// through the raw store (Direct), DocxEditor.* (API), and MCP dispatch MUST
// produce equivalent authored state and query results. (RPC + generated language
// clients extend this over the wire in sections 11–12.)

import { describe, expect, test } from 'bun:test';
import {
  DocxEditor,
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  fingerprint,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '../index.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

/** Body content normalized for cross-surface comparison (ids differ per surface). */
function bodyContent(model: PackageModel): { text: string; props: unknown }[][] {
  const story = model.stories.get(bodyStoryId(model))!;
  return story.blocks.map((b) =>
    (b as ParagraphRecord).runs.map((r) => ({ text: r.text, props: r.props ?? null })),
  );
}

const internal = (doc: DocxEditor.DocumentHandle): DocumentStore =>
  (doc as unknown as { internalStore: DocumentStore }).internalStore;

// --- three surfaces run the identical workflow: append "Hello world" paragraph ---

function viaDirect(): PackageModel {
  const store = new DocumentStore(createEmptyModel());
  const storyId = bodyStoryId(store.currentModel);
  const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
  const pid = r.ok ? r.modelChange.created[0] : '';
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: 'Hello world' }));
  return store.currentModel;
}

function viaApi(): PackageModel {
  const doc = DocxEditor.create();
  DocxEditor.run(doc, (ctx) => {
    ctx.document.body.insertParagraph('Hello world');
    ctx.sync();
  });
  return internal(doc).currentModel;
}

function viaMcp(): PackageModel {
  const doc = DocxEditor.create();
  // The API path targets `document.body`; the equivalent MCP write is an explicit
  // body scope (an omitted scope would follow the active story, not the body).
  const created = DocxEditor.mcp.dispatch(doc, 'appendParagraph', { scope: 'body' });
  const pid = created.status === 'ok' ? (created.value as string) : '';
  DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: pid, text: 'Hello world' });
  return internal(doc).currentModel;
}

describe('surface equivalence (gate 11)', () => {
  test('Direct, API, and MCP produce equivalent authored body content', () => {
    const direct = bodyContent(viaDirect());
    const api = bodyContent(viaApi());
    const mcp = bodyContent(viaMcp());
    expect(api).toEqual(direct);
    expect(mcp).toEqual(direct);
    // And the same authored-state fingerprint (ids are ephemera-excluded structurally
    // here because we compare content, not the whole model).
    expect(fingerprint('authoredState', { body: api })).toBe(fingerprint('authoredState', { body: direct }));
  });

  test('query results agree across API and MCP surfaces', () => {
    const doc = DocxEditor.create();
    let pid = '';
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('shared query');
      ctx.sync();
      pid = p.id;
    });
    const apiQuery = DocxEditor.query(doc, { kind: 'paragraphText', paragraphId: pid });
    const mcpQuery = DocxEditor.mcp.dispatch(doc, 'getParagraphText', { paragraphId: pid });
    expect(apiQuery.status).toBe('ok');
    expect(mcpQuery.status).toBe('ok');
    if (apiQuery.status === 'ok' && mcpQuery.status === 'ok') {
      expect(mcpQuery.value).toBe(apiQuery.value);
      expect(apiQuery.value).toBe('shared query');
    }
  });

  test('an invalid workflow fails equivalently on all surfaces (no mutation)', () => {
    // Direct: invalid op returns validation failure, no revision change.
    const store = new DocumentStore(createEmptyModel());
    const d = store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: '', text: 'x' }));
    expect(d.ok).toBe(false);
    expect(store.currentRevision).toBe(0);

    // MCP: invalid input returns validation, no revision change.
    const doc = DocxEditor.create();
    const m = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1' }); // missing text
    expect(m.status).toBe('validation');
    expect(doc.revision).toBe(0);
  });
});
