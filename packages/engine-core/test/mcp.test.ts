// MCP tool schemas + schema-bound dispatch (document-engine tasks 7.10, 7.11).

import { describe, expect, test } from 'bun:test';
import { DocxEditor, bodyStoryId, createEmptyModel, DocumentStore, type Story } from '../src/index.ts';

/** A handle backed by a store that also carries a header story. */
function handleWithHeader(headerId = 'st-header'): { doc: DocxEditor.DocumentHandle; headerId: string } {
  const base = createEmptyModel();
  const header: Story = { id: headerId, kind: 'header', blocks: [{ kind: 'paragraph', id: 'hp1', runs: [] }] };
  const stories = new Map(base.stories);
  stories.set(headerId, header);
  const store = new DocumentStore({ ...base, stories });
  // The public object model reaches the store only through `internalStore`; this
  // shim exercises the real dispatch path against a header-bearing document.
  const doc = { internalStore: store, revision: store.currentRevision } as unknown as DocxEditor.DocumentHandle;
  return { doc, headerId };
}

describe('MCP tool generation (7.11)', () => {
  test('enumerated tool schemas equal the registry schemas', () => {
    const tools = DocxEditor.mcp.tools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const cmd of DocxEditor.mcp.commands) {
      expect(byName.get(cmd.tool)!.inputSchema).toBe(cmd.input); // same schema object, not a copy
    }
    expect(tools.map((t) => t.name).sort()).toEqual(['appendParagraph', 'getParagraphText', 'insertText']);
  });
});

describe('schema-bound dispatch (7.11)', () => {
  test('valid insertText mutates through a semantic transaction', () => {
    const doc = DocxEditor.create();
    let pid = '';
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('');
      ctx.sync();
      pid = p.id;
    });
    const result = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: pid, text: 'via mcp' });
    expect(result.status).toBe('ok');
    expect(DocxEditor.query(doc, { kind: 'paragraphText', paragraphId: pid })).toMatchObject({ value: 'via mcp' });
  });

  test('invalid input opens NO write transaction (revision unchanged)', () => {
    const doc = DocxEditor.create();
    const before = doc.revision;
    // Missing required "text".
    const r1 = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1' });
    expect(r1.status).toBe('validation');
    // Wrong type.
    const r2 = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1', text: 42 });
    expect(r2.status).toBe('validation');
    // Extra property.
    const r3 = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1', text: 'x', evil: true });
    expect(r3.status).toBe('validation');
    // Unknown tool.
    const r4 = DocxEditor.mcp.dispatch(doc, 'noSuchTool', {});
    expect(r4.status).toBe('validation');
    expect(doc.revision).toBe(before); // nothing committed
  });

  test('appendParagraph with an explicit body scope returns the created id and commits once', () => {
    const doc = DocxEditor.create();
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', { scope: 'body' });
    expect(r.status).toBe('ok');
    expect(doc.revision).toBe(1);
    if (r.status === 'ok') expect(typeof r.value).toBe('string');
  });
});

// Regression for the reviewer finding: dispatch used to hardcode the body story,
// ignoring scope entirely. It now resolves the write scope (task 7.6), so an
// omitted scope follows the active story and is REJECTED — never silently sent to
// the body — when no active story is set.
describe('scope-driven appendParagraph dispatch (7.6)', () => {
  test('an omitted scope with NO active story is rejected, not silently appended to the body', () => {
    const doc = DocxEditor.create();
    const before = doc.revision;
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', {});
    // Old hardcoded-body dispatch would have returned ok here; scope resolution rejects.
    expect(r).toMatchObject({ status: 'validation' });
    if (r.status !== 'ok') expect(r.message).toContain('no-active-story');
    expect(doc.revision).toBe(before); // nothing committed
  });

  test('an omitted scope follows the active story (here the body) and commits there', () => {
    const doc = DocxEditor.create();
    const bodyId = bodyStoryId(doc.internalStore.currentModel);
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', {}, { activeStoryId: bodyId });
    expect(r.status).toBe('ok');
    expect(doc.revision).toBe(1);
  });

  test('an omitted scope with an active HEADER appends to the header, not the body', () => {
    const { doc, headerId } = handleWithHeader();
    const store = doc.internalStore;
    const bodyId = bodyStoryId(store.currentModel);
    const bodyBlocksBefore = store.currentModel.stories.get(bodyId)!.blocks.length;

    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', {}, { activeStoryId: headerId });
    expect(r.status).toBe('ok');

    // The new paragraph landed in the HEADER story; the body is untouched.
    expect(store.currentModel.stories.get(headerId)!.blocks.length).toBe(2);
    expect(store.currentModel.stories.get(bodyId)!.blocks.length).toBe(bodyBlocksBefore);
    if (r.status === 'ok') {
      const headerIds = store.currentModel.stories.get(headerId)!.blocks.map((b) => (b as { id: string }).id);
      expect(headerIds).toContain(r.value);
    }
  });

  test('the read-only aggregate scope cannot be written', () => {
    const doc = DocxEditor.create();
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', { scope: 'aggregate' });
    expect(r).toMatchObject({ status: 'validation' });
    if (r.status !== 'ok') expect(r.message).toContain('aggregate-not-writable');
    expect(doc.revision).toBe(0);
  });

  test('a specific story scope for an unknown story fails without mutating', () => {
    const doc = DocxEditor.create();
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', { scope: 'story', storyId: 'st-nope' });
    expect(r).toMatchObject({ status: 'validation' });
    if (r.status !== 'ok') expect(r.message).toContain('unknown-story');
    expect(doc.revision).toBe(0);
  });

  test('scope "story" without a storyId is a validation error', () => {
    const doc = DocxEditor.create();
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', { scope: 'story' });
    expect(r).toMatchObject({ status: 'validation' });
    expect(doc.revision).toBe(0);
  });

  test('an unknown scope string is rejected and opens no transaction', () => {
    const doc = DocxEditor.create();
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', { scope: 'sideways' });
    expect(r).toMatchObject({ status: 'validation' });
    if (r.status !== 'ok') expect(r.message).toContain('unknown scope');
    expect(doc.revision).toBe(0);
  });
});
