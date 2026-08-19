/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Declarative revision styles end to end: what `<DocxEditor.ColorByChangeType>` and
// `<DocxEditor.AuthorStyle>` declare must reach the painted spans, through the registry →
// `setRevisionStyles` → the paginated surface → the painter. The unit policy lives in
// core's revision-paint tests; what THIS file pins is the plumbing, in the all-markup view
// a review module enables.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance, RevisionAuthorStyle } from '@docx-editor.dev/core/editor';
import {
  DocxEditorColorByChangeType,
  DocxEditorAuthorStyle,
  DocxEditorContent,
  DocxEditorRoot,
  DocxEditorViewport,
} from '@docx-editor.dev/react';
import { reviewModule } from '../index.ts';
import { DocxEditorReview, useReviewAuthor, type ReviewItemView } from '../react/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
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

const TRACKED = docx(
  '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins>' +
    '<w:ins w:id="2" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t xml:space="preserve"> more</w:t></w:r></w:ins></w:p>'
);

interface Declared {
  /** `<ColorByChangeType />`: unstyled authors fall back to the kind colours. */
  readonly kind?: boolean;
  readonly authors?: Readonly<Record<string, string | RevisionAuthorStyle>>;
}

/** The declarative form of a scheme: one render-nothing component per declaration. */
function declarations({ kind, authors }: Declared) {
  return (
    <>
      {kind ? <DocxEditorColorByChangeType /> : null}
      {Object.entries(authors ?? {}).map(([author, value]) => (
        <DocxEditorAuthorStyle
          key={author}
          author={author}
          {...(typeof value === 'string' ? { color: value } : value)}
        />
      ))}
    </>
  );
}

