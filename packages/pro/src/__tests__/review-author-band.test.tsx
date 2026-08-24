/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// ONE AUTHOR, ONE COLOUR, ACROSS BOTH HALVES OF REVIEW.
//
// Review is comments AND tracked changes, so the slot a person draws in has to be the same
// number wherever they appear: on the card in the rail, and on the band over the text. The
// two are derived in different packages from different inputs — the roster walks the LAYOUT,
// the rail walks the QUEUE — which is exactly why the agreement needs a test rather than a
// comment.
//
// The band's colour does NOT change with the author: Word keeps every comment yellow, and
// these hooks exist so a host can opt into more, not so the engine does it for them.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

// Ada proposes a tracked change AND leaves a comment; Grace only comments. So Ada is numbered
// by the layout walk and Grace is not numbered by it at all — the case the roster has to
// extend without renumbering Ada.
const MIXED = zipSync({
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
      '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
      '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:t>added</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>hello</w:t></w:r>' +
      '<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>' +
      '<w:p><w:commentRangeStart w:id="8"/><w:r><w:t>world</w:t></w:r>' +
      '<w:commentRangeEnd w:id="8"/><w:r><w:commentReference w:id="8"/></w:r></w:p>' +
      '</w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      '<w:comment w:id="7" w:author="Grace Hopper" w14:paraId="A0000001">' +
      '<w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment>' +
      '<w:comment w:id="8" w:author="Ada Lovelace" w14:paraId="A0000002">' +
      '<w:p><w:r><w:t>And this.</w:t></w:r></w:p></w:comment>' +
      '</w:comments>'
  ),
  'word/commentsExtended.xml': strToU8(
    `<w15:commentsEx xmlns:w15="${W15}">` +
      '<w15:commentEx w15:paraId="A0000001" w15:done="0"/>' +
      '<w15:commentEx w15:paraId="A0000002" w15:done="0"/>' +
      '</w15:commentsEx>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `<Relationship Id="rIdCE" Type="${COMMENTS_EXTENDED_REL}" Target="commentsExtended.xml"/>` +
      '</Relationships>'
  ),
});

