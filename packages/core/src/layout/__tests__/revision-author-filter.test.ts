import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { revisionAuthorFilter, type RevisionDisplayMode } from '../revision-projection.ts';
import { storyBlocks } from '../story-roots.ts';
import { projectedSectionSourceIndexes } from '../section-properties.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraph(body: string): OoxmlNode {
  const part = load(body);
  const found = part.root.children[0]!.children.find((node) => node.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText>${text}</w:delText></w:r>`;
const ins = (author: string, text: string) =>
  `<w:ins w:id="1" w:author="${author}">${run(text)}</w:ins>`;
const del = (author: string, text: string) =>
  `<w:del w:id="2" w:author="${author}">${delRun(text)}</w:del>`;

function pieces(
  body: string,
  hidden: readonly string[],
  displayMode: RevisionDisplayMode = 'all-markup'
) {
  return piecesOfParagraph(
    paragraph(body),
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    displayMode,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    revisionAuthorFilter(hidden)
  );
}

describe('review author layout filter', () => {
  test('canonical filters expose no mutating Set methods or divergent cache identity', () => {
    const filter = revisionAuthorFilter(['Grace', 'Ada', 'Ada']);
    expect(filter).toBeDefined();
    if (!filter) return;
    expect([...filter.hiddenAuthors]).toEqual(['Ada', 'Grace']);
    expect(filter.cacheKey).toBe('["Ada","Grace"]');
    expect((filter.hiddenAuthors as unknown as { add?: unknown }).add).toBeUndefined();
    expect((filter.hiddenAuthors as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((filter.hiddenAuthors as unknown as { clear?: unknown }).clear).toBeUndefined();
  });

  test('hidden insertions remain as ordinary accepted text', () => {
    const result = pieces(`<w:p>${ins('Ada', 'new')}${ins('Grace', 'other')}</w:p>`, ['Ada']);
    expect(result.map((piece) => piece.text)).toEqual(['new', 'other']);
    expect(result[0]!.revisions).toBeUndefined();
    expect(result[1]!.revisions?.map((revision) => revision.author)).toEqual(['Grace']);
  });

  test('hidden deletions leave the text flow while visible deletions remain', () => {
    const result = pieces(`<w:p>${run('A')}${del('Ada', 'old')}${del('Grace', 'shown')}</w:p>`, [
      'Ada',
    ]);
    expect(result.map((piece) => piece.text).join('')).toBe('Ashown');
    expect(result.at(-1)!.revisions?.[0]?.author).toBe('Grace');
  });

  test('a hidden inner insertion stays inside a visible outer deletion', () => {
    const nested = `<w:p><w:del w:id="1" w:author="Grace"><w:ins w:id="2" w:author="Ada">${run(
      'word'
    )}</w:ins></w:del></w:p>`;
    const result = pieces(nested, ['Ada']);
    expect(result[0]!.text).toBe('word');
    expect(result[0]!.revisions?.map((revision) => revision.author)).toEqual(['Grace']);
  });

  test('hidden authors use the accepted projection inside the original view', () => {
    const result = pieces(
      `<w:p>${ins('Ada', 'accepted')}${ins('Grace', 'originally absent')}${del(
        'Ada',
        'removed'
      )}${del('Grace', 'original')}</w:p>`,
      ['Ada'],
      'original'
    );
    expect(result.map((piece) => piece.text).join('')).toBe('acceptedoriginal');
    expect(result[0]!.text).toBe('accepted');
    expect(result[0]!.revisions).toBeUndefined();
  });

  test('a hidden formatting change keeps applied formatting without markup', () => {
    const change = '<w:rPrChange w:id="3" w:author="Ada"><w:rPr><w:i/></w:rPr></w:rPrChange>';
    const [hidden] = pieces(`<w:p>${run('formatted', `<w:b/>${change}`)}</w:p>`, ['Ada']);
    const [shown] = pieces(`<w:p>${run('formatted', `<w:b/>${change}`)}</w:p>`, []);
    expect(hidden!.style.bold).toBe(true);
    expect(hidden!.props.some((property) => property.localName === 'rPrChange')).toBe(false);
    expect(shown!.props.some((property) => property.localName === 'rPrChange')).toBe(true);
    for (const displayMode of ['proposed', 'original'] as const) {
      const [resolved] = pieces(
        `<w:p>${run('formatted', `<w:b/>${change}`)}</w:p>`,
        ['Ada'],
        displayMode
      );
      expect(resolved!.style.bold).toBe(true);
      expect(resolved!.props.some((property) => property.localName === 'rPrChange')).toBe(false);
    }
  });

  test('a hidden paragraph-mark deletion merges only that reviewer', () => {
    const marked = (author: string, text: string) =>
      `<w:p><w:pPr><w:rPr><w:del w:id="4" w:author="${author}"/></w:rPr></w:pPr>${run(text)}</w:p>`;
    const part = load(`${marked('Ada', 'one')}${marked('Grace', 'two')}<w:p>${run('three')}</w:p>`);
    const blocks = storyBlocks(part, 'all-markup', revisionAuthorFilter(['Ada']));
    expect(blocks).toHaveLength(2);
    expect(
      blocks[0]!.children.flatMap((child) => (child.kind === 'run' ? child.children : []))
    ).not.toEqual([]);
    expect(blocks[1]!.id).not.toBe(blocks[0]!.id);
  });

  test('hidden paragraph marks use the accepted projection in the original view', () => {
    const marked = (kind: 'ins' | 'del', text: string) =>
      `<w:p><w:pPr><w:rPr><w:${kind} w:id="5" w:author="Ada"/></w:rPr></w:pPr>${run(text)}</w:p>`;
    const survivor = `<w:p>${run('survivor')}</w:p>`;
    expect(
      storyBlocks(
        load(`${marked('del', 'merged')}${survivor}`),
        'original',
        revisionAuthorFilter(['Ada'])
      )
    ).toHaveLength(1);
    expect(
      storyBlocks(
        load(`${marked('ins', 'kept')}${survivor}`),
        'original',
        revisionAuthorFilter(['Ada'])
      )
    ).toHaveLength(2);
  });

  test('projected sections retain the canonical source index of their surviving break', () => {
    const section = (width: number, text: string, markRevision = '') =>
      `<w:p><w:pPr><w:sectPr><w:pgSz w:w="${width}" w:h="15840"/></w:sectPr>${markRevision}</w:pPr>${run(text)}</w:p>`;
    const hiddenMark = '<w:rPr><w:del w:id="9" w:author="Ada"/></w:rPr>';
    const part = load(
      section(10000, 'absorbed', hiddenMark) +
        section(12000, 'survivor') +
        `<w:p>${run('final')}</w:p><w:sectPr><w:pgSz w:w="14000" w:h="15840"/></w:sectPr>`
    );

    expect(
      projectedSectionSourceIndexes(part, 'all-markup', revisionAuthorFilter(['Ada']))
    ).toEqual([1, 2]);
  });
});
