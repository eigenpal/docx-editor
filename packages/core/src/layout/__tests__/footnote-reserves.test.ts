// Footnote bottom-reservation: body shrink, ref+note co-location, idempotent reflow.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { enumerateDocumentSections } from '../section-properties.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  layoutSemanticDocumentWithNotes,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { collectNoteReferences } from '../../store/package/note-references.ts';
import type { PageRecord, ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function bodyUsedHeight(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
}

/** Dense body so a page fills without footnote reservation; one ref + multi-line note. */
function filledPageWithFootnoteDoc(): Uint8Array {
  const bodyParas = Array.from({ length: 48 }, (_, i) => {
    const text = `Body line ${i} ${'word '.repeat(28)}`;
    if (i === 2) {
      return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
    }
    return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  }).join('');
  const noteParas = Array.from(
    { length: 6 },
    (_, i) => `<w:p><w:r><w:t>Footnote para ${i} ${'note '.repeat(20)}</w:t></w:r></w:p>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        bodyParas +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1">${noteParas}</w:footnote>` +
        '</w:footnotes>'
    ),
  });
}

function loadNotesDoc(bytes: Uint8Array): {
  part: ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P }
    ? P extends { parts: Map<string, infer Part> }
      ? Part
      : never
    : never;
  notes: NotesLayoutInput;
} {
  const loaded = readOoxmlPackage(bytes);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
  const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [documentFootnoteProps],
    endnotePropsBySection: [documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer: createFixedMeasurer(),
    producer: 'footnote-reserves-test',
  };
  return { part, notes };
}

/** Single-paragraph body with one footnote ref — enough for a controlled mock reflow. */
function singleRefFootnoteDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>Body with footnote</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Note ${'line '.repeat(12)}</w:t></w:r></w:p></w:footnote>` +
        '</w:footnotes>'
    ),
  });
}

function paraFrag(
  paragraphId: string,
  opts: { atomEnd: number; y: number; height: number; width?: number }
): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${paragraphId}-frag`,
    paragraphId,
    fragmentIndex: 0,
    box: { x: 0, y: opts.y, width: opts.width ?? 400, height: opts.height },
    range: { start: 0, end: opts.atomEnd },
    props: [],
    spacing: { before: 0, after: 0, line: null, lineRule: 'auto' },
    indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
    lines: [],
  };
}

function mockPage(
  index: number,
  fragments: readonly ParagraphFragmentRecord[],
  contentHeight: number
): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: contentHeight + 144 },
    contentBox: { x: 72, y: 72, width: 468, height: contentHeight },
    fragments,
  };
}