async function mount() {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={MIXED}
      author="Grace Hopper"
      modules={[reviewModule()]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await act(async () => {});
  return { view, editor: instance! };
}

/** The slot the CARD for this author draws in. */
function cardSlot(view: { container: HTMLElement }, author: string): string | null {
  return (
    view.container
      .querySelector(`.docx-review__card[data-review-author="${author}"]`)
      ?.getAttribute('data-review-author-slot') ?? null
  );
}

/** The slot the BAND over this author's commented text draws in. */
function bandSlot(container: HTMLElement, author: string): string | null {
  return (
    container
      .querySelector(`.docx-comment-band[data-review-author="${author}"]`)
      ?.getAttribute('data-review-author-slot') ?? null
  );
}

afterEach(cleanup);

describe('the comment band carries its author', () => {
  test('a band exposes the author, the slot, and the colour as CSS hooks', async () => {
    const { view } = await mount();
    const band = view.container.querySelector<HTMLElement>(
      '.docx-comment-band[data-review-author]'
    );
    expect(band).not.toBeNull();
    expect(band!.dataset.reviewAuthor).toBe('Grace Hopper');
    expect(band!.dataset.reviewAuthorSlot).toBeDefined();
    // The resolved colour, so a host rule reading `var(--doc-review-author-current)` on the band gets
    // the same value the card got — not a fallback, and not the empty string.
    expect(band!.style.getPropertyValue('--doc-review-author-current')).not.toBe('');
  });

  test('the band and the card agree on the slot, for a commenter and for an editor', async () => {
    const { view } = await mount();
    // Ada is numbered by the LAYOUT (she has a tracked change); Grace only by the queue.
    for (const author of ['Ada Lovelace', 'Grace Hopper']) {
      const onCard = cardSlot(view, author);
      expect(onCard).not.toBeNull();
      expect(bandSlot(view.container, author)).toBe(onCard);
    }
  });

  test('a comment-only author takes a NEW slot rather than the first author’s', async () => {
    const { view, editor } = await mount();
    const roster = new Map(editor.getReviewAuthors().map((it) => [it.author, it.slot]));
    // The revision author keeps slot 0 — the painter has already written that number into the
    // page, so a commenter appearing first in the queue must not push her off it.
    expect(roster.get('Ada Lovelace')).toBe(0);
    expect(roster.get('Grace Hopper')).toBe(1);
    expect(cardSlot(view, 'Grace Hopper')).toBe('1');
  });

  test('a comment card keeps its colour when its author adds an earlier tracked change', async () => {
    const { view, editor } = await mount();
    const comment = view.container.querySelector<HTMLElement>(
      '.docx-review__card[data-kind="comment"][data-review-author="Grace Hopper"]'
    )!;
    expect(comment.dataset.reviewAuthorSlot).toBe('1');
    expect(comment.style.getPropertyValue('--doc-review-author-current')).toBe(
      'var(--doc-review-author-1)'
    );

    await act(async () => {
      editor.setEditingMode('suggesting');
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 0 },
      });
      editor.surface!.type('X');
    });

    const cards = [
      ...view.container.querySelectorAll<HTMLElement>(
        '.docx-review__card[data-review-author="Grace Hopper"]'
      ),
    ];
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.dataset.reviewAuthorSlot === '1')).toBe(true);
    expect(
      cards.every(
        (card) =>
          card.style.getPropertyValue('--doc-review-author-current') ===
          'var(--doc-review-author-1)'
      )
    ).toBe(true);
    expect(
      view.container.querySelector<HTMLElement>('.docx-revision[data-review-author="Grace Hopper"]')
        ?.dataset.reviewAuthorSlot
    ).toBe('1');
    expect(
      view.container.querySelector<HTMLElement>('.docx-revision[data-review-author="Grace Hopper"]')
        ?.style.color
    ).toBe('var(--doc-review-author-1)');
    expect(comment.isConnected).toBe(true);
    expect(comment.dataset.kind).toBe('comment');

    const revision = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.author === 'Grace Hopper')!;
    await act(async () => {
      expect(editor.rejectReviewItem(revision.key).ok).toBe(true);
    });
    expect(comment.dataset.reviewAuthorSlot).toBe('1');

    await act(async () => {
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    });
    expect(comment.dataset.reviewAuthorSlot).toBe('1');
    expect(
      view.container.querySelector<HTMLElement>('.docx-revision[data-review-author="Grace Hopper"]')
        ?.dataset.reviewAuthorSlot
    ).toBe('1');
  });

  test('the band stays Word’s yellow: the author is a handle, not a default', async () => {
    const { view } = await mount();
    const band = view.container.querySelector<HTMLElement>(
      '.docx-comment-band[data-review-author]'
    );
    // Geometry aside, the band's ONLY inline property is the author variable. An engine that
    // started tinting by author would write a paint property here beside it; the opt-in this
    // documents is a stylesheet rule, which writes nothing inline at all.
    const GEOMETRY = new Set(['position', 'left', 'top', 'width', 'height']);
    const inline = Array.from({ length: band!.style.length }, (_, i) => band!.style.item(i));
    expect(inline.filter((name) => !GEOMETRY.has(name))).toEqual(['--doc-review-author-current']);
    // And the class stays the shared one: no per-author class the engine invented.
    expect(band!.className).toBe('docx-comment-band');
  });

  test('a host declaration reaches the band, not only the card', async () => {
    const { view, editor } = await mount();
    await act(async () => {
      editor.setRevisionStyles({ authors: { 'Grace Hopper': '#0b7285' } });
    });
    const band = view.container.querySelector<HTMLElement>(
      '.docx-comment-band[data-review-author="Grace Hopper"]'
    );
    // A live colour change is paint-level, and the band layer is repainted by the same pass.
    // The declaration has to survive the trip: the card and the text cannot disagree about a
    // colour the host set explicitly.
    expect(band!.style.getPropertyValue('--doc-review-author-current')).toBe('#0b7285');
  });
});
