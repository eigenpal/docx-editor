/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `getReviewItemsAt` and `getReviewItemRects`: a host that draws its own review chrome finds
// the item under a click, and the bands to anchor a balloon to, without reading painted DOM.
//
// Expected geometry comes from text-highlight marks over the same model range. Both read the
// same layout records, so a mark is the reference for where a review item's text paints.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { HighlightRect, ReviewItemPlacement } from '@docx-editor.dev/core/contracts/editor';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

function docx(body: string, comments: string, header?: string): Uint8Array {
  const rels =
    `<Relationship Id="rIdC" Type="${R}/comments" Target="comments.xml"/>` +
    (header ? `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` : '');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/comments.xml" ContentType="${WML}.comments+xml"/>` +
        (header ? `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>` : '') +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        (header ? `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>` : '') +
        `</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/comments.xml': strToU8(`<w:comments xmlns:w="${W}">${comments}</w:comments>`),
    ...(header ? { 'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`) } : {}),
  });
}

const comment = (id: number, text: string) =>
  `<w:comment w:id="${id}" w:author="Ada Lovelace" w:date="2026-03-04T05:06:07Z">` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;

/** Comment 7 wraps "Kept added", which holds the insertion "added"; " tail" is outside. */
const BODY =
  `<w:p><w:commentRangeStart w:id="7"/><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Grace Hopper" w:date="2026-01-02T03:04:05Z">` +
  `<w:r><w:t>added</w:t></w:r></w:ins><w:commentRangeEnd w:id="7"/>` +
  `<w:r><w:commentReference w:id="7"/></w:r>` +
  `<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>`;

const HEADER =
  `<w:p><w:commentRangeStart w:id="8"/><w:r><w:t>letterhead</w:t></w:r>` +
  `<w:commentRangeEnd w:id="8"/><w:r><w:commentReference w:id="8"/></w:r></w:p>`;

const ORIGIN = { left: 40, top: 30 };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(header?: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(BODY, comment(7, 'Check this.') + comment(8, 'Wrong mark.'), header),
    modules: [reviewModule()],
  });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  const layer = container.querySelector<HTMLElement>('.docx-text-highlight-overlay')!;
  layer.getBoundingClientRect = () =>
    ({ ...ORIGIN, x: ORIGIN.left, y: ORIGIN.top, right: 0, bottom: 0 }) as DOMRect;
  return editor;
}

/** A comment by its file id, or the insertion for `'insert'`. */
function placementOf(editor: DocxEditorInstance, id: string): ReviewItemPlacement {
  const found = editor
    .getReviewItems()
    .find((placement) => (id === 'insert' ? placement.kind === 'revision' : placement.id === id));
  if (!found) throw new Error(`no review item ${id}`);
  return found;
}

/** Client rectangles of a probe highlight over one model range. */
function probe(
  editor: DocxEditorInstance,
  blockId: string,
  start: number,
  length: number
): HighlightRect[] {
  expect(editor.setHighlights('probe', [{ blockId, start, length }]).applied).toBe(1);
  const marks = [
    ...document.querySelectorAll<HTMLElement>('[data-highlight-set="probe"] .docx-text-highlight'),
  ].map((mark) => {
    const left = ORIGIN.left + Number.parseFloat(mark.style.left);
    const top = ORIGIN.top + Number.parseFloat(mark.style.top);
    const width = Number.parseFloat(mark.style.width);
    const height = Number.parseFloat(mark.style.height);
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  });
  editor.clearHighlights('probe');
  expect(marks.length).toBeGreaterThan(0);
  return marks;
}

function expectRect(actual: HighlightRect, expected: HighlightRect): void {
  for (const key of Object.keys(expected) as (keyof HighlightRect)[]) {
    expect(actual[key]).toBeCloseTo(expected[key], 3);
  }
}

const ids = (hits: readonly { readonly placement: ReviewItemPlacement }[]) =>
  hits.map((hit) => hit.placement.id);

