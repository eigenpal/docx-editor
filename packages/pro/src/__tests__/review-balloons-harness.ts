/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Shared checks for the `revisionsIn` and `commentMarkers` viewer preferences. Each adapter
// test mounts the rail and hands in a `change` wrapper that settles its own render cycle.

import { expect } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const EXTENDED_REL = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const DATE = 'w:date="2026-01-02T03:04:05Z"';

function comment(id: string, author: string, paraId: string, text: string): string {
  return (
    `<w:comment w:id="${id}" w:author="${author}" ${DATE}>` +
    `<w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`
  );
}

function commented(id: string, text: string): string {
  return (
    `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r>` +
    `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`
  );
}

/**
 * One open thread with a reply, one resolved thread, one insertion, and a deletion directly
 * followed by an insertion from the same author (a replacement).
 */
export const BALLOON_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      commented('7', 'Open thread') +
      `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
      `<w:ins w:id="1" w:author="Ada Lovelace" ${DATE}><w:r><w:t>added</w:t></w:r></w:ins></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Say </w:t></w:r>` +
      `<w:del w:id="2" w:author="Grace Hopper" ${DATE}><w:r><w:delText>old</w:delText></w:r></w:del>` +
      `<w:ins w:id="3" w:author="Grace Hopper" ${DATE}><w:r><w:t>new</w:t></w:r></w:ins></w:p>` +
      commented('9', 'Closed thread') +
      '</w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">` +
      comment('7', 'Ada Lovelace', 'A0000001', 'Check this.') +
      comment('8', 'Grace Hopper', 'A0000002', 'Agreed.') +
      comment('9', 'Grace Hopper', 'A0000003', 'Done.') +
      '</w:comments>'
  ),
  'word/commentsExtended.xml': strToU8(
    `<w15:commentsEx xmlns:w15="${W15}">` +
      '<w15:commentEx w15:paraId="A0000001" w15:done="0"/>' +
      '<w15:commentEx w15:paraId="A0000002" w15:paraIdParent="A0000001" w15:done="0"/>' +
      '<w15:commentEx w15:paraId="A0000003" w15:done="1"/>' +
      '</w15:commentsEx>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `<Relationship Id="rIdE" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
      '</Relationships>'
  ),
});

/** A paragraph and a table whose second row is a tracked row insertion. */
export const ROW_SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:t>Intro</w:t></w:r></w:p>' +
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Kept row</w:t></w:r></w:p></w:tc></w:tr>' +
      `<w:tr><w:trPr><w:ins w:id="40" w:author="Ada Lovelace" ${DATE}/></w:trPr>` +
      '<w:tc><w:p><w:r><w:t>Added row</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl><w:p/></w:body></w:document>'
  ),
});

type Change = (run: () => void) => Promise<void>;

const q = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector);
const all = (root: ParentNode, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];

