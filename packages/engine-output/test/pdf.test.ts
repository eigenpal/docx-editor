// Native PDF backend + semantic extraction (document-engine tasks 8.10, 8.11
// core; goal gate 10). Renders the DisplayItem[] IR to a real PDF and inspects it
// semantically (valid structure, page count matches layout).

import { describe, expect, test } from 'bun:test';
import { renderPdf, inspectPdf, extractReadingOrder } from '../src/index.ts';
import { layoutBody, DeterministicMetrics, type LayoutOptions } from '@docx-editor.dev/engine-layout';
import { createEmptyModel, bodyStoryId, DocumentStore, ORIGIN_IDS, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new DeterministicMetrics(), ...over };
}

function modelWith(paragraphs: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const p1 = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: paragraphs[0] }));
  for (let i = 1; i < paragraphs.length; i++) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0] : '';
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: paragraphs[i] }));
  }
  return store.currentModel;
}

describe('native PDF from the display list (gate 10)', () => {
  test('renders valid PDF bytes with one page per layout page', async () => {
    const layout = layoutBody(modelWith(['Hello world', 'second paragraph']), opts());
    const bytes = await renderPdf(layout);
    // Real PDF signature.
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    // Semantic inspection: reloads and page count matches the layout.
    const info = await inspectPdf(bytes);
    expect(info.valid).toBe(true);
    expect(info.pageCount).toBe(layout.pages.length);
  });

  test('multi-page content produces a multi-page PDF', async () => {
    const many = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const layout = layoutBody(modelWith(many), opts());
    const info = await inspectPdf(await renderPdf(layout));
    expect(info.pageCount).toBe(layout.pages.length);
    expect(info.pageCount).toBeGreaterThan(1);
  });

  test('is deterministic — same layout renders equal PDF bytes', async () => {
    const layout = layoutBody(modelWith(['deterministic output']), opts());
    const a = await renderPdf(layout);
    const b = await renderPdf(layout);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('semantic reading order (8.10)', () => {
  test('extracts logical text in display order', () => {
    const layout = layoutBody(modelWith(['the quick brown fox']), opts());
    expect(extractReadingOrder(layout)[0]).toBe('the quick brown fox');
  });
});
