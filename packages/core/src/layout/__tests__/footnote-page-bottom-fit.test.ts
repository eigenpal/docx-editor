// Footnote budgets at the page bottom: the note area may use the last line's trailing
// line-spacing depth, and a held-out reference keeps only its own line off the page.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { collectNoteReferences } from '../../store/package/note-references.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';
import { bodyOnlyPage } from '../note-fragment-geometry.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { footnoteReservesEqual } from '../note-reserves.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

interface Probe {
  /** Labeled body lines, each ended by a manual break; one paragraph unless `paragraphs`. */
  readonly lines: number;
  /** Line counts per paragraph (summing to `lines`), with their keep properties. */
  readonly paragraphs?: readonly {
    readonly lines: number;
    readonly keepNext?: boolean;
    readonly widowControl?: boolean;
  }[];
  /** Body line number (1-based) → footnote ids referenced at its end. */
  readonly refs: Readonly<Record<number, readonly number[]>>;
  /** Footnote id → number of 10 pt lines. */
  readonly notes: Readonly<Record<number, number>>;
  readonly widowControl?: boolean;
}

function probeDocx(probe: Probe): Uint8Array {
  const run = (content: string, props = '') =>
    `<w:r><w:rPr>${props}<w:sz w:val="24"/></w:rPr>${content}</w:r>`;
  const paragraphs = probe.paragraphs ?? [
    { lines: probe.lines, widowControl: probe.widowControl === true },
  ];
  let line = 0;
  const body = paragraphs
    .map((paragraph) => {
      const runs: string[] = [];
      for (let index = 0; index < paragraph.lines; index += 1) {
        line += 1;
        runs.push(run(`<w:t xml:space="preserve">L${String(line).padStart(2, '0')} text</w:t>`));
        for (const id of probe.refs[line] ?? []) {
          runs.push(
            run(`<w:footnoteReference w:id="${id}"/>`, '<w:vertAlign w:val="superscript"/>')
          );
        }
        if (index < paragraph.lines - 1) runs.push(run('<w:br/>'));
      }
      const keeps =
        (paragraph.keepNext ? '<w:keepNext/>' : '') +
        (paragraph.widowControl === true ? '' : '<w:widowControl w:val="0"/>');
      return (
        `<w:p><w:pPr>${keeps}<w:spacing w:after="0" w:line="480" w:lineRule="auto"/>` +
        `<w:rPr><w:sz w:val="24"/></w:rPr></w:pPr>${runs.join('')}</w:p>`
      );
    })
    .join('');
  const noteParagraph = (content: string) =>
    `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${content}</w:p>`;
  const noteBody = (id: number, count: number) =>
    noteParagraph(
      Array.from(
        { length: count },
        (_, i) =>
          `${i > 0 ? '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:br/></w:r>' : ''}` +
          `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">N${id} ${i + 1}</w:t></w:r>`
      ).join('')
    );
  const notes = Object.entries(probe.notes)
    .map(([id, count]) => `<w:footnote w:id="${id}">${noteBody(Number(id), count)}</w:footnote>`)
    .join('');
  const entries: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${noteParagraph('<w:r><w:separator/></w:r>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${noteParagraph('<w:r><w:continuationSeparator/></w:r>')}</w:footnote>${notes}</w:footnotes>`,
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
}

function layoutProbe(probe: Probe): SemanticLayout {
  return runProbe(probe).layout;
}

function runProbe(probe: Probe) {
  const loaded = readOoxmlPackage(probeDocx(probe));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer();
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    documentFootnoteProps: fn,
    footnotePropsBySection: [fn],
    documentEndnoteProps: en,
    endnotePropsBySection: [en],
    measurer,
    producer: 'footnote-page-bottom-fit-test',
  };
  const session = createLayoutSession();
  const layout = layoutSemanticDocument(part, 1, { measurer, notes, session });
  return { part, notes, session, layout };
}

/**
 * The published reserves are the reflow loop's fixed point: recomputed over the final body,
 * they come back unchanged and stable. An orbit the loop cut short fails this.
 */
function expectFixedPoint(probe: Probe): void {
  const { part, notes, session, layout } = runProbe(probe);
  const used = session.notePageBottomReserves!;
  const refs = collectNoteReferences(part);
  const hits = buildPageRefHits(refs, new Map(refs.map((ref) => [ref.paragraphId, 0])));
  const body = { ...layout, pages: layout.pages.map(bodyOnlyPage) };
  const computed = computeFootnoteReserves(
    body,
    hits,
    notes,
    provisionalNoteMarks(hits, notes),
    undefined,
    used
  );
  expect(computed.stable).toBe(true);
  expect(footnoteReservesEqual(computed.reserves, used)).toBe(true);
}

/** `L01..L16 | 1 2c` — first and last body line, then note ids (`c` marks a continuation). */
function summary(page: PageRecord): string {
  const labels = page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) =>
          line.spans
            .map((span) => span.text)
            .join('')
            .slice(0, 3)
        )
      : []
  );
  const notes = (page.footnotes?.notes ?? []).map(
    (note) => `${note.noteId}${note.continuation ? 'c' : ''}`
  );
  return `${labels[0] ?? '-'}..${labels[labels.length - 1] ?? '-'}${notes.length ? ` | ${notes.join(' ')}` : ''}`;
}