describe('footnote bottom reservation', () => {
  test('reference and footnote share a page; body bottom is shortened', () => {
    const { part, notes } = loadNotesDoc(filledPageWithFootnoteDoc());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'footnote-reserves-test',
    });

    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    const area = host!.footnotes!;
    expect(area.notes.some((n) => n.noteId === 1)).toBe(true);

    // Owning reference is on the same page (body fragment carries the footnote ref paragraph).
    const refParas = host!.fragments.filter((f) => f.kind === 'paragraph');
    expect(refParas.length).toBeGreaterThan(0);

    const used = bodyUsedHeight(host!);
    // Body ends at or above the footnote area — reservation shortened available body height.
    expect(used).toBeLessThanOrEqual(area.box.y - host!.contentBox.y + 0.5);
    expect(area.box.height).toBeGreaterThan(0);
    // Body does not consume the full content column once notes are reserved.
    expect(used + area.box.height).toBeLessThanOrEqual(host!.contentBox.height + 0.5);
    expect(used).toBeLessThan(host!.contentBox.height - area.box.height + 1);
  });

  test('computeFootnoteReserves is idempotent across repeated passes', () => {
    const { part, notes } = loadNotesDoc(filledPageWithFootnoteDoc());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'footnote-reserves-idempotent',
    });

    // Body-only pages (strip attached note areas) — same input the reflow loop sees.
    const bodyPages = layout.pages.map((page) => {
      const { footnotes, endnotes, noteStream, ...body } = page;
      void footnotes;
      void endnotes;
      void noteStream;
      return body;
    });
    const bodyLayout = { revision: layout.revision, pages: bodyPages };

    const packageRefs = collectNoteReferences(part).map((hit) => ({
      noteKind: hit.noteKind,
      noteId: hit.noteId,
      paragraphId: hit.paragraphId,
      atomOffset: hit.atomOffset,
      customMarkFollows: hit.customMarkFollows,
    }));
    const paragraphSectionIndex = new Map<string, number>();
    for (const ref of packageRefs) paragraphSectionIndex.set(ref.paragraphId, 0);
    const allHits = buildPageRefHits(packageRefs, paragraphSectionIndex);
    const noteMarks = provisionalNoteMarks(allHits, notes);

    const first = computeFootnoteReserves(bodyLayout, allHits, notes, noteMarks);
    const second = computeFootnoteReserves(bodyLayout, allHits, notes, noteMarks);

    expect(first.stable).toBe(true);
    expect(second.stable).toBe(first.stable);
    expect([...second.reserves.entries()]).toEqual([...first.reserves.entries()]);
    expect(second.reasons).toEqual(first.reasons);

    // A third layout pass publishes the same footnote geometry.
    const again = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'footnote-reserves-idempotent',
    });
    expect(again.pages.length).toBe(layout.pages.length);
    for (let i = 0; i < layout.pages.length; i += 1) {
      const a = layout.pages[i]!.footnotes?.box.height ?? 0;
      const b = again.pages[i]!.footnotes?.box.height ?? 0;
      expect(b).toBeCloseTo(a, 3);
      expect(bodyUsedHeight(again.pages[i]!)).toBeCloseTo(bodyUsedHeight(layout.pages[i]!), 3);
    }
  });

  test('the notes-pass memo reproduces a clean pass byte for byte', () => {
    const { part, notes } = loadNotesDoc(filledPageWithFootnoteDoc());
    const session = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-memo-oracle',
    });
    // The editor rebuilds the notes input object every pass; a content-equal rebuild must
    // hit the session memo and still publish exactly what a memo-less pass publishes.
    const rebuiltNotes: NotesLayoutInput = { ...notes };
    const incremental = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes: rebuiltNotes,
      session,
      producer: 'notes-memo-oracle',
    });
    const clean = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      producer: 'notes-memo-oracle',
    });
    expect(JSON.stringify(incremental)).toBe(JSON.stringify(clean));
  });

  test('moving a citation re-runs body so a stale prior-page reserve is dropped', () => {
    const { part, notes } = loadNotesDoc(singleRefFootnoteDoc());
    const sections = enumerateDocumentSections(part);
    const refs = collectNoteReferences(part);
    expect(refs.length).toBe(1);
    const ref = refs[0]!;
    const contentH = 400;
    const fillerId = 'filler-para';

    const reserveCalls: Array<ReadonlyMap<number, number>> = [];
    const runBody = (opts: {
      pageBottomReserves?: ReadonlyMap<number, number>;
    }): SemanticLayout => {
      const reserves = opts.pageBottomReserves ?? new Map<number, number>();
      reserveCalls.push(new Map(reserves));
      const r0 = reserves.get(0) ?? 0;
      const r1 = reserves.get(1) ?? 0;
      const refFrag = paraFrag(ref.paragraphId, {
        atomEnd: ref.atomOffset + 1,
        y: 0,
        height: 14,
      });
      const filler = paraFrag(fillerId, {
        atomEnd: 4,
        y: 0,
        height: Math.max(14, contentH - r0 - 1),
      });

      if (r0 <= 0 && r1 <= 0) {
        // Provisional: citation on page 0, body fills the column → unstable vs note height.
        return {
          revision: 1,
          pages: [
            mockPage(
              0,
              [
                paraFrag(ref.paragraphId, {
                  atomEnd: ref.atomOffset + 1,
                  y: 0,
                  height: contentH,
                }),
              ],
              contentH
            ),
          ],
        };
      }

      if (r0 > 0) {
        // Monotonic pass still carries page-0 reserve after the citation moved to page 1.
        // Publishing this layout without a shrink re-run leaves a footnote-sized hole on page 0.
        return {
          revision: 1,
          pages: [mockPage(0, [filler], contentH), mockPage(1, [refFrag], contentH)],
        };
      }

      // Exact computed reserves ({1: h} only): page 0 fills again; citation stays on page 1.
      return {
        revision: 1,
        pages: [
          mockPage(0, [paraFrag(fillerId, { atomEnd: 4, y: 0, height: contentH })], contentH),
          mockPage(1, [refFrag], contentH),
        ],
      };
    };

    const layout = layoutSemanticDocumentWithNotes(
      part,
      sections,
      { measurer: notes.measurer, producer: 'footnote-reserves-stale-drop' },
      notes,
      runBody
    );

    // Must re-run after the stable compute that dropped page 0 — not break on the stale layout.
    expect(reserveCalls.length).toBeGreaterThanOrEqual(3);
    const lastReserves = reserveCalls[reserveCalls.length - 1]!;
    expect(lastReserves.has(0)).toBe(false);
    expect(lastReserves.get(1) ?? 0).toBeGreaterThan(0);

    const page0 = layout.pages[0]!;
    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBeGreaterThan(0);
    const noteHeight = host!.footnotes?.box.height ?? 0;
    expect(noteHeight).toBeGreaterThan(10);
    // Stale page-0 reserve would leave a note-sized unused band on the prior page.
    expect(page0.contentBox.height - bodyUsedHeight(page0)).toBeLessThan(noteHeight * 0.5);
  });

  test('stale seeded reserves still re-run body and drop the abandoned page', () => {
    const { part, notes } = loadNotesDoc(singleRefFootnoteDoc());
    const sections = enumerateDocumentSections(part);
    const refs = collectNoteReferences(part);
    const ref = refs[0]!;
    const contentH = 400;
    const fillerId = 'filler-para';
    const reserveCalls: Array<ReadonlyMap<number, number>> = [];
    const session = {
      previous: null as SemanticLayout | null,
      multi: null as unknown,
      // Prior published layout reserved page 0; citation has since moved to page 1.
      notePageBottomReserves: new Map<number, number>([[0, 80]]) as ReadonlyMap<
        number,
        number
      > | null,
    };

    const runBody = (opts: {
      pageBottomReserves?: ReadonlyMap<number, number>;
    }): SemanticLayout => {
      const reserves = opts.pageBottomReserves ?? new Map<number, number>();
      reserveCalls.push(new Map(reserves));
      const r0 = reserves.get(0) ?? 0;
      const r1 = reserves.get(1) ?? 0;
      const refFrag = paraFrag(ref.paragraphId, {
        atomEnd: ref.atomOffset + 1,
        y: 0,
        height: 14,
      });
      const filler = paraFrag(fillerId, {
        atomEnd: 4,
        y: 0,
        height: Math.max(14, contentH - r0 - 1),
      });

      if (r0 > 0 && r1 <= 0) {
        return {
          revision: 1,
          pages: [mockPage(0, [filler], contentH), mockPage(1, [refFrag], contentH)],
        };
      }
      return {
        revision: 1,
        pages: [
          mockPage(0, [paraFrag(fillerId, { atomEnd: 4, y: 0, height: contentH })], contentH),
          mockPage(1, [refFrag], contentH),
        ],
      };
    };

    const layout = layoutSemanticDocumentWithNotes(
      part,
      sections,
      { session, measurer: notes.measurer, producer: 'stale-seed-drop' },
      notes,
      runBody
    );

    expect(reserveCalls.length).toBeGreaterThanOrEqual(2);
    expect(reserveCalls[0]!.has(0)).toBe(true);
    const last = reserveCalls[reserveCalls.length - 1]!;
    expect(last.has(0)).toBe(false);
    expect(last.get(1) ?? 0).toBeGreaterThan(0);
    expect(session.notePageBottomReserves!.has(0)).toBe(false);

    const page0 = layout.pages[0]!;
    const host = layout.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBeGreaterThan(0);
    const noteHeight = host!.footnotes?.box.height ?? 0;
    expect(page0.contentBox.height - bodyUsedHeight(page0)).toBeLessThan(noteHeight * 0.5);
  });
});