function mount(declared: Declared = {}) {
  return render(
    <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
      {declarations(declared)}
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

function insertionInk(container: HTMLElement, author: string): string | undefined {
  return container.querySelector<HTMLElement>(
    `.docx-revision-insert[data-review-author="${author}"]`
  )?.style.color;
}

/** One colour per author, in document order — a run may paint as more than one span. */
function colorsByAuthor(container: HTMLElement): Map<string, Set<string>> {
  const byAuthor = new Map<string, Set<string>>();
  for (const span of container.querySelectorAll<HTMLElement>('.docx-revision-insert')) {
    const author = span.dataset.reviewAuthor ?? '';
    const colors = byAuthor.get(author) ?? new Set<string>();
    colors.add(span.style.color);
    byAuthor.set(author, colors);
  }
  return byAuthor;
}

afterEach(cleanup);

describe('revisionStyles reaches the painted document', () => {
  test("by default each insertion takes its author's slot colour", () => {
    const view = mount();
    expect(colorsByAuthor(view.container)).toEqual(
      new Map([
        ['Ada Lovelace', new Set(['var(--doc-review-author-0)'])],
        ['Grace Hopper', new Set(['var(--doc-review-author-1)'])],
      ])
    );
  });

  test('an AuthorStyle overrides one author and leaves the rest on the ramp', () => {
    const view = mount({ authors: { 'Ada Lovelace': 'var(--brand-ada)' } });
    expect(colorsByAuthor(view.container)).toEqual(
      new Map([
        ['Ada Lovelace', new Set(['var(--brand-ada)'])],
        ['Grace Hopper', new Set(['var(--doc-review-author-1)'])],
      ])
    );
  });

  test('ColorByChangeType beside an AuthorStyle puts the unstyled rest on the kind colours', () => {
    const view = mount({ kind: true, authors: { 'Ada Lovelace': 'var(--brand-ada)' } });
    expect(colorsByAuthor(view.container)).toEqual(
      new Map([
        ['Ada Lovelace', new Set(['var(--brand-ada)'])],
        ['Grace Hopper', new Set(['var(--doc-revision-insertion)'])],
      ])
    );
  });

  test('per-author CSS hooks land on painted spans and on review cards', () => {
    const view = mount();
    // The painted document: `data-review-author-slot` beside the author name.
    const ada = view.container.querySelector<HTMLElement>(
      '.docx-revision-insert[data-review-author="Ada Lovelace"]'
    );
    expect(ada?.dataset.reviewAuthorSlot).toBe('0');
    // The rail's cards carry the mirrored hooks, so one reviewer's cards restyle in CSS.
    const cards = view.getAllByTestId('review-card');
    expect(cards.map((card) => [card.dataset.reviewAuthor, card.dataset.reviewAuthorSlot])).toEqual(
      [
        ['Ada Lovelace', '0'],
        ['Grace Hopper', '1'],
      ]
    );
  });

  test("the packaged card follows the author's colour as its accent, and shows the avatar", () => {
    const view = mount({
      authors: {
        'Ada Lovelace': {
          color: 'var(--brand-ada)',
          avatarUrl: 'https://example.com/ada.png',
        },
      },
    });
    const [adaCard, graceCard] = view.getAllByTestId('review-card');
    // Ada's card keys its accent on HER resolved colour — the one her text draws in…
    expect(adaCard!.style.getPropertyValue('--doc-review-author-current')).toBe('var(--brand-ada)');
    const avatar = adaCard!.querySelector<HTMLImageElement>('.docx-review__avatar-img');
    expect(avatar?.getAttribute('src')).toBe('https://example.com/ada.png');
    // …and Grace's keeps the ramp, with initials in the disc.
    expect(graceCard!.style.getPropertyValue('--doc-review-author-current')).toBe(
      'var(--doc-review-author-1)'
    );
    expect(graceCard!.querySelector('.docx-review__avatar-img')).toBeNull();
    expect(insertionInk(view.container, 'Ada Lovelace')).toBe('var(--brand-ada)');
  });

  test("host class names land on the author's document spans", () => {
    const view = mount({ authors: { 'Ada Lovelace': { spanClassName: 'agent-edit' } } });
    const ada = view.container.querySelector<HTMLElement>(
      '.docx-revision-insert[data-review-author="Ada Lovelace"]'
    );
    expect(ada?.classList.contains('agent-edit')).toBe(true);
    // Card design is composition's job: restyle cards through the `data-review-author` hooks or a
    // custom card, never through the record.
    const [adaCard] = view.getAllByTestId('review-card');
    expect(adaCard!.dataset.reviewAuthor).toBe('Ada Lovelace');
  });

  test('a fully custom card links to the author styles through useReviewAuthor', () => {
    function MyCard({ item }: { item: ReviewItemView }) {
      const info = useReviewAuthor(item.author);
      return (
        <div data-testid="my-card" data-card-color={info?.color}>
          {info?.style?.avatarUrl ? <img src={info.style.avatarUrl} alt="" /> : item.author}
        </div>
      );
    }
    const view = render(
      <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
        <DocxEditorAuthorStyle
          author="Ada Lovelace"
          color="var(--brand-ada)"
          avatarUrl="/ada.png"
        />
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview>
            <DocxEditorReview.List>{(item) => <MyCard item={item} />}</DocxEditorReview.List>
          </DocxEditorReview>
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const cards = view.getAllByTestId('my-card');
    // Ada's custom card resolves her pinned colour and avatar; Grace rides the ramp.
    expect(cards.map((card) => card.dataset.cardColor)).toEqual([
      'var(--brand-ada)',
      'var(--doc-review-author-1)',
    ]);
    expect(cards[0]!.querySelector('img')?.getAttribute('src')).toBe('/ada.png');
    expect(cards[1]!.querySelector('img')).toBeNull();
  });

  test('a COMMENT-only author still gets their declared colour and avatar', async () => {
    // The roster reads the document's REVISIONS, so an author who only commented is not in
    // it. Their card must still honour the style declared for them, or "style this
    // reviewer" silently does nothing for the reviewers who only leave comments.
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={TRACKED}
        modules={[reviewModule()]}
        author="Sam Reyes"
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorAuthorStyle author="Sam Reyes" color="var(--brand-sam)" avatarUrl="/sam.png" />
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {
      instance!.surface!.selectAll();
    });
    await act(async () => {
      expect(instance!.addComment('please review', 'Sam Reyes').ok).toBe(true);
    });
    const card = view
      .getAllByTestId('review-card')
      .find((node) => node.dataset.reviewAuthor === 'Sam Reyes');
    expect(card).toBeDefined();
    expect(card!.style.getPropertyValue('--doc-review-author-current')).toBe('var(--brand-sam)');
    expect(
      card!.querySelector<HTMLImageElement>('.docx-review__avatar-img')?.getAttribute('src')
    ).toBe('/sam.png');
  });

  test('a script-scheme avatar URL is dropped; the initials stand in', () => {
    const view = mount({ authors: { 'Ada Lovelace': { avatarUrl: 'javascript:alert(1)' } } });
    const [adaCard] = view.getAllByTestId('review-card');
    expect(adaCard!.querySelector('.docx-review__avatar-img')).toBeNull();
    expect(adaCard!.querySelector('[data-testid="review-avatar"]')?.textContent).not.toBe('');
  });

  test('ColorByChangeType alone puts every author back on the kind colours', () => {
    const view = mount({ kind: true });
    for (const colors of colorsByAuthor(view.container).values()) {
      expect([...colors]).toEqual(['var(--doc-revision-insertion)']);
    }
    expect(colorsByAuthor(view.container).size).toBe(2);
  });
});
