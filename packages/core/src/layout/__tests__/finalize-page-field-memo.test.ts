// `finalizePageFieldProjection` is memoized per (immutable page record, page count).
//
// Contract under test:
//   1. A memo hit returns the identical finalized record — two finalize passes over the SAME
//      page records may not mint fresh projections (that is the incremental-pass cost the memo
//      removes), and finalize over its own output is identity per page.
//   2. A memo hit returns exactly what a recompute would — a finalize of structurally identical
//      records that share nothing by identity deep-equals the memoized result.
//   3. The page count is part of the key: the same page records under a different total must
//      re-project, and flipping back must re-project again (one overwritten memo entry cannot
//      keep answering for the other count).
//
// Pages with a live `pageFieldProjector` are pre-finalize records, which `layoutSemanticDocument`
// never publishes — so the first three tests assemble them the way furniture attach does: a body
// layout's pages plus a footer story record whose projector re-lays the story per context. The
// last test drives the same memo through the public pipeline: one session, a field-bearing
// footer, and an edit that changes the page count.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageFurniture,
  type PageRecord,
  type SemanticLayout,
} from '../index.ts';
import {
  carryStrippedPageFieldProjection,
  finalizePageFieldProjection,
} from '../field-projection.ts';
import { layoutHeaderFooterStory, type HeaderFooterStoryLayout } from '../hf-layout.ts';
import type { HeaderFooterStoryRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
/** Section content width in points: 6000 − 200 − 200 twips. */
const CONTENT_WIDTH = 280;

/** Tight page geometry so a handful of one-line paragraphs already spills across pages. */
const tightSectPr =
  `<w:sectPr><w:pgSz w:w="6000" w:h="2400"/>` +
  `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>` +
  `</w:sectPr>`;

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const filler = (count: number, tag = 'f') =>
  Array.from({ length: count }, (_, i) => `<w:p><w:r><w:t>${tag} ${i}</w:t></w:r></w:p>`).join('');

/** Footer part carrying both PAGE and NUMPAGES so every finalize pass has real work. */
function footerPart(): OoxmlPart {
  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${instr}</w:instrText>` +
    `<w:fldChar w:fldCharType="separate"/><w:t>0</w:t><w:fldChar w:fldCharType="end"/></w:r>`;
  const result = readOoxmlPart(
    `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}` +
      `<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES')}</w:p></w:ftr>`,
    { name: '/word/footer1.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/**
 * A pre-finalize footer record: fragments from the baseline story plus the projector furniture
 * attach would install (the same shape `furnitureFor` in `semantic-layout.ts` builds).
 */
function fieldFooterRecord(part: OoxmlPart): HeaderFooterStoryRecord {
  const story = layoutHeaderFooterStory(part, CONTENT_WIDTH, measurer, 'test');
  const place = (laid: HeaderFooterStoryLayout): HeaderFooterStoryRecord => ({
    kind: 'footer',
    variant: 'default',
    partName: laid.partName,
    box: { x: 10, y: 100, width: CONTENT_WIDTH, height: laid.flowHeight },
    fragments: laid.fragments,
  });
  return {
    ...place(story),
    pageFieldProjector: (context) => place(story.withPageContext(context)),
  };
}

function footerText(layout: SemanticLayout, pageIndex: number): string {
  const story = layout.pages[pageIndex]!.footer;
  if (!story) return '';
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

const lay = (part: OoxmlPart, revision: number, session?: ReturnType<typeof createLayoutSession>) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    producer: 'test',
    ...(session ? { session } : {}),
  });

/** Multi-page body pages wearing one pre-finalize field footer each — the finalize input. */
function unfinalizedLayoutOf(
  base: SemanticLayout,
  footer: HeaderFooterStoryRecord
): SemanticLayout {
  return { revision: base.revision, pages: base.pages.map((page) => ({ ...page, footer })) };
}

describe('finalizePageFieldProjection memo', () => {
  test('a second finalize over the same page records returns the identical pages', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    expect(total).toBeGreaterThan(2);
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));

    const first = finalizePageFieldProjection(unfinalized);
    // The projection really ran: every sheet shows its own PAGE and the shared NUMPAGES.
    expect(footerText(first, 0)).toBe(`Page 1 of ${total}`);
    expect(footerText(first, total - 1)).toBe(`Page ${total} of ${total}`);
    // Projected records lost their projector; the inputs still carry theirs.
    expect(first.pages[0]!.footer?.pageFieldProjector).toBeUndefined();
    expect(unfinalized.pages[0]!.footer?.pageFieldProjector).toBeDefined();

    // The memo hit: without it every projector-bearing page mints a fresh record per pass.
    const second = finalizePageFieldProjection(unfinalized);
    first.pages.forEach((page, index) => expect(second.pages[index]).toBe(page));

    // Finalize over its own output is identity per page (already-final records memo to
    // themselves), which is what lets an incremental pass keep reused sheets stable.
    const third = finalizePageFieldProjection(first);
    first.pages.forEach((page, index) => expect(third.pages[index]).toBe(page));
  });

  test('a memo hit deep-equals a finalize of structurally identical fresh records', () => {
    const bodyXml = filler(20) + tightSectPr;
    const part = partOf(bodyXml);
    const footer = footerPart();
    const unfinalized = unfinalizedLayoutOf(lay(part, 1), fieldFooterRecord(footer));

    const memoized = finalizePageFieldProjection(unfinalized);
    // Warm the memo, then read through it a second time — THIS is the result under suspicion.
    const throughMemo = finalizePageFieldProjection(unfinalized);
    memoized.pages.forEach((page, index) => expect(throughMemo.pages[index]).toBe(page));

    // The clean pass: structuredClone keeps every id and value but shares no object identity,
    // so nothing the WeakMap memoized can leak into it (same discipline as the randomized
    // store-driven oracle).
    const fresh = finalizePageFieldProjection(
      unfinalizedLayoutOf(lay(structuredClone(part), 1), fieldFooterRecord(structuredClone(footer)))
    );
    expect(fresh.pages.length).toBe(throughMemo.pages.length);
    fresh.pages.forEach((page, index) => expect(page).not.toBe(throughMemo.pages[index]));
    expect(JSON.stringify(throughMemo.pages)).toBe(JSON.stringify(fresh.pages));
  });

  test('the same page records under a different page count re-project, both ways', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));

    // Memoize every page under `total`.
    const first = finalizePageFieldProjection(unfinalized);
    expect(footerText(first, 0)).toBe(`Page 1 of ${total}`);

    // The SAME page records plus one extra sheet: sharing records across layouts of different
    // lengths is constructible directly, so this is the strongest form of the invalidation
    // assertion — a memo keyed on the record alone would keep answering `total`. The clone
    // carries its own field source; finalize reads PAGE from it, not from `index`.
    const extra: PageRecord = {
      ...unfinalized.pages[total - 1]!,
      index: total,
      pageFieldSource: { pageNumber: total + 1, sectionPageCount: total + 1 },
    };
    const grown = finalizePageFieldProjection({
      revision: 2,
      pages: [...unfinalized.pages, extra],
    });
    expect(footerText(grown, 0)).toBe(`Page 1 of ${total + 1}`);
    expect(footerText(grown, total)).toBe(`Page ${total + 1} of ${total + 1}`);
    expect(grown.pages[0]).not.toBe(first.pages[0]);

    // Back to the original length: the memo now holds `total + 1` for these records, so it
    // must re-validate and re-project rather than serve the overwritten entry.
    const shrunk = finalizePageFieldProjection(unfinalized);
    expect(footerText(shrunk, 0)).toBe(`Page 1 of ${total}`);
    expect(footerText(shrunk, total - 1)).toBe(`Page ${total} of ${total}`);
  });

  test('through the pipeline: a page-count edit updates NUMPAGES on an unchanged sheet', () => {
    // Two sections, because that is the path where reused sheets still carry projectors at
    // finalize time: the multi-section publish re-finalizes every pass, so a memo entry taken
    // under the old total is what would serve the stale value here. (A single-section resume
    // reuses already-finalized records, whose retained projectors the next describe covers.)
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map(),
      footers: new Map([
        ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
      ]),
    };
    const session = createLayoutSession();
    const build = (tail: number) =>
      partOf(
        filler(12, 's0') +
          `<w:p><w:pPr>${tightSectPr}</w:pPr><w:r><w:t>s0 end</w:t></w:r></w:p>` +
          filler(tail, 's1') +
          tightSectPr
      );
    const options = { measurer, session, sectionFurniture: [furniture, furniture] };

    const first = layoutSemanticDocument(build(6), 1, options);
    const firstTotal = first.pages.length;
    expect(firstTotal).toBeGreaterThan(2);
    expect(footerText(first, 0)).toBe(`Page 1 of ${firstTotal}`);

    // Grow section 1: section 0's sheets are untouched, so a memo that ignored the page count
    // would keep serving the stale total on them.
    const second = layoutSemanticDocument(build(26), 2, options);
    expect(second.pages.length).toBeGreaterThan(firstTotal);
    expect(footerText(second, 0)).toBe(`Page 1 of ${second.pages.length}`);

    // A count-stable pass returns the previous pages by identity — the memo hit path.
    const third = layoutSemanticDocument(build(26), 3, options);
    expect(third.pages.length).toBe(second.pages.length);
    third.pages.forEach((page, index) => expect(page).toBe(second.pages[index]!));
    expect(footerText(third, 0)).toBe(`Page 1 of ${third.pages.length}`);
  });
});