const pages = (probe: Probe) => layoutProbe(probe).pages.map(summary);

/** 1-based body line number → 0-based page index, read off the painted labels. */
function linePages(layout: SemanticLayout): Map<number, number> {
  const pagesByLine = new Map<number, number>();
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        const label = /^L(\d+)/.exec(line.spans.map((span) => span.text).join(''));
        if (label) pagesByLine.set(Number(label[1]), page.index);
      }
    }
  }
  return pagesByLine;
}

/**
 * Every note starts whole on its reference's page — nothing split, carried, or missing —
 * and every reference line's full box ends above its page's note area.
 */
function expectNotesWithReferences(probe: Probe, layout = layoutProbe(probe)): void {
  expectFixedPoint(probe);
  const pageOfLine = linePages(layout);
  const placed = new Map<number, number[]>();
  for (const page of layout.pages) {
    for (const note of page.footnotes?.notes ?? []) {
      expect(note.continuation).toBeFalsy();
      placed.set(note.noteId, [...(placed.get(note.noteId) ?? []), page.index]);
    }
  }
  for (const [line, ids] of Object.entries(probe.refs)) {
    const page = layout.pages[pageOfLine.get(Number(line))!]!;
    for (const id of ids) expect(placed.get(id)).toEqual([page.index]);
    const area = page.footnotes!;
    const refLine = page.fragments
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .find((entry) =>
        entry.spans.some((span) => span.text.startsWith(`L${line.padStart(2, '0')}`))
      )!;
    expect(refLine.box.y + refLine.box.height).toBeLessThanOrEqual(
      area.box.y - page.contentBox.y + 0.001
    );
  }
}

