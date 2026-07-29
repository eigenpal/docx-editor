// Reusing measured and broken paragraphs across revisions (task 9.2).
//
// The differential test is the one that matters: a cached layout must be INDISTINGUISHABLE
// from a full one. A cache that is merely fast is worthless if the geometry it serves has
// drifted from what the document says — the caret lands where no glyph is, and it looks
// correct until someone types.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/engine-core';
import {
  createFixedMeasurer,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  linesOf,
  paragraphLayoutKey,
  type PageGeometry,
} from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 200,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const MANY = Array.from({ length: 12 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(12)}`)
).join('');

type Cache = ReturnType<typeof createParagraphLayoutCache<never>>;

const lay = (part: OoxmlPart, revision: number, cache?: Cache) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    geometry: GEOMETRY,
    ...(cache ? { cache: cache as never } : {}),
  });

/** Geometry only, so two layouts can be compared without comparing revision stamps. */
const geometryOf = (part: OoxmlPart, revision: number, cache?: Cache) =>
  JSON.stringify(
    lay(part, revision, cache).pages.map((page) => ({
      box: page.box,
      fragments: page.fragments.map((fragment) => ({
        id: fragment.id,
        box: fragment.box,
        lines: fragment.lines.map((line) => ({ box: line.box, spans: line.spans })),
      })),
    }))
  );

describe('a cached layout is identical to a full one (task 9.2)', () => {
  test('the same document laid out twice is byte-identical through the cache', () => {
    const part = load(MANY);
    const cache = createParagraphLayoutCache<never>();
    const cold = geometryOf(part, 1, cache);
    const warm = geometryOf(part, 2, cache);
    expect(warm).toBe(cold);
    expect(cache.stats.hits).toBeGreaterThan(0);
  });

  test('a cached run matches an UNCACHED one, so reuse cannot hide a difference', () => {
    const part = load(MANY);
    const cache = createParagraphLayoutCache<never>();
    geometryOf(part, 1, cache);
    expect(geometryOf(part, 2, cache)).toBe(geometryOf(part, 2));
  });

  test('an edited paragraph is re-measured while the others are reused', () => {
    const cache = createParagraphLayoutCache<never>();
    geometryOf(load(MANY), 1, cache);
    const before = cache.stats.misses;

    // One paragraph's text changes; every other key is unchanged.
    const edited = MANY.replace('paragraph 5', 'paragraph five, now longer than it was');
    geometryOf(load(edited), 2, cache);
    // Exactly one paragraph missed — the edited one.
    expect(cache.stats.misses - before).toBe(1);
  });

  test('editing high in the document still repaginates everything below it', () => {
    // Only the BREAK is cached; placement is always redone. Otherwise a paragraph that
    // shifted onto the next page would keep the geometry it had on the previous one.
    const cache = createParagraphLayoutCache<never>();
    const original = load(MANY);
    geometryOf(original, 1, cache);
    const grown = load(MANY.replace(paragraph('paragraph 0 ' + 'word '.repeat(12)), paragraph(`paragraph 0 ${'word '.repeat(120)}`)));
    const warm = geometryOf(grown, 2, cache);
    expect(warm).toBe(geometryOf(grown, 2));
    expect(warm).not.toBe(geometryOf(original, 3));
  });
});

describe('the cache key covers every input that can change a break (task 9.2)', () => {
  const part = load(paragraph('hello world'));
  const paragraphNode = (() => {
    const body = part.root.children.find((child) => child.kind === 'body')!;
    return body.children.find((child) => child.kind === 'paragraph')!;
  })();
  const base = { paragraph: paragraphNode, properties: [], width: 100, producer: 'p1' };

  test('a narrower column is a different key, because the text breaks differently', () => {
    expect(paragraphLayoutKey({ ...base, width: 50 })).not.toBe(paragraphLayoutKey(base));
  });

  test('a different producer is a different key, so fonts arriving later invalidate', () => {
    // A font loading after first paint changes every advance while no content changes.
    expect(paragraphLayoutKey({ ...base, producer: 'p2' })).not.toBe(paragraphLayoutKey(base));
  });

  test('paragraph properties are part of the key, since they decide the indents', () => {
    expect(
      paragraphLayoutKey({ ...base, properties: [{ localName: 'ind', attributes: { left: '720' } }] })
    ).not.toBe(paragraphLayoutKey(base));
  });

  test('the same inputs give the same key, whatever order attributes arrive in', () => {
    const a = paragraphLayoutKey({
      ...base,
      properties: [{ localName: 'ind', attributes: { left: '720', right: '360' } }],
    });
    const b = paragraphLayoutKey({
      ...base,
      properties: [{ localName: 'ind', attributes: { right: '360', left: '720' } }],
    });
    expect(a).toBe(b);
  });

  test('a run property change is a different key even with identical text', () => {
    const bold = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>hello world</w:t></w:r></w:p>');
    const body = bold.root.children.find((child) => child.kind === 'body')!;
    const boldParagraph = body.children.find((child) => child.kind === 'paragraph')!;
    expect(paragraphLayoutKey({ ...base, paragraph: boldParagraph })).not.toBe(
      paragraphLayoutKey(base)
    );
  });

  test('the revision is NOT part of the key, or nothing would ever be reused', () => {
    const cache = createParagraphLayoutCache<never>();
    const document = load(MANY);
    geometryOf(document, 1, cache);
    const misses = cache.stats.misses;
    geometryOf(document, 99, cache);
    expect(cache.stats.misses).toBe(misses);
  });
});

describe('the cache is bounded and self-pruning (task 9.2)', () => {
  test('it evicts least-recently-used entries past its limit', () => {
    const cache = createParagraphLayoutCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a'); // 'a' is now the most recent, so 'b' is next to go
    cache.set('c', '3');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });

  test('a deleted paragraph does not linger in the cache', () => {
    const cache = createParagraphLayoutCache<never>();
    geometryOf(load(MANY), 1, cache);
    const full = cache.stats.size;
    geometryOf(load(paragraph('only one left')), 2, cache);
    expect(cache.stats.size).toBeLessThan(full);
    expect(cache.stats.size).toBe(1);
  });

  test('it never grows past its limit however many states are touched', () => {
    const cache = createParagraphLayoutCache<never>({ maxEntries: 4 });
    for (let step = 0; step < 40; step += 1) {
      geometryOf(load(paragraph(`typing ${'x'.repeat(step)}`)), step + 1, cache);
    }
    expect(cache.stats.size).toBeLessThanOrEqual(4);
  });
});