describe('getReviewItemsAt', () => {
  test('a point on an insertion inside a comment reports both, innermost first', () => {
    const editor = mount();
    const revision = placementOf(editor, 'insert');
    const range = revision.item.kind === 'revision' ? revision.item.ranges[0]! : null;
    const paragraphId = range!.start.paragraphId;
    const [band] = probe(editor, paragraphId, range!.start.offset, 5);
    const hits = editor.getReviewItemsAt(band!.left + band!.width / 2, band!.top + 1);
    expect(ids(hits)).toEqual([revision.id, '7']);
    expect(hits[0]!.placement).toEqual(revision);
    expectRect(hits[0]!.rect, band!);
    // The comment's band on this line covers all of "Kept added".
    expectRect(hits[1]!.rect, probe(editor, paragraphId, 0, 10)[0]!);
  });

  test('the right half of the last character hits; the next character does not', () => {
    const editor = mount();
    const commentRange = placementOf(editor, '7').item;
    const range = commentRange.kind === 'comment' ? commentRange.range! : null;
    const paragraphId = range!.start.paragraphId;
    const end = range!.end.offset;
    const [last] = probe(editor, paragraphId, end - 1, 1);
    const [next] = probe(editor, paragraphId, end, 1);
    const y = last!.top + 1;
    expect(ids(editor.getReviewItemsAt(last!.left + last!.width * 0.9, y))).toContain('7');
    expect(ids(editor.getReviewItemsAt(next!.left + next!.width * 0.1, y))).toEqual([]);
  });

  test('misses and coordinates that are not finite return nothing', () => {
    const editor = mount();
    expect(editor.getReviewItemsAt(ORIGIN.left - 5, ORIGIN.top - 5)).toEqual([]);
    expect(editor.getReviewItemsAt(Number.NaN, 100)).toEqual([]);
    expect(editor.getReviewItemsAt(100, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  test('a query filters the hits the way it filters getReviewItems', () => {
    const editor = mount();
    const revision = placementOf(editor, 'insert');
    const range = revision.item.kind === 'revision' ? revision.item.ranges[0]! : null;
    const [band] = probe(editor, range!.start.paragraphId, range!.start.offset, 5);
    const x = band!.left + 1;
    const y = band!.top + 1;
    expect(ids(editor.getReviewItemsAt(x, y, { excludeRevisionKinds: ['insert'] }))).toEqual(['7']);
    const bare = editor.getReviewItemsAt(x, y, { placement: false });
    expect(bare.map((hit) => hit.placement.anchorY)).toEqual([null, null]);
  });

  test('a comment in a header hits', () => {
    const editor = mount(HEADER);
    const placement = placementOf(editor, '8');
    const range = placement.item.kind === 'comment' ? placement.item.range! : null;
    const [band] = probe(editor, range!.start.paragraphId, 0, 10);
    const hits = editor.getReviewItemsAt(band!.right - 0.5, band!.top + 1);
    expect(ids(hits)).toEqual(['8']);
    expectRect(hits[0]!.rect, band!);
  });
});

describe('getReviewItemRects', () => {
  test('returns the bands of one item, and nothing for an unknown key', () => {
    const editor = mount();
    const placement = placementOf(editor, '7');
    const range = placement.item.kind === 'comment' ? placement.item.range! : null;
    const expected = probe(editor, range!.start.paragraphId, 0, 10);
    const rects = editor.getReviewItemRects(placement.key);
    expect(rects).toHaveLength(expected.length);
    rects.forEach((rect, at) => expectRect(rect, expected[at]!));
    expect(editor.getReviewItemRects('comment-missing')).toEqual([]);
    expect(editor.getReviewItemRects('')).toEqual([]);
  });
});

describe('after a document change', () => {
  /**
   * Split the paragraph at its start and paint, then undo straight on the session. The
   * painted frame still shows the text one line lower; the model has it back on line one.
   */
  function changeWithoutRepaint(editor: DocxEditorInstance, paragraphId: string): void {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    editor.surface!.splitParagraph();
    expect(editor.getReviewItemRects(placementOf(editor, 'insert').key)).toHaveLength(1);
    editor.surface!.session.undo();
    expect(editor.surface!.publishedLayout().revision).not.toBe(
      editor.surface!.session.packageRevision()
    );
  }

  function insertion(editor: DocxEditorInstance): { key: string; paragraphId: string } {
    const placement = placementOf(editor, 'insert');
    const range = placement.item.kind === 'revision' ? placement.item.ranges[0]! : null;
    return { key: placement.key, paragraphId: range!.start.paragraphId };
  }

  test('rects describe the current text, not the last painted frame', () => {
    const editor = mount();
    const { key, paragraphId } = insertion(editor);
    const [band] = probe(editor, paragraphId, 5, 5);
    changeWithoutRepaint(editor, paragraphId);
    const rects = editor.getReviewItemRects(key);
    expect(rects).toHaveLength(1);
    expectRect(rects[0]!, band!);
  });

  test('a hit test reads the current text, not the last painted frame', () => {
    const editor = mount();
    const { key, paragraphId } = insertion(editor);
    const [band] = probe(editor, paragraphId, 5, 5);
    changeWithoutRepaint(editor, paragraphId);
    const hits = editor.getReviewItemsAt(band!.left + band!.width / 2, band!.top + 1);
    expect(hits.map((hit) => hit.placement.key)).toContain(key);
    expectRect(hits[0]!.rect, band!);
  });
});
