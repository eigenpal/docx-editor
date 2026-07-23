// DOCX parse -> edit -> save -> reopen fidelity (document-engine tasks 2.3, 3.6,
// 3.7; goal gate 5) plus malicious ZIP/XML rejection. Exercises fflate + the
// bounded XML reader against a created model AND a real fixture.

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parseDocx, writeDocx, readZip, DocxEditor } from '../src/index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '../src/index.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

/** Normalized body content for comparison (ids differ across a round-trip). */
function bodyContent(model: PackageModel): { runs: unknown[] }[] {
  const story = model.stories.get(bodyStoryId(model))!;
  return story.blocks.map((b) => ({ runs: (b as ParagraphRecord).runs as unknown[] }));
}

describe('create -> edit -> save -> reopen fidelity (gate 5)', () => {
  test('a created + edited model round-trips through DOCX bytes', () => {
    // Build a model with two paragraphs, one with a bold run.
    const model0 = createEmptyModel();
    const storyId = bodyStoryId(model0);
    const p1 = (model0.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    const store = new DocumentStore(model0);
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'Hello ' }));
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'bold', props: { bold: true } }));
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const p2 = r.ok ? r.modelChange.created[0] : '';
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'second para' }));

    const bytes = writeDocx(store.currentModel);
    expect(bytes.length).toBeGreaterThan(0);

    const reopened = parseDocx(bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    // Authored body content is equivalent after reopen (text + props preserved).
    expect(bodyContent(reopened.model)).toEqual(bodyContent(store.currentModel));
  });

  test('DocxEditor edits then writeDocx/parseDocx preserve text', () => {
    const doc = DocxEditor.create();
    let pid = '';
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('round trip me');
      ctx.sync();
      pid = p.id;
    });
    // Reach the underlying model via a query, then save/reopen.
    const saved = writeDocx((doc as unknown as { internalStore: DocumentStore }).internalStore.currentModel);
    const reopened = parseDocx(saved);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      // insertParagraph appends after the initial empty paragraph; join all body text.
      const text = reopened.model.stories
        .get(bodyStoryId(reopened.model))!
        .blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))
        .join('');
      expect(text).toBe('round trip me');
    }
    expect(pid).toBeTruthy();
  });
});

describe('reads a real DOCX fixture', () => {
  const fixture = join(import.meta.dir, '..', '..', '..', 'e2e', 'fixtures', 'complex-styles.docx');
  test.if(existsSync(fixture))('parses a real fixture into a body story', () => {
    const bytes = new Uint8Array(readFileSync(fixture));
    const result = parseDocx(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const body = result.model.stories.get(bodyStoryId(result.model));
      expect(body).toBeDefined();
      expect(body!.blocks.length).toBeGreaterThan(0);
    }
  });
});

describe('malicious ZIP/XML rejection', () => {
  test('a zip entry with path traversal is rejected before use', () => {
    const evil = zipSync({ 'word/../../../etc/passwd': strToU8('x') });
    expect(readZip(evil)).toMatchObject({ ok: false, reason: 'bad-name' });
  });

  test('a DOCX whose document.xml declares a DTD is refused', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<!DOCTYPE w:document [ <!ENTITY x "y"> ]><w:document><w:body/></w:document>'),
    });
    expect(parseDocx(bytes)).toMatchObject({ ok: false, reason: 'xml-error' });
  });
});