describe('footnote area beside the last line trailing spacing', () => {
  // US Letter, 1 in margins: 648 pt of body. Body lines are 30.55 pt double-spaced boxes
  // whose glyph band ends 15.27 pt above the box; each note line is 12.73 pt.
  test('a note fits whole when the last line leaves room below its glyph band', () => {
    // 17 note lines: the area rises above L14's box bottom but stays below its glyph band.
    const probe: Probe = { lines: 30, refs: { 1: [1] }, notes: { 1: 17 } };
    const layout = layoutProbe(probe);
    expect(layout.pages.map(summary)).toEqual(['L01..L14 | 1', 'L15..L30']);
    const page = layout.pages[0]!;
    const fragment = page.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    const last = fragment.lines[fragment.lines.length - 1]!;
    const areaTop = page.footnotes!.box.y - page.contentBox.y;
    expect(areaTop).toBeLessThan(last.box.y + last.box.height);
    expect(areaTop).toBeGreaterThanOrEqual(
      last.box.y + last.box.height - (last.trailingSpacing ?? 0)
    );
    expectNotesWithReferences(probe, layout);
  });

  test('a first-page note never continues onto later body-only pages', () => {
    const probe: Probe = { lines: 70, refs: { 1: [1] }, notes: { 1: 10 } };
    const layout = layoutProbe(probe);
    expect(layout.pages.map(summary)).toEqual(['L01..L17 | 1', 'L18..L38', 'L39..L59', 'L60..L70']);
    expectNotesWithReferences(probe, layout);
  });

  test('a reference line whose glyph band fits but whose box does not moves with its note', () => {
    // With L15 kept, notes 1 and 2 would start 1.09 pt above L15's box bottom and
    // 14.18 pt below its glyph band. The reference line needs its whole box.
    const probe: Probe = { lines: 30, refs: { 1: [1], 15: [2] }, notes: { 1: 13, 2: 1 } };
    expect(pages(probe)).toEqual(['L01..L14 | 1', 'L15..L30 | 2']);
    expectNotesWithReferences(probe);
  });

  test('a reference line that fits by neither box nor glyph band moves with its note', () => {
    const probe: Probe = { lines: 30, refs: { 1: [1], 15: [2] }, notes: { 1: 15, 2: 1 } };
    expect(pages(probe)).toEqual(['L01..L14 | 1', 'L15..L30 | 2']);
    expectNotesWithReferences(probe);
  });
});

describe('footnote hold-out keeps only the reference line out', () => {
  test('reference-free lines return in front of a reference whose note cannot', () => {
    // An earlier round lays page 2 out under page 1's first-pass reserve; the reference on
    // L40 then opens page 3. Page 2 fills exactly as it does without that reference.
    const control: Probe = { lines: 70, refs: { 1: [1] }, notes: { 1: 8 } };
    const probe: Probe = { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 8, 2: 4 } };
    expect(pages(control).slice(0, 2)).toEqual(['L01..L17 | 1', 'L18..L38']);
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L38', 'L39..L57 | 2', 'L58..L70']);
    expectNotesWithReferences(probe);
  });

  test('the line above a held reference line returns on its own', () => {
    const probe: Probe = { lines: 70, refs: { 1: [1], 38: [2] }, notes: { 1: 8, 2: 4 } };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L37', 'L38..L56 | 2', 'L57..L70']);
    expectNotesWithReferences(probe);
  });

  test('a keep-with-next heading returns with the two lines orphan control needs', () => {
    // L35 is a `w:keepNext` heading; L36-L45 a widow-controlled paragraph with its
    // reference on L38. The heading and L36-L37 return; L38 opens page 3.
    const probe: Probe = {
      lines: 45,
      paragraphs: [
        { lines: 34 },
        { lines: 1, keepNext: true, widowControl: true },
        { lines: 10, widowControl: true },
      ],
      refs: { 1: [1], 38: [2] },
      notes: { 1: 8, 2: 12 },
    };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L37', 'L38..L45 | 2']);
    expectNotesWithReferences(probe);
  });

  test('a keep-with-next heading stays when only one line of its paragraph could return', () => {
    // The reference sits on the paragraph's second line, so one line could return ahead of
    // it: orphan control refuses that, and the heading stays with its paragraph. L36, the
    // preceding paragraph's last line, still returns.
    const probe: Probe = {
      lines: 47,
      paragraphs: [
        { lines: 36 },
        { lines: 1, keepNext: true, widowControl: true },
        { lines: 10, widowControl: true },
      ],
      refs: { 1: [1], 39: [2] },
      notes: { 1: 8, 2: 12 },
    };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L36', 'L37..L47 | 2']);
    expectNotesWithReferences(probe);
  });

  test('the reference line returns when only a lower reference note cannot', () => {
    // L37's one-line note fits beside it on page 2; L38's ten-line note does not. The lower
    // reference stays on page 3 without keeping L37 there.
    const probe: Probe = {
      lines: 70,
      refs: { 1: [1], 37: [2], 38: [3] },
      notes: { 1: 8, 2: 1, 3: 10 },
    };
    expect(pages(probe)).toEqual(['L01..L17 | 1', 'L18..L37 | 2', 'L38..L54 | 3', 'L55..L70']);
    expectNotesWithReferences(probe);
  });

  test('a widow pair returns only when both of its notes fit', () => {
    // Widow control ties L17, the penultimate line of a continued paragraph, to L18. L17's
    // note alone would fit on page 1, but the pair brings L18's note too. Releasing L17
    // on its own note let the pair return, evicted L18, and sent both back: an orbit.
    const probe: Probe = {
      lines: 18,
      paragraphs: [{ lines: 14 }, { lines: 4, widowControl: true }],
      refs: { 1: [1], 17: [2], 18: [3] },
      notes: { 1: 4, 2: 1, 3: 4 },
    };
    expect(pages(probe)).toEqual(['L01..L16 | 1', 'L17..L18 | 2 3']);
    expectNotesWithReferences(probe);
  });
});