/** Type into a field the way a browser does, so controlled and plain inputs both see it. */
export function typeInto(input: HTMLInputElement, text: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(element: Element): void {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

/** `commentMarkers: 'avatar'` (default), then `'icon'`, both read live from the editor. */
export async function checkCommentMarkers(
  container: HTMLElement,
  editor: DocxEditorInstance,
  change: Change
): Promise<void> {
  await change(() => editor.exec({ type: 'toggleReviewPane' }));
  const markers = all(container, '[data-testid="review-marker"][data-kind="comment"]');
  expect(markers).toHaveLength(2);
  const [open, closed] = markers as [HTMLElement, HTMLElement];
  expect(open.dataset.marker).toBe('avatar');
  expect(q(open, '.docx-review__badge-initials')?.textContent).toBe('AL');
  expect(q(open, '[data-testid="review-badge-count"]')?.textContent).toBe('1');
  expect(open.getAttribute('aria-label')).toContain('Replies: 1');
  expect(q(open, '[data-testid="review-badge"]')?.hasAttribute('data-resolved')).toBe(false);
  const resolved = q(closed, '[data-testid="review-badge"]');
  expect(resolved?.hasAttribute('data-resolved')).toBe(true);
  expect(q(resolved!, '.docx-review__badge-initials')).toBeNull();
  expect(q(resolved!, 'svg')).not.toBeNull();
  // Tracked changes keep their kind glyph.
  const insert = q(container, '[data-testid="review-marker"][data-kind="insert"]');
  expect(insert?.hasAttribute('data-marker')).toBe(false);
  expect(q(insert!, '[data-testid="review-badge"]')).toBeNull();

  await change(() => editor.setRevisionMarkup({ commentMarkers: 'icon' }));
  for (const marker of all(container, '[data-testid="review-marker"]')) {
    expect(marker.hasAttribute('data-marker')).toBe(false);
    expect(q(marker, '[data-testid="review-badge"]')).toBeNull();
  }
  expect(() => editor.setRevisionMarkup({ commentMarkers: 'bubble' as never })).toThrow(TypeError);
  await change(() => editor.setRevisionMarkup({ commentMarkers: 'avatar' }));
  await change(() => editor.exec({ type: 'toggleReviewPane' }));
}

function balloon(container: HTMLElement): HTMLElement | null {
  return q(container, '[data-testid="review-balloon"]');
}

/** `revisionsIn: 'balloons'`: comments in the rail, every tracked change in a page balloon. */
export async function checkChangeBalloons(
  container: HTMLElement,
  editor: DocxEditorInstance,
  change: Change
): Promise<void> {
  // The rail lists comments only, in cards and in markers.
  const cards = all(container, '[data-testid="review-card"]');
  expect(cards.length).toBeGreaterThan(0);
  expect(cards.every((card) => card.dataset.kind === 'comment')).toBe(true);
  await change(() => editor.exec({ type: 'toggleReviewPane' }));
  const markers = all(container, '[data-testid="review-marker"]');
  expect(markers.every((marker) => marker.dataset.kind === 'comment')).toBe(true);
  await change(() => editor.exec({ type: 'toggleReviewPane' }));

  // A caret move into the change opens nothing.
  const paragraphs = editor.surface!.session.paragraphIds();
  const kept = { paragraphId: paragraphs[1]!, offset: 6 };
  await change(() => editor.surface!.setSelection({ anchor: kept, head: kept }));
  expect(balloon(container)).toBeNull();

  // A click on the insertion opens it at the change.
  await change(() => press(q(container, '[data-revision-kind="insert"][data-revision-id="1"]')!));
  let open = balloon(container)!;
  expect(open).not.toBeNull();
  expect(open.dataset.variant).toBe('change');
  expect(q(open, '[data-testid="review-author"]')?.textContent).toBe('Ada Lovelace');
  expect(q(open, '[data-testid="review-summary"]')?.textContent).toContain('added');
  expect(q(open, '[data-testid="review-summary"] ins')?.textContent).toBe('added');

  // Escape from outside this editor, or one that ends an IME composition, leaves it open.
  const escape = (init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  await change(() => document.body.dispatchEvent(escape()));
  expect(balloon(container)).not.toBeNull();
  const page = q(container, '.docx-paginated-surface')!;
  await change(() => page.dispatchEvent(escape({ isComposing: true })));
  expect(balloon(container)).not.toBeNull();
  // Escape in the page closes it.
  await change(() => page.dispatchEvent(escape()));
  expect(balloon(container)).toBeNull();

  // A reply posts into the change's thread and shows under it.
  await change(() => press(q(container, '[data-revision-kind="insert"][data-revision-id="1"]')!));
  open = balloon(container)!;
  const input = q(open, '[data-testid="review-reply-input"]') as HTMLInputElement;
  expect(q(open, '[data-testid="review-reply-cancel"]')).toBeNull();
  await change(() => typeInto(input, 'Looks right'));
  expect(q(balloon(container)!, '[data-testid="review-reply-cancel"]')).not.toBeNull();
  await change(() =>
    (
      q(balloon(container)!, '[data-testid="review-reply-input"]') as HTMLInputElement
    ).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  );
  const reply = editor
    .getReviewItems({ placement: false })
    .find((item) => item.kind === 'comment' && item.text === 'Looks right');
  expect(reply?.kind === 'comment' && reply.parentRevisionId).toBeTruthy();
  expect(q(balloon(container)!, '[data-testid="review-reply"]')?.textContent).toContain(
    'Looks right'
  );
  // The reply is the change's, so the rail does not list it.
  expect(
    all(container, '[data-testid="review-card"]').some((card) =>
      card.textContent?.includes('Looks right')
    )
  ).toBe(false);

  // The first Escape in the reply line clears a draft and keeps the balloon; the next one
  // closes it and hands focus back to the document, not to `<body>`.
  const line = () =>
    q(balloon(container)!, '[data-testid="review-reply-input"]') as HTMLInputElement;
  line().focus();
  await change(() => typeInto(line(), 'Second thought'));
  await change(() => line().dispatchEvent(escape()));
  expect(balloon(container)).not.toBeNull();
  expect(line().value).toBe('');
  line().focus();
  await change(() => line().dispatchEvent(escape()));
  expect(balloon(container)).toBeNull();
  expect(document.activeElement?.closest('.docx-paginated-surface')).not.toBeNull();
  await change(() => press(q(container, '[data-revision-kind="insert"][data-revision-id="1"]')!));

  // Accept resolves the insertion and closes the balloon.
  await change(() => q(balloon(container)!, '[data-testid="review-accept"]')!.click());
  expect(
    editor
      .getReviewItems({ placement: false })
      .some(
        (item) =>
          item.kind === 'revision' && item.revisionKind === 'insert' && item.text === 'added'
      )
  ).toBe(false);
  expect(balloon(container)).toBeNull();

  // Either half of a replacement opens one decision, worded as one.
  await change(() => press(q(container, '[data-revision-kind="delete"]')!));
  open = balloon(container)!;
  expect(q(open, '[data-testid="review-balloon-card"]')?.dataset.kind).toBe('replace');
  expect(q(open, '[data-testid="review-summary"]')?.textContent).toContain('Replaced');
  expect(q(open, '[data-testid="review-summary"] del')?.textContent).toBe('old');
  expect(q(open, '[data-testid="review-summary"] ins')?.textContent).toBe('new');

  // A click elsewhere in the page closes it.
  await change(() => press(q(container, '.docx-paginated-surface')!));
  expect(balloon(container)).toBeNull();

  // Next Change opens the decision it lands on.
  await change(() => editor.exec({ type: 'navigateReviewChange', direction: 'next' }));
  open = balloon(container)!;
  expect(open).not.toBeNull();
  expect(q(open, '[data-testid="review-balloon-card"]')?.dataset.kind).toBe('replace');

  // Typing into the document closes it.
  await change(() =>
    q(container, '.docx-paginated-surface')!.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'x' })
    )
  );
  expect(balloon(container)).toBeNull();

  // A host `setActive` opens it too; Reject resolves both halves in one decision. Real typing
  // moves the caret; the synthetic event above did not, so move it here.
  const start = { paragraphId: paragraphs[1]!, offset: 0 };
  await change(() => editor.surface!.setSelection({ anchor: start, head: start }));
  const pair = editor
    .getReviewItems({ placement: false, pairReplacements: true })
    .find((item) => item.kind === 'revision' && item.revisionKind === 'replace')!;
  await change(() => {
    editor.setActiveReviewItem(pair.key);
  });
  open = balloon(container)!;
  expect(open).not.toBeNull();
  await change(() => q(open, '[data-testid="review-reject"]')!.click());
  expect(
    editor.getReviewItems({ placement: false }).filter((item) => item.kind === 'revision')
  ).toHaveLength(0);
  expect(balloon(container)).toBeNull();
}

