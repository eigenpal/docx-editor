// Command/query scope tests (document-engine task 7.6).

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../src/index.ts';
import { createEmptyModel, bodyStoryId, type PackageModel, type Story } from '../src/index.ts';

/** A model with a body + a header story. */
function withHeader(): { model: PackageModel; bodyId: string; headerId: string } {
  const base = createEmptyModel();
  const bodyId = bodyStoryId(base);
  const headerId = 'st-header';
  const header: Story = { id: headerId, kind: 'header', blocks: [{ kind: 'paragraph', id: 'hp1', runs: [] }] };
  const stories = new Map(base.stories);
  stories.set(headerId, header);
  return { model: { ...base, stories }, bodyId, headerId };
}

describe('write scope resolution', () => {
  test('explicit body scope targets the body', () => {
    const { model, bodyId } = withHeader();
    expect(DocxEditor.resolveWriteScope(model, { kind: 'body' })).toEqual({ ok: true, storyId: bodyId });
  });

  test('an OMITTED scope targets the ACTIVE header, not the body', () => {
    const { model, headerId } = withHeader();
    // No scope -> active story is the header -> write goes to the header.
    expect(DocxEditor.resolveWriteScope(model, undefined, { activeStoryId: headerId })).toEqual({ ok: true, storyId: headerId });
  });

  test('an omitted scope with no active story is an error (never silent body)', () => {
    const { model } = withHeader();
    expect(DocxEditor.resolveWriteScope(model, undefined)).toMatchObject({ ok: false, reason: 'no-active-story' });
  });

  test('a specific related-story scope targets that story; unknown story fails', () => {
    const { model, headerId } = withHeader();
    expect(DocxEditor.resolveWriteScope(model, { kind: 'story', storyId: headerId })).toEqual({ ok: true, storyId: headerId });
    expect(DocxEditor.resolveWriteScope(model, { kind: 'story', storyId: 'nope' })).toMatchObject({ ok: false, reason: 'unknown-story' });
  });

  test('the aggregate scope is read-only and cannot be written', () => {
    const { model } = withHeader();
    expect(DocxEditor.resolveWriteScope(model, { kind: 'aggregate' })).toMatchObject({ ok: false, reason: 'aggregate-not-writable' });
  });
});

describe('read scope resolution', () => {
  test('aggregate spans every story; a single scope spans one', () => {
    const { model, bodyId, headerId } = withHeader();
    expect(DocxEditor.resolveReadScope(model, { kind: 'aggregate' }).sort()).toEqual([bodyId, headerId].sort());
    expect(DocxEditor.resolveReadScope(model, { kind: 'body' })).toEqual([bodyId]);
  });
});