describe('footnote hold-out across incremental layouts', () => {
  function notesInput(loaded: Extract<ReturnType<typeof readOoxmlPackage>, { ok: true }>) {
    const fn = resolveFootnoteProperties(undefined, undefined);
    const en = resolveEndnoteProperties(undefined, undefined);
    const measurer = createFixedMeasurer();
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      producer: 'footnote-hold-out-incremental-test',
    };
    return notes;
  }

  /** Page summaries plus each note area's top, so geometry drift shows up too. */
  const shapeOf = (layout: SemanticLayout) =>
    layout.pages.map((page) => {
      const area = page.footnotes;
      return `${summary(page)}${area ? ` @${(area.box.y - page.contentBox.y).toFixed(2)}` : ''}`;
    });

  test('a warm session follows note edits to the same pages as a clean layout', () => {
    const session = createLayoutSession();
    const shapes = [
      { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 8, 2: 4 } },
      { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 10, 2: 4 } },
      { lines: 70, refs: { 1: [1], 38: [2] }, notes: { 1: 8, 2: 4 } },
      { lines: 70, refs: { 1: [1], 37: [2], 38: [3] }, notes: { 1: 8, 2: 1, 3: 10 } },
    ] satisfies Probe[];
    shapes.forEach((probe, revision) => {
      const loaded = readOoxmlPackage(probeDocx(probe));
      if (!loaded.ok) throw new Error(loaded.reason);
      const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
      const notes = notesInput(loaded);
      const warm = layoutSemanticDocument(part, revision + 1, {
        measurer: notes.measurer,
        notes,
        session,
      });
      expect(shapeOf(warm)).toEqual(shapeOf(layoutProbe(probe)));
      expectNotesWithReferences(probe, warm);
    });
  });

  test('typing before a held reference keeps the warm layout equal to a clean one', () => {
    const probe: Probe = { lines: 70, refs: { 1: [1], 40: [2] }, notes: { 1: 8, 2: 4 } };
    const loaded = readOoxmlPackage(probeDocx(probe));
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
    const bodyStore = store.bodyStore();
    const notes = notesInput(loaded);
    const session = createLayoutSession();
    const warmAt = (revision: number) =>
      layoutSemanticDocument(bodyStore.part, revision, {
        measurer: notes.measurer,
        notes,
        session,
      });
    const cleanAt = (revision: number) =>
      layoutSemanticDocument(bodyStore.part, revision, { measurer: notes.measurer, notes });
    expect(shapeOf(warmAt(1))).toEqual(shapeOf(cleanAt(1)));

    const paragraph = (bodyStore.part.root.children?.[0]?.children ?? []).find(
      (node) => node.kind === 'paragraph'
    )!;
    for (const [revision, text] of [
      [2, 'x'],
      [3, 'yy'],
    ] as const) {
      const applied = bodyStore.transact((ctx) =>
        ctx.apply({ op: 'insertText', paragraphId: paragraph.id, offset: 3, text })
      );
      expect(applied.ok).toBe(true);
      const warm = warmAt(revision);
      expect(shapeOf(warm)).toEqual(shapeOf(cleanAt(revision)));
      expect(warm.pages.map(summary)).toEqual([
        'L01..L17 | 1',
        'L18..L38',
        'L39..L57 | 2',
        'L58..L70',
      ]);
    }
  });
});
