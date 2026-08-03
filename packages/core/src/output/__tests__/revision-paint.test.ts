// Tracked changes as the reader sees them.
//
// Reaching layout was the correctness fix; this is the part that makes the difference visible.
// A reviewer looking at a document where an insertion and a deletion both render as plain text
// is reading a third document that exists nowhere — which is the same failure as dropping the
// content, one step later.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { authorSlotsOf, revisionPresentationOf } from '../revision-presentation.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: string, inner: string, author = 'QA') =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;
const del = (id: string, inner: string, author = 'Dev') =>
  `<w:del w:id="${id}" w:author="${author}" w:date="2026-03-26T11:00:00Z">${inner}</w:del>`;

function paint(body: string): HTMLElement {
  const layout = layoutSemanticDocument(load(body), 1, { measurer });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false });
  return container;
}

function trackedSpans(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.docx-revision')];
}

describe('the reader can see which text is tracked', () => {
  test('an insertion is underlined, dashed so it cannot be read as authored w:u', () => {
    const root = paint(`<w:p>${run('keep ')}${ins('1', run('added'))}</w:p>`);
    const spans = trackedSpans(root);
    expect(spans.length).toBeGreaterThan(0);
    const span = spans[0]!;
    expect(span.textContent).toBe('added');
    expect(span.style.textDecorationLine).toBe('underline');
    expect(span.style.textDecorationStyle).toBe('dashed');
    expect(span.style.color).toBe('var(--doc-revision-insertion)');
  });

  test('a deletion is struck through', () => {
    const root = paint(`<w:p>${run('keep ')}${del('2', delRun('gone'))}</w:p>`);
    const span = trackedSpans(root)[0]!;
    expect(span.textContent).toBe('gone');
    expect(span.style.textDecorationLine).toBe('line-through');
  });

  test('untracked text carries no revision styling at all', () => {
    const root = paint(`<w:p>${run('plain text')}</w:p>`);
    expect(trackedSpans(root)).toHaveLength(0);
  });

  test('a move reads apart from an ordinary delete/insert pair', () => {
    // Both halves of a move are one decision. Drawing them as a plain deletion and insertion
    // invites resolving one without the other, which duplicates or loses the content.
    const root = paint(
      '<w:p><w:moveFrom w:id="1" w:author="QA" w:date="D">' +
        `${delRun('here')}</w:moveFrom>` +
        '<w:moveTo w:id="2" w:author="QA" w:date="D">' +
        `${run('there')}</w:moveTo></w:p>`
    );
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.textDecorationStyle)).toEqual(['double', 'double']);
    expect(spans.map((span) => span.dataset.revisionKind)).toEqual(['moveFrom', 'moveTo']);
  });

  test('an insertion and a deletion are the two colours a reader tells apart', () => {
    // Kind, not author: scanning a page, "added" versus "removed" is the distinction that has
    // to survive a glance. Who made the change is the review card's question.
    const root = paint(`<w:p>${ins('1', run('added'))}${del('2', delRun('gone'))}</w:p>`);
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.color)).toEqual([
      'var(--doc-revision-insertion)',
      'var(--doc-revision-deletion)',
    ]);
  });

  test('two authors still get distinct slots for a surface that colours by person', () => {
    const layout = layoutSemanticDocument(
      load(`<w:p>${ins('1', run('mine'), 'Ada')}${ins('2', run('theirs'), 'Grace')}</w:p>`),
      1,
      { measurer }
    );
    const slots = authorSlotsOf(layout);
    expect(slots.get('Ada')).not.toBe(slots.get('Grace'));
  });

  test('the same author is the same colour wherever they appear', () => {
    // One slot map for the whole document, so an author does not change colour between pages
    // or between an incremental repaint and a full one.
    const layout = layoutSemanticDocument(
      load(
        `<w:p>${ins('1', run('first'), 'Ada')}</w:p>` +
          `<w:p>${ins('2', run('second'), 'Grace')}</w:p>` +
          `<w:p>${ins('3', run('third'), 'Ada')}</w:p>`
      ),
      1,
      { measurer }
    );
    const slots = authorSlotsOf(layout);
    // Assigned in order of first appearance, which is Word's rule and cannot collide until
    // there are more authors than slots.
    expect(slots.get('Ada')).toBe(0);
    expect(slots.get('Grace')).toBe(1);
  });

  test('a deletion nested in an insertion still reads as removed', () => {
    const presentation = revisionPresentationOf([
      { kind: 'insert', id: '1', author: 'A', nodeId: 'a' },
      { kind: 'delete', id: '2', author: 'B', nodeId: 'b' },
    ]);
    expect(presentation?.line).toBe('line-through');
    expect(presentation?.deleted).toBe(true);
    // The innermost author owns the card and the colour: it is their pending decision.
    expect(presentation?.attribution.author).toBe('B');
  });

  test('the span carries its provenance for the review surface to join on', () => {
    const root = paint(`<w:p>${ins('7', run('added'), 'QA Reviewer')}</w:p>`);
    const span = trackedSpans(root)[0]!;
    expect(span.dataset.revisionId).toBe('7');
    expect(span.dataset.revisionAuthor).toBe('QA Reviewer');
    expect(span.dataset.revisionDate).toBe('2026-03-26T11:00:00Z');
  });
});

