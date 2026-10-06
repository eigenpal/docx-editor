import { caretStops } from '../../layout/semantic-interaction.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { collectPageChangeBars } from '../semantic-paint-change-bars.ts';
import {
  DEFAULT_REVISION_MARKUP,
  resolveRevisionMarkup,
  type RevisionMarkupOptions,
} from '../../contracts/revision-markup.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const revision = (kind: string, text: string) =>
  `<w:${kind} w:id="1" w:author="Reviewer">${run(text)}</w:${kind}>`;
function render(
  body: string,
  options: RevisionMarkupOptions,
  revisionStyles?: import('../revision-presentation.ts').RevisionStyles
) {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const revisionMarkup = resolveRevisionMarkup(options);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    revisionAuthorFilter: {
      hiddenAuthors: new Set(),
      cacheKey: JSON.stringify(revisionMarkup),
      revisionMarkup,
    },
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1, revisionMarkup, revisionStyles });
  expect(serializeOoxmlPart(parsed.part)).toEqual(before);
  return { root, layout, revisionMarkup };
}
test('settings merge deeply, reject unknown values, and stay immutable', () => {
  const value = resolveRevisionMarkup({ insertions: { color: 'red' } });
  expect(value.insertions).toEqual({ mark: 'underline', color: 'red' });
  expect(DEFAULT_REVISION_MARKUP.insertions.color).toBe('byAuthor');
  expect(Object.isFrozen(value.insertions)).toBe(true);
  expect(() => resolveRevisionMarkup({ insertions: { color: 'url(x)' as never } })).toThrow();
  expect(() => resolveRevisionMarkup({ extra: true } as never)).toThrow();
});
test.each([
  'none',
  'colorOnly',
  'bold',
  'italic',
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
] as const)('renders insertion mark %s', (mark) => {
  const { root, layout } = render(`<w:p>${revision('ins', 'text')}</w:p>`, {
    insertions: { mark, color: 'blue' },
  });
  const span = root.querySelector<HTMLElement>('[data-revision-kind="insert"]')!;
  expect(span.textContent).toBe('text');
  if (mark === 'none') expect(span.style.color).toBe('');
  else expect(span.style.color).toBe('var(--doc-revision-color-blue)');
  if (mark === 'bold' || mark === 'italic')
    expect(linesOf(layout)[0]!.spans[0]!.style[mark]).toBe(true);
  if (mark.startsWith('double')) expect(span.style.textDecorationStyle).toBe('double');
});
test.each([
  ['hidden', '', 0],
  ['caret', '^', 6],
  ['pound', '#', 6],
] as const)(
  'deletion %s changes measured geometry and keeps model offsets',
  (mark, text, width) => {
    const { layout } = render(`<w:p>${revision('del', 'removed')}${run('keep')}</w:p>`, {
      deletions: { mark },
    });
    const spans = linesOf(layout).flatMap((line) => line.spans);
    expect(spans.map((span) => span.text).join('')).toBe(`${text}keep`);
    const kept = spans.find((span) => span.text === 'keep')!;
    expect(kept.range.start).toBe(7);
    expect(kept.box.x - spans[0]!.box.x).toBeCloseTo(width ? spans[0]!.box.width : 0);
    if (text) expect(spans[0]!.range.end).toBe(7);
  }
);
test('moves use independent marks and the tracking switch selects insertion and deletion styles', () => {
  const source = `<w:p>${revision('moveFrom', 'old')}${revision('moveTo', 'new')}</w:p>`;
  const enabled = render(source, {}).root;
  expect(
    enabled.querySelector<HTMLElement>('[data-revision-kind="moveTo"]')!.style.textDecorationStyle
  ).toBe('double');
  const disabled = render(source, { trackMoves: false, insertions: { mark: 'bold' } }).root;
  expect(
    disabled.querySelector<HTMLElement>('[data-revision-kind="moveTo"]')!.style.fontWeight
  ).toBe('bold');
});
test('paragraph and run formatting revisions use the selected mark', () => {
  const paragraph =
    '<w:pPr><w:pPrChange w:id="2" w:author="Reviewer"><w:pPr/></w:pPrChange></w:pPr>';
  const { root } = render(`<w:p>${paragraph}${run('text')}</w:p>`, {
    formatting: { mark: 'doubleUnderline', color: 'red' },
  });
  const span = root.querySelector<HTMLElement>('[data-revision-kind="format"][data-start]')!;
  expect(span.style.textDecorationStyle).toBe('double');
});
test('change bars honor position, facing pages, color, and none', () => {
  const { layout } = render(`<w:p>${revision('ins', 'text')}</w:p>`, {});
  const page = layout.pages[0]!;
  const left = collectPageChangeBars(
    page,
    1,
    'all-markup',
    false,
    resolveRevisionMarkup({ changedLines: { mark: 'leftBorder' } })
  );
  const right = collectPageChangeBars(
    page,
    1,
    'all-markup',
    false,
    resolveRevisionMarkup({ changedLines: { mark: 'rightBorder', color: 'red' } })
  );
  expect(right.left).toBeGreaterThan(left.left);
  expect(right.color).toBe('var(--doc-revision-color-red)');
  expect(
    collectPageChangeBars(
      { ...page, index: 0 },
      1,
      'all-markup',
      false,
      DEFAULT_REVISION_MARKUP,
      true
    ).left
  ).toBe(right.left);
  expect(
    collectPageChangeBars(
      page,
      1,
      'all-markup',
      false,
      resolveRevisionMarkup({ changedLines: { mark: 'none' } })
    ).runs
  ).toHaveLength(0);
});
test.each([
  ['cellIns', '', 'inserted'],
  ['cellDel', '', 'deleted'],
  ['cellMerge', 'w:vMerge="cont"', 'merged'],
  ['cellMerge', 'w:vMergeOrig="cont" w:vMerge="rest"', 'split'],
])('cell %s %s has %s shading', (name, attributes, kind) => {
  const { root } = render(
    `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:${name} w:id="1" w:author="Reviewer" ${attributes}/></w:tcPr><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`,
    {}
  );
  expect(root.querySelector<HTMLElement>('[data-revision-cell]')!.dataset.revisionCell).toBe(kind);
});