describe('incremental notes layout (reserve persistence)', () => {
  function multiPageFootnoteDoc(paragraphCount: number, footnoteEvery: number): Uint8Array {
    const bodyParas = Array.from({ length: paragraphCount }, (_, i) => {
      const text = `Body line ${i} ${'word '.repeat(18)}`;
      if (i > 0 && i % footnoteEvery === 0) {
        const id = Math.floor(i / footnoteEvery);
        return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    }).join('');
    const noteCount = Math.floor(paragraphCount / footnoteEvery);
    const notesXml = Array.from({ length: noteCount }, (_, i) => {
      const id = i + 1;
      return (
        `<w:footnote w:id="${id}">` +
        `<w:p><w:r><w:t>Note ${id} ${'note '.repeat(8)}</w:t></w:r></w:p>` +
        '</w:footnote>'
      );
    }).join('');
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          bodyParas +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          notesXml +
          '</w:footnotes>'
      ),
    });
  }

  function editedMultiPageFootnoteDoc(
    paragraphCount: number,
    footnoteEvery: number,
    editIndex: number
  ): Uint8Array {
    const bodyParas = Array.from({ length: paragraphCount }, (_, i) => {
      const text =
        i === editIndex
          ? `Body line ${i} EDITED ${'word '.repeat(18)}`
          : `Body line ${i} ${'word '.repeat(18)}`;
      if (i > 0 && i % footnoteEvery === 0) {
        const id = Math.floor(i / footnoteEvery);
        return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    }).join('');
    const noteCount = Math.floor(paragraphCount / footnoteEvery);
    const notesXml = Array.from({ length: noteCount }, (_, i) => {
      const id = i + 1;
      return (
        `<w:footnote w:id="${id}">` +
        `<w:p><w:r><w:t>Note ${id} ${'note '.repeat(8)}</w:t></w:r></w:p>` +
        '</w:footnote>'
      );
    }).join('');
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          bodyParas +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          notesXml +
          '</w:footnotes>'
      ),
    });
  }

  const layoutShape = (layout: SemanticLayout): string =>
    JSON.stringify(
      layout.pages.map((page) => ({
        index: page.index,
        box: page.box,
        contentBox: page.contentBox,
        fragments: page.fragments.map((f) => ({
          kind: f.kind,
          id: f.id,
          box: f.box,
          ...(f.kind === 'paragraph'
            ? { paragraphId: f.paragraphId, range: f.range, lines: f.lines.length }
            : {}),
        })),
        footnoteHeight: page.footnotes?.box.height ?? 0,
        footnoteNotes: (page.footnotes?.notes ?? []).map((n) => ({
          id: n.noteId,
          continuation: n.continuation,
        })),
      }))
    );

  test('unchanged footnote document reuses session without a second full body pass', () => {
    const { part, notes } = loadNotesDoc(multiPageFootnoteDoc(120, 20));
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-incremental-unchanged',
    });
    expect(first.pages.length).toBeGreaterThan(1);
    expect(session.notePageBottomReserves).not.toBeNull();
    expect(session.notePageBottomReserves!.size).toBeGreaterThan(0);
    const fullPassesAfterCold = session.stats.fullPasses;
    // Cold start: empty seed then reserved reflow → two full body passes.
    expect(fullPassesAfterCold).toBe(2);

    const second = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-incremental-unchanged',
    });
    expect(layoutShape(second)).toBe(layoutShape(first));
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(first.pages.length);
    // Warm pass must not run another full body pagination.
    expect(session.stats.fullPasses).toBe(fullPassesAfterCold);
  });

  test('mid-document edit with footnotes matches a clean layout and resumes', () => {
    const { part, notes } = loadNotesDoc(multiPageFootnoteDoc(120, 20));
    const session = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-incremental-edit',
    });
    const fullPassesAfterCold = session.stats.fullPasses;

    const { part: editedPart, notes: editedNotes } = loadNotesDoc(
      editedMultiPageFootnoteDoc(120, 20, 55)
    );
    const incremental = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      session,
      producer: 'notes-incremental-edit',
    });
    const clean = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      producer: 'notes-incremental-edit',
    });
    expect(layoutShape(incremental)).toBe(layoutShape(clean));
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    // Seeded reserves: the edit resumes — no extra full pass for reserve rediscovery.
    expect(session.stats.fullPasses).toBe(fullPassesAfterCold);
  });

  test('900-paragraph footnote document: warm pass is one resumed body layout', () => {
    const { part, notes } = loadNotesDoc(multiPageFootnoteDoc(900, 40));
    const session = createLayoutSession();
    const cold = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-900-bench',
    });
    expect(cold.pages.length).toBeGreaterThan(10);
    const coldFull = session.stats.fullPasses;
    expect(session.stats.placed).toBe(session.stats.total);
    expect(coldFull).toBeGreaterThanOrEqual(1);

    const warm = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-900-bench',
    });
    expect(warm.pages.length).toBe(cold.pages.length);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(cold.pages.length);
    expect(session.stats.fullPasses).toBe(coldFull);

    const sessionEdit = createLayoutSession();
    layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session: sessionEdit,
      producer: 'notes-900-edit',
    });
    const beforeEditFull = sessionEdit.stats.fullPasses;
    const { part: editedPart, notes: editedNotes } = loadNotesDoc(
      editedMultiPageFootnoteDoc(900, 40, 450)
    );
    const incremental = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      session: sessionEdit,
      producer: 'notes-900-edit',
    });
    const clean = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      producer: 'notes-900-edit',
    });
    expect(layoutShape(incremental)).toBe(layoutShape(clean));
    expect(sessionEdit.stats.placed).toBeLessThan(sessionEdit.stats.total);
    expect(sessionEdit.stats.reusedPages).toBeGreaterThan(0);
    expect(sessionEdit.stats.fullPasses).toBe(beforeEditFull);
  });
});