describe('change bars', () => {
  test('a line carrying a revision gets a margin rule', () => {
    const root = paint(`<w:p>${run('before ')}${ins('1', run('added'))}</w:p>`);
    expect(root.querySelectorAll('.docx-change-bar')).toHaveLength(1);
  });

  test('contiguous tracked lines merge into ONE rule, not one per line', () => {
    // Drawn per line, a multi-line edit reads as a dashed rule with a gap at every line
    // boundary, implying the change stops and restarts.
    const long = 'word '.repeat(60);
    const root = paint(`<w:p>${ins('1', run(long))}</w:p>`);
    const lines = root.querySelectorAll('.layout-line').length;
    expect(lines).toBeGreaterThan(1);
    expect(root.querySelectorAll('.docx-change-bar')).toHaveLength(1);
  });

  test('the rule says what happened, not just that something did', () => {
    const inserted = paint(`<w:p>${ins('1', run('added'))}</w:p>`);
    const deleted = paint(`<w:p>${del('2', delRun('gone'))}</w:p>`);
    expect(inserted.querySelector<HTMLElement>('.docx-change-bar')!.className).toContain(
      'insertion'
    );
    expect(deleted.querySelector<HTMLElement>('.docx-change-bar')!.className).toContain('deletion');
  });

  test('a clean line gets none', () => {
    const root = paint(`<w:p>${run('nothing tracked here')}</w:p>`);
    expect(root.querySelectorAll('.docx-change-bar')).toHaveLength(0);
  });

  test('the bar is furniture: no model range, hidden from assistive tech, not editable', () => {
    const root = paint(`<w:p>${ins('1', run('added'))}</w:p>`);
    const overlay = root.querySelector<HTMLElement>('.docx-change-bars')!;
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.style.pointerEvents).toBe('none');
    const bar = root.querySelector<HTMLElement>('.docx-change-bar')!;
    expect(bar.dataset.paragraphId).toBeUndefined();
    expect(bar.textContent).toBe('');
  });
});

describe('changes that decorate no characters', () => {
  const mark = (kind: 'ins' | 'del', text: string) =>
    `<w:p><w:pPr><w:rPr><w:${kind} w:id="9" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
    `${run(text)}</w:p>`;

  test('a deleted paragraph mark draws a struck pilcrow', () => {
    // The change is to the paragraph BREAK, so no character carries it. Without the glyph a
    // reader has no way to see that this paragraph is being merged into the next one.
    const root = paint(mark('del', 'merges forward'));
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.textContent).toBe('¶');
    expect(glyph.style.textDecorationLine).toBe('line-through');
    expect(glyph.style.color).toBe('var(--doc-revision-deletion)');
  });

  test('an inserted paragraph mark draws one in the insertion colour', () => {
    const root = paint(mark('ins', 'splits here'));
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.style.color).toBe('var(--doc-revision-insertion)');
    expect(glyph.style.textDecorationLine).toBe('');
  });

  test('a clean paragraph draws none', () => {
    expect(
      paint(`<w:p>${run('untouched')}</w:p>`).querySelectorAll('.docx-revision-pmark')
    ).toHaveLength(0);
  });

  test('the pilcrow is furniture, not text', () => {
    const glyph = paint(mark('del', 'x')).querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyph.contentEditable).toBe('false');
    expect(glyph.dataset.paragraphId).toBeUndefined();
  });

  test('a tracked format change carries its provenance and NO inline mark', () => {
    // At the density real documents reach — 18,284 in the main tracked fixture — a rule under
    // every reformatted run draws a dotted line beneath nearly every line on the page, and it
    // competes with the insertions and deletions that are the decisions a reviewer must make.
    // The attributes stay so the review surface can list it and highlight its range on demand,
    // which is where Word puts it too: a "Formatted:" note rather than a mark on the words.
    const root = paint(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="QA" w:date="D">` +
        `<w:rPr/></w:rPrChange></w:rPr><w:t>reformatted</w:t></w:r></w:p>`
    );
    const span = root.querySelector<HTMLElement>('.docx-revision-format')!;
    expect(span.textContent).toBe('reformatted');
    expect(span.style.textDecorationLine).toBe('');
    expect(span.style.backgroundColor).toBe('');
    expect(span.dataset.revisionKind).toBe('format');
    expect(span.dataset.revisionAuthor).toBe('QA');
  });
});

describe('tracked text is findable when scanning, not only when reading', () => {
  test('an insertion and a deletion each carry a tint', () => {
    // A hairline decoration disappears on a dense page of small type, and a reviewer skims
    // straight past the edit.
    const root = paint(`<w:p>${ins('1', run('added'))}${del('2', delRun('gone'))}</w:p>`);
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.backgroundColor)).toEqual([
      'var(--doc-revision-insertion-tint)',
      'var(--doc-revision-deletion-tint)',
    ]);
  });

  test('untracked text keeps no background of its own', () => {
    const root = paint(`<w:p>${run('plain')}</w:p>`);
    const spans = [...root.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(spans.every((span) => span.style.backgroundColor === '')).toBe(true);
  });
});

describe('change bars line up regardless of indentation', () => {
  test('an indented paragraph puts its bar on the same vertical line as a flush one', () => {
    // A bar offset from the paragraph's own box lands at a different x for every indent
    // level, so a nested list draws a staircase instead of a column.
    const indented =
      `<w:p>${ins('1', run('flush'))}</w:p>` +
      `<w:p><w:pPr><w:ind w:left="1440"/></w:pPr>${ins('2', run('indented'))}</w:p>`;
    const root = paint(indented);
    const bars = [...root.querySelectorAll<HTMLElement>('.docx-change-bar')];
    expect(bars).toHaveLength(2);
    // Both resolve to the same page-relative x once each fragment's own origin is added back.
    const positions = bars.map((bar) => {
      const fragment = bar.closest<HTMLElement>('.docx-paragraph-fragment')!;
      return Math.round(parseFloat(bar.style.left) + parseFloat(fragment.style.left || '0'));
    });
    expect(positions[0]).toBe(positions[1]!);
  });
});
