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

/**
 * `PAGES` pages. Page `n` holds paragraph `2n` (plain text) and paragraph `2n + 1` (a tracked
 * insertion), so the cards sit about one page apart and a scroll changes which ones mount.
 */
export function pagedTrackedDocument(): Uint8Array {
  let body = '';
  for (let page = 0; page < PAGES; page += 1) {
    body +=
      `<w:p>${page > 0 ? '<w:r><w:br w:type="page"/></w:r>' : ''}` +
      `<w:r><w:t>plain ${page}</w:t></w:r></w:p>` +
      '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
      `<w:ins w:id="${page + 1}" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">` +
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