test('formatting uses each author slot and explicit color overrides author colors', () => {
  const formatted = (author: string, text: string) =>
    `<w:r><w:rPr><w:rPrChange w:id="${author}" w:author="${author}"><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
  const body = `<w:p>${formatted('A', 'first')}${formatted('B', 'second')}</w:p>`;
  const root = render(body, { formatting: { mark: 'underline' } }).root;
  const spans = [
    ...root.querySelectorAll<HTMLElement>('[data-revision-kind="format"][data-start]'),
  ];
  expect(spans[0]!.style.color).toBe('var(--doc-review-author-0)');
  expect(spans[1]!.style.color).toBe('var(--doc-review-author-1)');
  const custom = render(
    body,
    { formatting: { mark: 'underline', color: 'blue' } },
    { others: 'author', authors: { A: 'red' } }
  ).root;
  expect(
    custom.querySelector<HTMLElement>('[data-review-author="A"][data-start]')!.style.color
  ).toBe('var(--doc-revision-color-blue)');
  const plain = render(
    body,
    { formatting: { mark: 'none' } },
    { others: 'author', authors: { A: 'red' } }
  ).root;
  expect(
    plain.querySelector<HTMLElement>('[data-review-author="A"][data-start]')!.style.color
  ).toBe('');
});

test('change bars use each author color', () => {
  const root = render(
    `<w:p><w:ins w:id="1" w:author="A">${run('first')}</w:ins></w:p><w:p><w:ins w:id="2" w:author="B">${run('second')}</w:ins></w:p>`,
    { changedLines: { color: 'byAuthor' } }
  ).root;
  const bars = [...root.querySelectorAll<HTMLElement>('.docx-change-bar')];
  expect(bars.map((bar) => bar.style.backgroundColor)).toEqual([
    'var(--doc-review-author-0)',
    'var(--doc-review-author-1)',
  ]);
});

test.each(['hidden', 'caret', 'pound'] as const)(
  'caret stops skip removed text under %s',
  (mark) => {
    const { layout } = render(`<w:p>${run('AB')}${revision('del', 'CDE')}${run('FG')}</w:p>`, {
      deletions: { mark },
    });
    expect(caretStops(layout).map((stop) => stop.position.offset)).toEqual([0, 1, 2, 5, 6, 7]);
  }
);

test.each(['', run('kept')])('hidden deletions retain changed lines beside %s', (kept) => {
  const { root } = render(`<w:p>${revision('del', 'removed')}${kept}</w:p>`, {
    deletions: { mark: 'hidden' },
    changedLines: { color: 'byAuthor' },
  });
  expect(root.querySelector('[data-revision-kind="delete"]')).toBeNull();
  const bar = root.querySelector<HTMLElement>('.docx-change-bar');
  expect(bar).not.toBeNull();
  expect(bar!.style.backgroundColor).toBe('var(--doc-review-author-0)');
});

test('hidden deletion bars retain distinct author colors', () => {
  const deleted = (author: string) =>
    `<w:p><w:del w:id="${author}" w:author="${author}">${run('removed')}</w:del></w:p>`;
  const { root } = render(deleted('A') + deleted('B'), {
    deletions: { mark: 'hidden' },
    changedLines: { color: 'byAuthor' },
  });
  expect(
    [...root.querySelectorAll<HTMLElement>('.docx-change-bar')].map(
      (bar) => bar.style.backgroundColor
    )
  ).toEqual(['var(--doc-review-author-0)', 'var(--doc-review-author-1)']);
});

test('paragraph formatting marks retain distinct author colors', () => {
  const formatted = (author: string) =>
    `<w:p><w:pPr><w:pPrChange w:id="${author}" w:author="${author}"><w:pPr/></w:pPrChange></w:pPr>${run('text')}</w:p>`;
  const { root } = render(formatted('A') + formatted('B'), {
    formatting: { mark: 'underline' },
  });
  expect(
    [...root.querySelectorAll<HTMLElement>('[data-revision-kind="format"][data-start]')].map(
      (span) => span.style.color
    )
  ).toEqual(['var(--doc-review-author-0)', 'var(--doc-review-author-1)']);
});

test.each(['none', 'doubleUnderline', 'hidden', 'caret', 'pound'] as const)(
  'paragraph deletion marks follow %s settings',
  (mark) => {
    const { root } = render(
      `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="Reviewer"/></w:rPr></w:pPr>${run('text')}</w:p>`,
      { deletions: { mark, color: 'blue' } }
    );
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph).not.toBeNull();
    expect(glyph.style.color).toBe(mark === 'none' ? '' : 'var(--doc-revision-color-blue)');
    if (mark === 'doubleUnderline') expect(glyph.style.textDecorationStyle).toBe('double');
    if (mark === 'hidden') expect(glyph.style.visibility).toBe('hidden');
    if (mark === 'caret') expect(glyph.textContent).toBe('^');
    if (mark === 'pound') expect(glyph.textContent).toBe('#');
  }
);
