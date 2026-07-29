// Resuming placement and reconverging with the previous layout (tasks 9.3, 9.6).
//
// Every test here is differential: an incremental pass must produce EXACTLY what a clean
// pass produces. An incremental engine that is merely fast is a liability — it shows
// geometry for a document that no longer exists, and it looks right until someone types.
//
// Work is asserted with structural counters (paragraphs placed, pages reused), never with
// wall-clock timings, which measure the machine rather than the algorithm.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/engine-core';
import {
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  type LayoutSession,
  type PageGeometry,
  type SemanticLayout,
} from '../index.ts';

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
  height: 120,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Long enough to span several pages, so a mid-document edit has a real tail to reuse. */
const DOCUMENT = Array.from({ length: 24 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(6)}`)
).join('');

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession): SemanticLayout =>
  layoutSemanticDocument(part, revision, {
    measurer,
    geometry: GEOMETRY,
    ...(session ? { session } : {}),
  });

/** Records only, so two layouts compare without their revision stamps getting in the way. */
const shapeOf = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) => ({
      index: page.index,
      box: page.box,
      fragments: page.fragments.map((fragment) => ({
        id: fragment.id,
        box: fragment.box,
        lines: fragment.lines.map((line) => ({ id: line.id, box: line.box, spans: line.spans })),
      })),
    }))
  );

describe('an incremental pass equals a clean one (tasks 9.3, 9.6)', () => {
  test('an unchanged document re-lays out to the identical shape', () => {
    const session = createLayoutSession();
    const part = load(DOCUMENT);
    const first = lay(part, 1, session);
    const second = lay(part, 2, session);
    expect(shapeOf(second)).toBe(shapeOf(first));
  });

  test('an edit in the MIDDLE gives the same shape as a full pass', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const edited = load(DOCUMENT.replace('paragraph 12 ', 'paragraph twelve, rewritten '));
    expect(shapeOf(lay(edited, 2, session))).toBe(shapeOf(lay(edited, 2)));
  });

  test('an edit that changes the PAGE COUNT still matches a full pass', () => {
    // The case a naive suffix reuse gets wrong: everything below shifts by a page, so the
    // tail cannot be reused however unchanged its content is.
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const grown = load(DOCUMENT.replace('paragraph 3 ', `paragraph 3 ${'more words '.repeat(40)}`));
    expect(shapeOf(lay(grown, 2, session))).toBe(shapeOf(lay(grown, 2)));
  });

  test('inserting a paragraph matches a full pass', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const inserted = load(DOCUMENT.replace(paragraph('paragraph 5 word word word word word word '), paragraph('paragraph 5 word word word word word word ') + paragraph('inserted')));
    expect(shapeOf(lay(inserted, 2, session))).toBe(shapeOf(lay(inserted, 2)));
  });

  test('deleting the first paragraph matches a full pass', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const shortened = load(
      DOCUMENT.replace(paragraph('paragraph 0 word word word word word word '), '')
    );
    expect(shapeOf(lay(shortened, 2, session))).toBe(shapeOf(lay(shortened, 2)));
  });

  test('a geometry change is a full pass, not a resume from a stale flow', () => {
    const session = createLayoutSession();
    const part = load(DOCUMENT);
    lay(part, 1, session);
    const narrow: PageGeometry = { ...GEOMETRY, width: 200 };
    const incremental = layoutSemanticDocument(part, 2, {
      measurer,
      geometry: narrow,
      session,
    });
    const clean = layoutSemanticDocument(part, 2, { measurer, geometry: narrow });
    expect(shapeOf(incremental)).toBe(shapeOf(clean));
    expect(session.stats.placed).toBe(session.stats.total);
  });
});

describe('work is bounded, measured structurally (tasks 9.3, 9.6)', () => {
  test('an unchanged document places NOTHING and reuses every page', () => {
    const session = createLayoutSession();
    const part = load(DOCUMENT);
    const first = lay(part, 1, session);
    expect(session.stats.placed).toBe(session.stats.total);
    lay(part, 2, session);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(first.pages.length);
  });

  test('an edit near the END places only the tail, not the document', () => {
    const session = createLayoutSession();
    lay(load(DOCUMENT), 1, session);
    const total = session.stats.total;
    lay(load(DOCUMENT.replace('paragraph 22 ', 'paragraph twenty-two ')), 2, session);
    expect(session.stats.placed).toBeLessThan(total);
    expect(session.stats.placed).toBeLessThanOrEqual(2);
  });

  test('an edit near the START reuses the tail once the flow reconverges', () => {
    // A short edit that does not move anything: the paragraphs below keep their positions,
    // so the flow returns to exactly where it was and the rest is carried over.
    const session = createLayoutSession();
    const first = lay(load(DOCUMENT), 1, session);
    lay(load(DOCUMENT.replace('paragraph 1 ', 'paragraph A ')), 2, session);
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    expect(session.stats.reusedPages).toBeLessThanOrEqual(first.pages.length);
  });

  test('unchanged pages keep their IDENTITY, so a consumer can skip repainting them', () => {
    const session = createLayoutSession();
    const before = lay(load(DOCUMENT), 1, session);
    const after = lay(load(DOCUMENT.replace('paragraph 20 ', 'paragraph twenty ')), 2, session);
    // Not merely equal — the same objects.
    expect(after.pages[0]).toBe(before.pages[0]);
    expect(after.pages[1]).toBe(before.pages[1]);
  });

  test('a changed page is a NEW object, so identity cannot mean "unchanged" falsely', () => {
    const session = createLayoutSession();
    const before = lay(load(DOCUMENT), 1, session);
    const after = lay(load(DOCUMENT.replace('paragraph 0 ', 'paragraph zero ')), 2, session);
    expect(after.pages[0]).not.toBe(before.pages[0]);
  });
});

describe('the cache and the session compose (tasks 9.2, 9.3)', () => {
  test('a resumed pass does not evict the prefix it skipped', () => {
    // The prefix is never visited, so a cache pruned by "what this pass touched" would
    // throw it away and make the next full pass measure the whole document again.
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<never>();
    const options = { measurer, geometry: GEOMETRY, cache: cache as never, session };
    layoutSemanticDocument(load(DOCUMENT), 1, options);
    const size = cache.stats.size;
    layoutSemanticDocument(load(DOCUMENT.replace('paragraph 22 ', 'paragraph X ')), 2, options);
    expect(cache.stats.size).toBe(size);
  });

  test('together they still produce exactly what a clean pass produces', () => {
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<never>();
    layoutSemanticDocument(load(DOCUMENT), 1, { measurer, geometry: GEOMETRY, cache: cache as never, session });
    const edited = load(DOCUMENT.replace('paragraph 9 ', 'paragraph nine, longer than before '));
    const incremental = layoutSemanticDocument(edited, 2, {
      measurer,
      geometry: GEOMETRY,
      cache: cache as never,
      session,
    });
    expect(shapeOf(incremental)).toBe(shapeOf(lay(edited, 2)));
  });
});