describe('multi-section reserve locality', () => {
  /**
   * Section 0 spans three pages and carries the one citation on its LAST page (reserve page
   * slot 2). Sections 1 and 2 are one page each, so slot 2 sits past every reserve slot
   * their passes can read — a reserve there must not enter their context keys.
   */
  function multiSectionFootnoteDoc(noteWords: number): Uint8Array {
    const sectPr =
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>';
    const section0 = Array.from({ length: 80 }, (_, i) => {
      const text = `S0 line ${i} ${'word '.repeat(18)}`;
      if (i === 75) {
        return `<w:p><w:r><w:t>${text}</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    }).join('');
    const shortSection = (label: string): string =>
      Array.from(
        { length: 4 },
        (_, i) => `<w:p><w:r><w:t>${label} line ${i} ${'word '.repeat(10)}</w:t></w:r></w:p>`
      ).join('');
    const sectionBreak = `<w:p><w:pPr><w:sectPr>${sectPr}</w:sectPr></w:pPr></w:p>`;
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          section0 +
          sectionBreak +
          shortSection('S1') +
          sectionBreak +
          shortSection('S2') +
          `<w:sectPr>${sectPr}</w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:t>Note ${'note '.repeat(noteWords)}</w:t></w:r></w:p></w:footnote>` +
          '</w:footnotes>'
      ),
    });
  }

  const layoutShape = (layout: SemanticLayout): string =>
    JSON.stringify(
      layout.pages.map((page) => ({
        index: page.index,
        box: page.box,
        contentBox: page.contentBox,
        fragments: page.fragments.map((f) => ({
          kind: f.kind,
          id: f.id,
          box: f.box,
          ...(f.kind === 'paragraph'
            ? { paragraphId: f.paragraphId, range: f.range, lines: f.lines.length }
            : {}),
        })),
        footnoteHeight: page.footnotes?.box.height ?? 0,
      }))
    );

  function notesFor(bytes: Uint8Array): ReturnType<typeof loadNotesDoc> {
    const { part, notes } = loadNotesDoc(bytes);
    const props = notes.footnotePropsBySection[0]!;
    const enProps = notes.endnotePropsBySection[0]!;
    return {
      part,
      notes: {
        ...notes,
        footnotePropsBySection: [props, props, props],
        endnotePropsBySection: [enProps, enProps, enProps],
      },
    };
  }

  test('a reserve change on section 0 relayouts only section 0; the result matches a clean pass', () => {
    const { part, notes } = notesFor(multiSectionFootnoteDoc(20));
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-section-locality',
    });
    // The reserve sits on section 0's last page (slot 2); sections 1 and 2 hold one page each.
    expect(first.pages.length).toBe(5);
    expect(session.notePageBottomReserves).not.toBeNull();
    expect([...session.notePageBottomReserves!.keys()]).toEqual([2]);
    const firstReserve = session.notePageBottomReserves!.get(2)!;
    const sectionOnePage = first.pages[3]!;
    const sectionTwoPage = first.pages[4]!;

    // The edit grows the note, so section 0's reserve height changes ({2: h} -> {2: h'}).
    const { part: editedPart, notes: editedNotes } = notesFor(multiSectionFootnoteDoc(60));
    const incremental = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      session,
      producer: 'notes-section-locality',
    });
    expect([...session.notePageBottomReserves!.keys()]).toEqual([2]);
    expect(session.notePageBottomReserves!.get(2)!).toBeGreaterThan(firstReserve);

    // Locality: the reserve change stayed inside section 0 — the other sections' pages come
    // back as the SAME records, not rebuilt twins.
    expect(incremental.pages[3]).toBe(sectionOnePage);
    expect(incremental.pages[4]).toBe(sectionTwoPage);

    // Equivalence: the sliced context key changes nothing about the layout itself.
    const clean = layoutSemanticDocument(editedPart, 2, {
      measurer: editedNotes.measurer,
      notes: editedNotes,
      producer: 'notes-section-locality',
    });
    expect(layoutShape(incremental)).toBe(layoutShape(clean));
  });

  test('open pays one full pass; the reserved reflow pass reuses every section', () => {
    const { part, notes } = notesFor(multiSectionFootnoteDoc(20));
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'notes-section-open',
    });
    expect(first.pages.length).toBe(5);
    expect(session.notePageBottomReserves!.size).toBe(1);
    // The reflow's second body pass re-places only the reserved section, so the open
    // performs exactly one FULL pass. Before the per-section reserve slice it performed two.
    expect(session.stats.fullPasses).toBe(1);
    // And the second pass really applied the reserve: the citation page keeps room for the
    // note above the page bottom.
    const host = first.pages.find((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(host).toBeTruthy();
    expect(host!.index).toBe(2);
  });
});
