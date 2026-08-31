import { describe, expect, test } from 'bun:test';
import {
  collectRevisionSites,
  readOoxmlPart,
  revisionItemsOf,
  type OoxmlNode,
  type OoxmlPart,
  type ReviewCommentItem,
  type ReviewRevisionItem,
} from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../../layout/field-projection.ts';
import type { RevisionAuthorFilter } from '../../layout/revision-projection.ts';
import { createRevisionAuthorVisibility } from '../revision-author-visibility.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const paragraph = find(child);
      if (paragraph) return paragraph;
    }
    return null;
  };
  const paragraph = find(part.root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

function pieces(part: OoxmlPart, filter: RevisionAuthorFilter | undefined) {
  return piecesOfParagraph(
    firstParagraph(part),
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    'all-markup',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    filter
  );
}

const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r>`;
const insertion = (id: string, author: string, date: string, text: string) =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="${date}">${run(text)}</w:ins>`;
const deletion = (id: string, author: string, date: string, text: string) =>
  `<w:del w:id="${id}" w:author="${author}" w:date="${date}"><w:r><w:delText>${text}</w:delText></w:r></w:del>`;

describe('tracked-change predicate', () => {
  test('receives full revision items and combines author, date, and kind', () => {
    const part = load(
      `<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'EARLY')}${insertion(
        '2',
        'Bob',
        '2026-02-01T00:00:00Z',
        'LATE'
      )}${deletion('3', 'Carol', '2026-03-01T00:00:00Z', 'REMOVED')}</w:p>`
    );
    const visibility = createRevisionAuthorVisibility();
    const seen: ReviewRevisionItem[] = [];
    visibility.setTrackedChangePredicate((revision) => {
      seen.push(revision);
      return (
        revision.author === 'Bob' &&
        revision.revisionKind === 'insert' &&
        Date.parse(revision.date ?? '') >= Date.parse('2026-02-01T00:00:00Z')
      );
    });

    const items = revisionItemsOf(part);
    const result = pieces(part, visibility.filterFor(items));

    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({
      kind: 'revision',
      author: 'Alice',
      date: '2026-01-01T00:00:00Z',
      revisionKind: 'insert',
      text: 'EARLY',
      nesting: 0,
      readOnly: false,
    });
    expect(seen[0]!.ranges[0]!.partName).toBe('/word/document.xml');
    expect(seen[0]!.addresses[0]).toEqual({
      id: '1',
      author: 'Alice',
      date: '2026-01-01T00:00:00Z',
    });
    expect(result.map((piece) => piece.text)).toEqual(['EARLY', 'LATE']);
    expect(result[0]!.revisions).toBeUndefined();
    expect(result[1]!.revisions?.[0]?.author).toBe('Bob');
  });

  test('re-evaluates the same predicate after its captured state changes', () => {
    const part = load(
      `<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}${insertion(
        '2',
        'Bob',
        '2026-01-01T00:00:00Z',
        'TWO'
      )}</w:p>`
    );
    const visibility = createRevisionAuthorVisibility();
    let author = 'Alice';
    const predicate = (revision: ReviewRevisionItem): boolean => revision.author === author;
    visibility.setTrackedChangePredicate(predicate);
    const items = revisionItemsOf(part);
    expect(
      pieces(part, visibility.filterFor(items)).map((piece) => piece.revisions?.[0]?.author)
    ).toEqual(['Alice', undefined]);

    author = 'Bob';
    visibility.setTrackedChangePredicate(predicate);
    expect(
      pieces(part, visibility.filterFor(items)).map((piece) => piece.revisions?.[0]?.author)
    ).toEqual([undefined, 'Bob']);
  });

  test('combines an initial hidden-author filter with an all-true predicate', () => {
    const part = load(
      `<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}${insertion(
        '2',
        'Bob',
        '2026-01-01T00:00:00Z',
        'TWO'
      )}</w:p>`
    );
    const visibility = createRevisionAuthorVisibility(['Alice']);
    visibility.setTrackedChangePredicate(() => true);
    const items = revisionItemsOf(part);
    const filter = visibility.filterFor(items);

    expect(pieces(part, filter).map((piece) => piece.revisions?.[0]?.author)).toEqual([
      undefined,
      'Bob',
    ]);
    expect(
      visibility
        .filterItems(items)
        .filter((item) => item.kind === 'revision')
        .map((item) => item.author)
    ).toEqual(['Bob']);
  });

  test('reuses decisions and filter identity when revision visibility is unchanged', () => {
    const part = load(`<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}</w:p>`);
    const visibility = createRevisionAuthorVisibility();
    let calls = 0;
    visibility.setTrackedChangePredicate(() => {
      calls += 1;
      return false;
    });
    const items = revisionItemsOf(part);

    const firstFilter = visibility.filterFor(items);
    const secondFilter = visibility.filterFor([...items]);

    expect(calls).toBe(1);
    expect(firstFilter).toBeDefined();
    expect(secondFilter).toBe(firstFilter);
  });

  test('keeps the last complete filter when a predicate throws', () => {
    const part = load(
      `<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}${insertion(
        '2',
        'Bob',
        '2026-01-01T00:00:00Z',
        'TWO'
      )}</w:p>`
    );
    const visibility = createRevisionAuthorVisibility();
    const items = revisionItemsOf(part);
    visibility.setTrackedChangePredicate((revision) => revision.author === 'Alice');
    visibility.filterFor(items);
    const [alice, bob] = items;
    expect(alice?.kind).toBe('revision');
    expect(bob?.kind).toBe('revision');
    if (alice?.kind !== 'revision' || bob?.kind !== 'revision') throw new Error('no revisions');
    expect(visibility.includesRevisionItem(alice)).toBe(true);
    expect(visibility.includesRevisionItem(bob)).toBe(false);

    visibility.setTrackedChangePredicate((revision) => {
      if (revision.author === 'Bob') throw new Error('predicate failed');
      return false;
    });
    expect(() => visibility.filterFor(items)).toThrow('predicate failed');
    expect(visibility.includesRevisionItem(alice)).toBe(true);
    expect(visibility.includesRevisionItem(bob)).toBe(false);
    const restored = visibility.filterFor(items);
    expect(pieces(part, restored).map((piece) => piece.revisions?.[0]?.author)).toEqual([
      'Alice',
      undefined,
    ]);
  });

  test('keeps the last complete filter when the same predicate reference throws', () => {
    const part = load(
      `<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}${insertion(
        '2',
        'Bob',
        '2026-01-01T00:00:00Z',
        'TWO'
      )}</w:p>`
    );
    const visibility = createRevisionAuthorVisibility();
    const items = revisionItemsOf(part);
    let author = 'Alice';
    let fails = false;
    const predicate = (revision: ReviewRevisionItem): boolean => {
      if (fails) throw new Error('same predicate failed');
      return revision.author === author;
    };
    visibility.setTrackedChangePredicate(predicate);
    visibility.filterFor(items);

    author = 'Bob';
    fails = true;
    visibility.setTrackedChangePredicate(predicate);
    expect(() => visibility.filterFor(items)).toThrow('same predicate failed');

    const restored = visibility.filterFor(items);
    expect(pieces(part, restored).map((piece) => piece.revisions?.[0]?.author)).toEqual([
      'Alice',
      undefined,
    ]);
  });

  test('keeps the last complete projection when a document update makes the predicate throw', () => {
    const firstPart = load(
      `<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}${insertion(
        '2',
        'Bob',
        '2026-01-01T00:00:00Z',
        'TWO'
      )}</w:p>`
    );
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate((revision) => {
      if (revision.text === 'THROW') throw new Error('document predicate failed');
      return revision.author === 'Alice';
    });
    const firstItems = revisionItemsOf(firstPart);
    visibility.filterFor(firstItems);
    const failingPart = load(
      `<w:p>${insertion('3', 'Alice', '2026-01-01T00:00:00Z', 'THROW')}</w:p>`
    );
    const failingItems = revisionItemsOf(failingPart);

    expect(() => visibility.filterFor(failingItems)).toThrow('document predicate failed');
    const fallbackItems = visibility
      .filterItems(failingItems)
      .filter((item) => item.kind === 'revision');
    expect(fallbackItems.map((item) => item.author)).toEqual(['Alice']);
    expect(fallbackItems[0]).toBe(failingItems[0]);

    const recoveredPart = load(
      `<w:p>${insertion('4', 'Carol', '2026-01-01T00:00:00Z', 'SAFE')}</w:p>`
    );
    expect(
      visibility
        .filterItems(revisionItemsOf(recoveredPart))
        .filter((item) => item.kind === 'revision')
    ).toHaveLength(0);
  });

  test('promotes comments linked to revisions rejected by the predicate', () => {
    const part = load(`<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}</w:p>`);
    const revision = revisionItemsOf(part)[0]!;
    const comment: ReviewCommentItem = {
      kind: 'comment',
      id: 'comment-1',
      comment: { id: '1', author: 'Reviewer', blocks: [] },
      range: revision.ranges[0]!,
      resolved: false,
      parentRevisionId: revision.id,
      replyIds: [],
      orphaned: false,
    };
    const items = [revision, comment];
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate(() => false);

    const filtered = visibility.filterItems(items);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ kind: 'comment', id: 'comment-1' });
    expect(filtered[0]).not.toHaveProperty('parentRevisionId');
    expect(visibility.filterItems(items)).toBe(filtered);
  });

  test('repairs comment threads when an author filter removes either side of a reply', () => {
    const comment = (
      id: string,
      author: string,
      links: Pick<ReviewCommentItem, 'parentId' | 'replyIds'>
    ): ReviewCommentItem => ({
      kind: 'comment',
      id,
      comment: { id, author, blocks: [] },
      range: null,
      resolved: false,
      orphaned: true,
      ...links,
    });

    const visibleHead = comment('head', 'Visible', { replyIds: ['hidden-child'] });
    const hiddenChild = comment('hidden-child', 'Hidden', {
      parentId: 'head',
      replyIds: [],
    });
    const hiddenHead = comment('hidden-head', 'Hidden', { replyIds: ['visible-child'] });
    const visibleChild = comment('visible-child', 'Visible', {
      parentId: 'hidden-head',
      replyIds: [],
    });
    const visibility = createRevisionAuthorVisibility(['Hidden']);

    const items = [visibleHead, hiddenChild, hiddenHead, visibleChild];
    const filtered = visibility.filterItems(items);

    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toMatchObject({ id: 'head', replyIds: [] });
    expect(filtered[1]).toMatchObject({ id: 'visible-child' });
    expect(filtered[1]).not.toHaveProperty('parentId');
    expect(filtered[1]).not.toHaveProperty('parentRevisionId');
    expect(visibility.filterItems(items)).toBe(filtered);
  });

  test('preserves the review-item array when every revision passes', () => {
    const part = load(`<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}</w:p>`);
    const items = revisionItemsOf(part);
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate(() => true);

    expect(visibility.filterItems(items)).toBe(items);
  });

  test('tears down the predicate projection when the filter is cleared', () => {
    const part = load(`<w:p>${insertion('1', 'Alice', '2026-01-01T00:00:00Z', 'ONE')}</w:p>`);
    const items = revisionItemsOf(part);
    const revision = items[0]!;
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate(() => false);
    visibility.filterFor(items);
    expect(visibility.includesRevisionItem(revision)).toBe(false);

    visibility.setTrackedChangePredicate(null);

    expect(visibility.includesRevisionItem(revision)).toBe(true);
    expect(visibility.filterItems(items)).toBe(items);
    expect(pieces(part, visibility.filterFor(items))[0]!.revisions?.[0]?.author).toBe('Alice');
  });

  test('uses exact sites when format decisions share an address', () => {
    const address = 'w:id="5" w:author="Alice" w:date="2026-01-01T00:00:00Z"';
    const part = load(
      `<w:p><w:pPr><w:pPrChange ${address}><w:pPr/></w:pPrChange></w:pPr>${run(
        'TEXT',
        `<w:rPrChange ${address}><w:rPr/></w:rPrChange>`
      )}</w:p>`
    );
    const items = revisionItemsOf(part).filter((item) => item.revisionKind === 'format');
    expect(items).toHaveLength(2);
    const rejected = items[0]!;
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate((revision) => revision !== rejected);
    const filter = visibility.filterFor(items);

    const states = collectRevisionSites(part)
      .filter((site) => site.propertyChange)
      .map((site) => filter?.includesNode?.(site.node.id, 'Alice'));
    expect(states.sort()).toEqual([false, true]);
  });

  test('uses exact sites when paragraph-mark directions share an address', () => {
    const address = 'w:id="6" w:author="Alice" w:date="2026-01-01T00:00:00Z"';
    const part = load(
      `<w:p><w:pPr><w:rPr><w:ins ${address}/><w:del ${address}/></w:rPr></w:pPr>${run(
        'TEXT'
      )}</w:p>`
    );
    const items = revisionItemsOf(part).filter((item) => item.revisionKind === 'paragraphMark');
    expect(items).toHaveLength(2);
    const rejected = items.find((item) => item.markDirection === 'delete')!;
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate((revision) => revision !== rejected);
    const filter = visibility.filterFor(items);

    const states = collectRevisionSites(part)
      .filter((site) => site.paragraphMark)
      .map((site) => filter?.includesNode?.(site.node.id, 'Alice'));
    expect(states.sort()).toEqual([false, true]);
  });

  test('keeps author-only filtering independent of review derivation', () => {
    const visibility = createRevisionAuthorVisibility(['Alice']);
    const filter = visibility.filterForSession({
      reviewItems: () => {
        throw new Error('review derivation ran');
      },
    });

    expect(filter?.hiddenAuthors.has('Alice')).toBe(true);
  });

  test('removes rejected formatting attribution but keeps applied formatting', () => {
    const change =
      '<w:rPrChange w:id="4" w:author="Alice" w:date="2026-04-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange>';
    const part = load(`<w:p>${run('FORMATTED', `<w:b/>${change}`)}</w:p>`);
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate((revision) => revision.revisionKind !== 'format');
    const [piece] = pieces(part, visibility.filterFor(revisionItemsOf(part)));

    expect(piece!.style.bold).toBe(true);
    expect(piece!.props.some((property) => property.localName === 'rPrChange')).toBe(false);
  });

  test('keeps identical revision addresses isolated by story part', () => {
    const body = load(`<w:p>${insertion('7', 'Alice', '2026-01-01T00:00:00Z', 'BODY')}</w:p>`);
    const headerResult = readOoxmlPart(
      `<w:hdr xmlns:w="${W}"><w:p>${insertion(
        '7',
        'Alice',
        '2026-01-01T00:00:00Z',
        'HEADER'
      )}</w:p></w:hdr>`,
      { name: '/word/header1.xml', contentType: 'app/xml' }
    );
    if (!headerResult.ok) throw new Error(headerResult.reason);
    const header = headerResult.part;
    const items = [...revisionItemsOf(body), ...revisionItemsOf(header)];
    const visibility = createRevisionAuthorVisibility();
    visibility.setTrackedChangePredicate(
      (revision) => revision.ranges[0]?.partName === '/word/document.xml'
    );
    const filter = visibility.filterFor(items);

    expect(pieces(body, filter)[0]!.revisions?.[0]?.author).toBe('Alice');
    expect(pieces(header, filter)[0]!.revisions).toBeUndefined();
  });
});
