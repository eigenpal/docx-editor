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
  test('an insertion is underlined in its author colour', () => {
    const root = paint(`<w:p>${run('keep ')}${ins('1', run('added'))}</w:p>`);
    const spans = trackedSpans(root);
    expect(spans.length).toBeGreaterThan(0);
    const span = spans[0]!;
    expect(span.textContent).toBe('added');
    expect(span.style.textDecorationLine).toBe('underline');
    expect(span.style.color).toContain('--doc-review-author-');
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

  test('two authors get different colours', () => {
    const root = paint(
      `<w:p>${ins('1', run('mine'), 'Ada')}${ins('2', run('theirs'), 'Grace')}</w:p>`
    );
    const spans = trackedSpans(root);
    // The collision this guards against is not hypothetical: 'Ada' and 'Grace' hash to the
    // same slot in an eight-slot ramp, which is why the mapping is order-based.
    expect(spans[0]!.style.color).not.toBe(spans[1]!.style.color);
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

  test('a clean line gets none', () => {
    const root = paint(`<w:p>${run('nothing tracked here')}</w:p>`);
    expect(root.querySelectorAll('.docx-change-bar')).toHaveLength(0);
  });

  test('the bar is furniture: no model range, hidden from assistive tech, not editable', () => {
    const root = paint(`<w:p>${ins('1', run('added'))}</w:p>`);
    const bar = root.querySelector<HTMLElement>('.docx-change-bar')!;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.contentEditable).toBe('false');
    expect(bar.dataset.paragraphId).toBeUndefined();
    expect(bar.textContent).toBe('');
  });
});
