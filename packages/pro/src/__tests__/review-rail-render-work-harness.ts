/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Shared by review-rail-render-work.test.tsx and its Vue twin: a document with one tracked
// change on each page, a scroller the rail can measure, and the scroll and typing steps.

import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** How many pages the document has. Each holds a plain paragraph and a tracked insertion. */
export const PAGES = 12;

/** The visible height the scroller reports, in CSS pixels. */
export const VIEW_HEIGHT = 800;

/** The author of every tracked change, unless a test names another for a page. */
export const AUTHOR = 'Ada Lovelace';

/**
 * `PAGES` pages. Page `n` holds paragraph `2n` (plain text) and paragraph `2n + 1` (a tracked
 * insertion), so the cards sit about one page apart and a scroll changes which ones mount.
 * `authorOf` names the author of the insertion on a page.
 */
export function pagedTrackedDocument(
  authorOf: (page: number) => string = () => AUTHOR
): Uint8Array {
  let body = '';
  for (let page = 0; page < PAGES; page += 1) {
    body +=
      `<w:p>${page > 0 ? '<w:r><w:br w:type="page"/></w:r>' : ''}` +
      `<w:r><w:t>plain ${page}</w:t></w:r></w:p>` +
      '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
      `<w:ins w:id="${page + 1}" w:author="${authorOf(page)}" w:date="2026-01-01T00:00:00Z">` +
      `<w:r><w:t>added ${page}</w:t></w:r></w:ins></w:p>`;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** happy-dom lays nothing out: give every element the scroller's visible height. */
export function installViewHeight(): () => void {
  const proto = HTMLElement.prototype;
  const saved = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => VIEW_HEIGHT });
  return () => {
    if (saved) Object.defineProperty(proto, 'clientHeight', saved);
    else delete (proto as unknown as Record<string, unknown>).clientHeight;
  };
}

/** The scroll container the rail measures. */
export function scrollerOf(container: Element): HTMLElement {
  return container.querySelector<HTMLElement>('.docx-editor__scroll-container')!;
}

/** Move the scroller to `top` and report it, as a wheel tick does. */
export function scrollTo(scroller: HTMLElement, top: number): void {
  scroller.scrollTop = top;
  scroller.dispatchEvent(new Event('scroll'));
}

/** The keys of the cards the rail has mounted, in document order. */
export function mountedCards(container: Element): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-card-key]')].map(
    (card) => card.dataset.cardKey!
  );
}

/** The offset of a caret inside the tracked insertion of a paragraph that holds one. */
export const INSIDE_INSERTION = 7;

/**
 * Put the caret in paragraph `index` at `offset` and type one character there. Answers the
 * number of document changes the editor reported, so a test can tell the key landed.
 */
export function typeIn(editor: DocxEditorInstance, index: number, offset = 0): number {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  const at = { paragraphId, offset };
  let changes = 0;
  const stop = editor.on('change', () => {
    changes += 1;
  });
  editor.surface!.setSelection({ anchor: at, head: at });
  editor.surface!.type('x');
  stop();
  return changes;
}

/**
 * Make the editor report the item `key` without a placement, as it does for an item whose
 * page has no layout yet. Answers the function that restores the editor's own read.
 */
export function unplaceItem(editor: DocxEditorInstance, key: string): () => void {
  const read = editor.getReviewItems;
  editor.getReviewItems = (query) =>
    read
      .call(editor, query)
      .map((entry) => (entry.key === key ? { ...entry, anchorY: null, pageIndex: null } : entry));
  return () => {
    editor.getReviewItems = read;
  };
}

/** The `top` of the compact rail's floating card, in CSS pixels, or null when none shows. */
export function compactCardTop(container: Element): number | null {
  const card = container.querySelector<HTMLElement>('[data-testid="review-compact-card"]');
  return card ? Number.parseFloat(card.style.top) : null;
}

/** Render counts by card key, since the last `reset`. */
export function counter() {
  const counts = new Map<string, number>();
  return {
    add: (key: string) => void counts.set(key, (counts.get(key) ?? 0) + 1),
    of: (key: string) => counts.get(key) ?? 0,
    total: () => [...counts.values()].reduce((sum, count) => sum + count, 0),
    keys: () => [...counts.keys()],
    reset: () => counts.clear(),
  };
}

export type Counter = ReturnType<typeof counter>;

/** The packaged card element of the item `key`, inside the wrapper a test's template draws. */
export function cardOf(container: Element, key: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-card-key="${key}"] [data-testid="review-card"]`
  );
}

/** The authors the mounted packaged cards name, each once, in the order of the cards. */
export function authorsOf(container: Element): string[] {
  const authors = [...container.querySelectorAll<HTMLElement>('[data-testid="review-card"]')].map(
    (card) => card.dataset.reviewAuthor ?? ''
  );
  return [...new Set(authors)];
}

/**
 * Select the first `length` characters of paragraph `index` and comment on them as `author`.
 * Answers the key of the new comment.
 */
export function commentOn(
  editor: DocxEditorInstance,
  index: number,
  text: string,
  author: string = AUTHOR,
  length = 5
): string {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: length },
  });
  const known = new Set(editor.getReviewItems().map((entry) => entry.key));
  const result = editor.addComment(text, author);
  if (!result.ok) throw new Error(`the comment was refused: ${JSON.stringify(result)}`);
  return editor.getReviewItems().find((entry) => !known.has(entry.key))!.key;
}