/** Viewing mode keeps the balloon readable and its decisions unavailable. */
export async function checkReadOnlyBalloon(
  container: HTMLElement,
  editor: DocxEditorInstance,
  change: Change
): Promise<void> {
  await change(() => editor.setEditingMode('viewing'));
  await change(() => press(q(container, '[data-revision-kind="insert"][data-revision-id="1"]')!));
  const open = balloon(container)!;
  expect(open).not.toBeNull();
  expect((q(open, '[data-testid="review-accept"]') as HTMLButtonElement).disabled).toBe(true);
  expect((q(open, '[data-testid="review-reject"]') as HTMLButtonElement).disabled).toBe(true);
}

/** A caret placed inside a tracked row opens nothing; an explicit activation still does. */
export async function checkStructuralCaret(
  container: HTMLElement,
  editor: DocxEditorInstance,
  change: Change
): Promise<void> {
  const cell = all(container, '[data-paragraph-id]').find((node) =>
    node.textContent?.includes('Added row')
  );
  expect(cell).toBeDefined();
  const inside = { paragraphId: cell!.dataset.paragraphId!, offset: 2 };
  await change(() => editor.surface!.setSelection({ anchor: inside, head: inside }));
  expect(balloon(container)).toBeNull();

  const row = editor
    .getReviewItems({ placement: false })
    .find((item) => item.kind === 'revision' && item.revisionKind === 'structural')!;
  expect(row).toBeDefined();
  await change(() => {
    editor.setActiveReviewItem(row.key);
  });
  expect(q(balloon(container)!, '[data-testid="review-balloon-card"]')?.dataset.kind).toBe(
    'structural'
  );
}