describe('single-section incremental reuse re-projects furniture page fields (#441)', () => {
  test('a reused sheet updates NUMPAGES when the page count moves, and holds identity when it does not', () => {
    // Single section, one session. The first pass finalizes and STRIPS every footer's
    // projector; a later pass reuses the finished sheets whole. Without the retained
    // projector, the reused footer kept the first pass's `of Y` text forever.
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map(),
      footers: new Map([
        ['default', layoutHeaderFooterStory(footerPart(), CONTENT_WIDTH, measurer, 'test')],
      ]),
    };
    const session = createLayoutSession();
    const build = (count: number) => partOf(filler(count) + tightSectPr);
    const options = { measurer, producer: 'test', session, furniture };

    const first = layoutSemanticDocument(build(18), 1, options);
    const firstTotal = first.pages.length;
    expect(firstTotal).toBeGreaterThan(2);
    expect(footerText(first, 0)).toBe(`Page 1 of ${firstTotal}`);

    // Grow the tail: page 1's flow is untouched, so the resume path carries its finished
    // sheet over by reference — the reuse under suspicion.
    const second = layoutSemanticDocument(build(40), 2, options);
    const secondTotal = second.pages.length;
    expect(secondTotal).toBeGreaterThan(firstTotal);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    expect(footerText(second, 0)).toBe(`Page 1 of ${secondTotal}`);
    expect(footerText(second, secondTotal - 1)).toBe(`Page ${secondTotal} of ${secondTotal}`);

    // A no-change pass keeps every sheet by identity: the retained projection context still
    // holds, so re-finalize must not mint fresh footers.
    const third = layoutSemanticDocument(build(40), 3, options);
    expect(third.pages.length).toBe(secondTotal);
    third.pages.forEach((page, index) => expect(page).toBe(second.pages[index]!));

    // Shrink back: the same reused sheets re-project down as well.
    const fourth = layoutSemanticDocument(build(18), 4, options);
    expect(fourth.pages.length).toBe(firstTotal);
    expect(footerText(fourth, 0)).toBe(`Page 1 of ${firstTotal}`);
  });

  test('a carried (remap-shifted) published story re-projects at its shifted origin', () => {
    const base = lay(partOf(filler(20) + tightSectPr), 1);
    const total = base.pages.length;
    const unfinalized = unfinalizedLayoutOf(base, fieldFooterRecord(footerPart()));
    const first = finalizePageFieldProjection(unfinalized);
    const published = first.pages[1]!.footer!;

    // What `remapPage` does to a reused published sheet: mint a Y-shifted furniture twin and
    // carry the retained projection onto it, `dy` sheets of stack away.
    const dy = 120;
    const shifted: typeof published = {
      ...published,
      box: { ...published.box, y: published.box.y + dy },
    };
    carryStrippedPageFieldProjection(published, shifted, dy);
    const withShifted = {
      revision: 2,
      pages: first.pages.map((page, index) => (index === 1 ? { ...page, footer: shifted } : page)),
    };

    // Unmoved context: the carried entry keeps the shifted record by identity.
    const held = finalizePageFieldProjection(withShifted);
    expect(held.pages[1]!.footer).toBe(shifted);

    // Moved page count: the carried projector re-projects the text AND lands the box at the
    // SHIFTED origin, not the minting pass's pre-shift one.
    const extra: PageRecord = {
      ...unfinalized.pages[total - 1]!,
      index: total,
      pageFieldSource: { pageNumber: total + 1, sectionPageCount: total + 1 },
    };
    const grown = finalizePageFieldProjection({ revision: 3, pages: [...held.pages, extra] });
    expect(footerText(grown, 1)).toBe(`Page 2 of ${total + 1}`);
    expect(grown.pages[1]!.footer!.box.y).toBe(published.box.y + dy);
  });
});
