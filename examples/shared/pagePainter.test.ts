// Incremental paginated painter (item 7). Proves createPagePainter re-lays-out the model but
// patches ONLY the pages whose display items changed — an edit far down the document reuses the
// DOM of every unchanged page instead of tearing down and rebuilding the whole paged view.

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  insertParagraph,
  setParagraphRuns,
  type PackageModel,
} from '@docx-editor.dev/core-contract/store';
import { createDeterministicLayoutShaping } from '@docx-editor.dev/core-contract/layout';
import { createPagePainter } from './enginePreview.ts';

const options = {
  shaping: createDeterministicLayoutShaping(),
  installedFonts: { aliasFor: () => 'DocxFont_page_painter_test' },
};

// Minimal DOM stand-in: the painter + renderPageElement only use createElement / style /
// setAttribute / textContent / appendChild / replaceChild / removeChild / children / lastChild.
class El {
  style: Record<string, string> = {};
  children: El[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: El) {
    this.children.push(c);
    return c;
  }
  replaceChild(next: El, old: El) {
    const i = this.children.indexOf(old);
    if (i >= 0) this.children[i] = next;
    return old;
  }
  removeChild(c: El) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  get lastChild(): El | null {
    return this.children[this.children.length - 1] ?? null;
  }
}
const mockDoc = { createElement: (t: string) => new El(t) } as unknown as Document;

/** A model with `n` filler paragraphs (long enough that the body spans several pages). */
function manyParagraphs(n: number): { model: PackageModel; storyId: string; lastId: string } {
  let model = createEmptyModel();
  const storyId = bodyStoryId(model);
  for (let i = 0; i < n; i += 1) {
    const text = `Paragraph number ${String(i).padStart(3, '0')} with enough words to fill the line width here.`;
    model = insertParagraph(model, storyId, i, [{ text }]).model;
  }
  const lastId = model.stories.get(storyId)!.blocks[n - 1].id;
  return { model, storyId, lastId };
}

describe('createPagePainter: incremental page patching', () => {
  test('an edit on the last page reuses every unchanged page element', () => {
    const { model, lastId } = manyParagraphs(120);
    const container = new El('div');
    const painter = createPagePainter(container, mockDoc, options);

    const first = painter.paint(model);
    expect(first.pageCount).toBeGreaterThan(1); // genuinely multi-page
    const pageEls = [...container.children];
    const lastIdx = pageEls.length - 1;

    // Change ONLY the last paragraph, keeping its length so pagination does not shift.
    const edited = setParagraphRuns(model, lastId, [
      { text: 'Paragraph number 119 with enough words to fill the line width HERE!' },
    ]);
    const second = painter.paint(edited);
    expect(second.pageCount).toBe(first.pageCount); // page count stable

    // Every page before the last keeps its exact DOM element (reused, not rebuilt)...
    for (let i = 0; i < lastIdx; i += 1) expect(container.children[i]).toBe(pageEls[i]);
    // ...and only the changed last page was replaced.
    expect(container.children[lastIdx]).not.toBe(pageEls[lastIdx]);
  });

  test('a no-op repaint reuses ALL page elements', () => {
    const { model } = manyParagraphs(80);
    const container = new El('div');
    const painter = createPagePainter(container, mockDoc, options);
    painter.paint(model);
    const pageEls = [...container.children];
    painter.paint(model); // identical model
    for (let i = 0; i < pageEls.length; i += 1) expect(container.children[i]).toBe(pageEls[i]);
  });

  test('a shorter document removes trailing page elements', () => {
    const big = manyParagraphs(120).model;
    const small = manyParagraphs(8).model;
    const container = new El('div');
    const painter = createPagePainter(container, mockDoc, options);

    const before = painter.paint(big).pageCount;
    const after = painter.paint(small); // same painter, fewer pages
    expect(after.pageCount).toBeLessThan(before);
    expect(container.children.length).toBe(after.pageCount); // trailing pages dropped, none stale
  });
});
