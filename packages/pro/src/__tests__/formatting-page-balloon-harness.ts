/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect } from 'bun:test';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  applySelectionToDom,
  semanticSelectionFromDom,
} from '../../../core/src/editor/dom-selection.ts';
import { strToU8, zipSync } from 'fflate';
function docx(body: string): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}
export const source = docx(
  '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="9" w:author="Ada"><w:rPr/></w:rPrChange>' +
    '</w:rPr><w:t>Run format</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="9" w:author="Ada"><w:pPr/>' +
    '</w:pPrChange></w:pPr><w:r><w:t>Paragraph format</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:rPr><w:lang w:val="sv-SE"/><w:rPrChange w:id="10" w:author="Ada">' +
    '<w:rPr/></w:rPrChange></w:rPr></w:pPr></w:p>'
);
export const navigationSource = docx(
  '<w:p><w:r><w:rPr>' +
    '<w:rPrChange w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z"><w:b/></w:rPrChange>' +
    '<w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>' +
    '<w:ins w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t>added text</w:t></w:r></w:ins></w:p>'
);

export async function checkFormattingPageBalloons(
  container: HTMLElement,
  editor: DocxEditorInstance,
  change: (run: () => void) => Promise<void>
): Promise<void> {
  expect(container.querySelectorAll('[data-testid="review-card"]')).toHaveLength(0);
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(0);
  await change(() => editor.surface!.setRevisionDisplayMode('proposed'));
  expect(container.querySelector('[data-revision-kind="format"]')).toBeNull();
  await change(() => editor.surface!.setRevisionDisplayMode('all-markup'));
  const paragraph = container.querySelector('[data-formatting-kind="pPrChange"]')!;
  expect(paragraph).not.toBeNull();
  await change(() => paragraph.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(container.querySelector('[data-testid="review-balloon-card"]')?.textContent).toContain(
    'Centered'
  );
  const clickedParagraphId = editor.surface!.session.paragraphIds()[1]!;
  await change(() =>
    editor.surface!.setSelection({
      anchor: { paragraphId: clickedParagraphId, offset: 1 },
      head: { paragraphId: clickedParagraphId, offset: 1 },
    })
  );
  expect(container.querySelector('[data-testid="review-balloon-card"]')?.textContent).toContain(
    'Centered'
  );
  const revisionBeforeViewChange = editor.getDocumentHandle().revision;
  await change(() => {
    editor.exec({ type: 'setReviewDisplayMode', mode: 'proposed' });
  });
  expect(container.querySelector('[data-testid="review-balloon"]')).toBeNull();
  expect(editor.getDocumentHandle().revision).toBe(revisionBeforeViewChange);
  await change(() => {
    editor.exec({ type: 'setReviewDisplayMode', mode: 'all-markup' });
  });
  expect(container.querySelector('[data-testid="review-balloon"]')).toBeNull();
  await change(() =>
    container
      .querySelector('[data-formatting-kind="pPrChange"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  );
  await change(() =>
    (
      container.querySelector(
        '[data-testid="review-balloon"] [data-testid="review-accept"]'
      ) as HTMLElement
    ).click()
  );
  const remaining = editor
    .getReviewItems({ placement: false })
    .filter((item) => item.kind === 'revision');
  expect(remaining).toHaveLength(2);
  expect(
    remaining.every(
      (item) => item.item.kind === 'revision' && item.item.formattingKind === 'rPrChange'
    )
  ).toBe(true);

  const empty = container.querySelector('.docx-paragraph-fragment[data-revision-id="10"]')!;
  expect(empty).not.toBeNull();
  expect(empty.hasAttribute('data-start')).toBe(false);
  expect(empty.hasAttribute('data-end')).toBe(false);
  const point = { paragraphId: (empty as HTMLElement).dataset.paragraphId!, offset: 0 };
  const selection = { anchor: point, head: point };
  expect(applySelectionToDom(container, selection, document.getSelection())).toBe(true);
  expect(semanticSelectionFromDom(container, document.getSelection())).toEqual(selection);
  await change(() => empty.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(container.querySelector('[data-testid="review-balloon-card"]')?.textContent).toContain(
    'Swedish'
  );
  expect(container.querySelectorAll('[data-testid="review-card"]')).toHaveLength(0);
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(0);
  await change(() => editor.surface!.setRevisionDisplayMode('proposed'));
  expect(container.querySelector('[data-testid="review-balloon"]')).toBeNull();
  await change(() => editor.surface!.setRevisionDisplayMode('all-markup'));
  expect(container.querySelector('[data-testid="review-balloon"]')).toBeNull();
  await change(() =>
    container
      .querySelector('.docx-paragraph-fragment[data-revision-id="10"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  );
  await change(() =>
    (
      container.querySelector(
        '[data-testid="review-balloon"] [data-testid="review-reject"]'
      ) as HTMLElement
    ).click()
  );
  expect(editor.getReviewItems({ placement: false })).toHaveLength(1);
}
