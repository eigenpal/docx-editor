// A footnote reference inside a body table row keeps the band of its ROW, not of the whole
// table fragment. Notes of early rows stay on their reference page while later rows move.
// A long note splits when at least two of its lines fit below the referencing row. With
// room for fewer, the row moves to the next page with the note. Inside a row that can
// split, the note budgets below the reference line, and the rest of the row continues.
//
// The page is 350pt by 210pt with 20pt margins: a 170pt body of exact 14pt lines. The
// footnote separator and every note line are exact 14pt lines too.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createLayoutSession } from '../layout-session.ts';
import { bodyOnlyPage, noteReferenceLineBandPt } from '../note-fragment-geometry.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { footnoteReservesEqual } from '../note-reserves.ts';
import { rowContinuesOn } from '../note-table-reference-band.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { blockText, measurer, para, SECT, W } from './table-row-keep-fixtures.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EXACT = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';

/** A one-line paragraph `text`, citing footnote `note` when given. */
const cite = (text: string, note?: number, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>${EXACT}</w:pPr><w:r><w:t>${text}</w:t></w:r>` +
  (note === undefined ? '' : `<w:r><w:footnoteReference w:id="${note}"/></w:r>`) +
  '</w:p>';

const tc = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;

interface RowSpec {
  readonly name: string;
  readonly note?: number;
  readonly trPr?: string;
  /** First cell; defaults to a plain `${name}a` paragraph. */
  readonly first?: string;
  readonly firstTcPr?: string;
  /** Second cell; defaults to `${name}b`, citing `note`. */
  readonly second?: string;
  readonly secondTcPr?: string;
}

const tr = (spec: RowSpec) =>
  `<w:tr>${spec.trPr ? `<w:trPr>${spec.trPr}</w:trPr>` : ''}` +
  tc(spec.first ?? cite(`${spec.name}a`), spec.firstTcPr) +
  tc(spec.second ?? cite(`${spec.name}b`, spec.note), spec.secondTcPr) +
  '</w:tr>';

const tbl = (rows: readonly string[], tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}<w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

/** Rows `R1`..`R{count}`; `refs` maps a row number to the footnote its second cell cites. */
const rows = (
  count: number,
  refs: ReadonlyMap<number, number>,
  edit: (n: number, spec: RowSpec) => RowSpec = (_n, spec) => spec
): string[] =>
  Array.from({ length: count }, (_, i) =>
    tr(edit(i + 1, { name: `R${i + 1}`, note: refs.get(i + 1) }))
  );

function probeDocx(body: string, notes: ReadonlyMap<number, number>): Uint8Array {
  const noteXml = [...notes]
    .map(([id, lines]) => {
      const runs = Array.from({ length: lines }, (_, i) => `<w:t>N${id}-${i + 1}</w:t>`);
      return (
        `<w:footnote w:id="${id}"><w:p><w:pPr>${EXACT}</w:pPr>` +
        `<w:r><w:footnoteRef/></w:r><w:r>${runs.join('<w:br/>')}</w:r></w:p></w:footnote>`
      );
    })
    .join('');
  const separator = (type: string, tag: string) =>
    `<w:footnote w:type="${type}" w:id="${type === 'separator' ? -1 : 0}"><w:p><w:pPr>${EXACT}</w:pPr>` +
    `<w:r><w:${tag}/></w:r></w:p></w:footnote>`;
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${SECT}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${separator('separator', 'separator')}` +
        `${separator('continuationSeparator', 'continuationSeparator')}${noteXml}</w:footnotes>`
    ),
  });
}

interface Laid {
  readonly layout: SemanticLayout;
  /** The published reserves reproduce themselves from the layout they produced. */
  readonly fixedPoint: boolean;
  readonly refs: ReturnType<typeof buildPageRefHits>;
  /** The reserves the layout was laid under, by page index. */
  readonly reserves: ReadonlyMap<number, number>;
}

function layoutProbe(
  body: string,
  notes: ReadonlyMap<number, number>,
  session = createLayoutSession(),
  revision = 1
): Laid {
  const loaded = readOoxmlPackage(probeDocx(body, notes));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const input: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'footnote-table-row-bands',
  };
  const layout = layoutSemanticDocument(part, revision, {
    measurer,
    notes: input,
    session,
    producer: 'footnote-table-row-bands',
  });
  const used = session.notePageBottomReserves ?? new Map<number, number>();
  const collected = collectNoteReferences(part);
  const refs = buildPageRefHits(collected, new Map(collected.map((ref) => [ref.paragraphId, 0])));
  const computed = computeFootnoteReserves(
    { ...layout, pages: layout.pages.map(bodyOnlyPage) },
    refs,
    input,
    provisionalNoteMarks(refs, input),
    undefined,
    used
  );
  return {
    layout,
    refs,
    reserves: used,
    fixedPoint: computed.stable && footnoteReservesEqual(computed.reserves, used),
  };
}

/** `body text | notes` per page; a trailing `c` marks a note continuation. */
function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const body = page.fragments.flatMap(blockText).join(' ');
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${body} | ${notes.join(',')}`;
  });
}

/** Lines of footnote `noteId` on page `index`. */
function noteLines(layout: SemanticLayout, index: number, noteId: number): number {
  const note = layout.pages[index]?.footnotes?.notes.find((n) => n.noteId === noteId);
  return (note?.fragments ?? []).reduce(
    (sum, block) => sum + (block.kind === 'paragraph' ? block.lines.length : 0),
    0
  );
}

/** Every body line and note opening appears: no row or note is dropped or doubled. */
function expectComplete(layout: SemanticLayout, lines: readonly string[], noteIds?: number[]) {
  const painted = layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table'
        ? fragment.rows
            .filter((row) => !row.isHeaderRepeat)
            .flatMap((row) => row.cells.flatMap((c) => c.blocks.flatMap(blockText)))
        : blockText(fragment)
    )
  );
  // Sorted: a split row interleaves its cells' lines across page fragments.
  expect(painted.map(unmark).sort()).toEqual([...lines].sort());
  if (!noteIds) return;
  const opened = layout.pages.flatMap((page) =>
    (page.footnotes?.notes ?? []).filter((n) => !n.continuation).map((n) => n.noteId)
  );
  expect(opened).toEqual(noteIds);
}

/** The band of footnote `noteId`'s reference on the page that paints it. */
function bandOf(laid: Laid, noteId: number) {
  const ref = laid.refs.find((hit) => hit.noteId === noteId)!;
  for (const page of laid.layout.pages) {
    const body = bodyOnlyPage(page);
    const band = noteReferenceLineBandPt(body, ref);
    if (band.bottom > 0) {
      const table = body.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
      return { page: page.index, band, table };
    }
  }
  throw new Error(`reference ${noteId} is not on any page`);
}

/** Drops a painted footnote mark (`R2b1` -> `R2b`); note ids stay below 10 here. */
const unmark = (text: string) => text.replace(/^(R\d+b|Nb)\d$/, '$1');

const INTRO = para('INTRO', 2);
const TAIL = cite('TAIL');
const names = (count: number) =>
  Array.from({ length: count }, (_, i) => [`R${i + 1}a`, `R${i + 1}b`]).flat();

describe('footnote references in body table rows', () => {
  // Rows 2, 4, 6 and 8 cite one-line notes. Six rows and three notes fill the first page.
  const refs = new Map([
    [2, 1],
    [4, 2],
    [6, 3],
    [8, 4],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
  ]);
  const body = INTRO + tbl(rows(8, refs)) + TAIL;

  test('notes of early rows stay with their rows while later rows move', () => {
    const laid = layoutProbe(body, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b1 R3a R3b R4a R4b2 R5a R5b R6a R6b3 | 1,2,3',
      'R7a R7b R8a R8b4 TAIL | 4',
    ]);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...names(8), 'TAIL'], [1, 2, 3, 4]);
  });

  test('the band is the referencing row, in page-content coordinates', () => {
    const laid = layoutProbe(body, notes);
    const { band, table } = bandOf(laid, 2);
    const row = table.rows.find((r) => r.rowIndex === 3)!;
    expect(band.top).toBeCloseTo(row.box.y, 3);
    expect(band.bottom).toBeCloseTo(row.box.y + row.box.height, 3);
    expect(band.bottom).toBeLessThan(table.box.y + table.box.height - 1);
    expect(band.evictable).toBe(true);
  });

  test('repeated header rows move nothing but the body rows', () => {
    const laid = layoutProbe(
      INTRO +
        tbl(rows(8, refs, (n, spec) => (n === 1 ? { ...spec, trPr: '<w:tblHeader/>' } : spec))) +
        TAIL,
      notes
    );
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b1 R3a R3b R4a R4b2 R5a R5b R6a R6b3 | 1,2,3',
      'R1a R1b R7a R7b R8a R8b4 TAIL | 4',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('a row whose long note keeps two lines below it', () => {
  // Row 5 cites a four-line note. Below row 5 there is room for three note lines. The row
  // stays, and the note splits: widow control leaves two lines on each page.
  const refs = new Map([
    [1, 1],
    [5, 2],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 4],
  ]);

  test('stays, and its note continues on the next page', () => {
    const laid = layoutProbe(INTRO + tbl(rows(8, refs)) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 R6a R6b | 1,2',
      'R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...names(8), 'TAIL'], [1, 2]);
  });

  test('two lines of room are enough', () => {
    const laid = layoutProbe(para('INTRO', 3) + tbl(rows(8, refs)) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 INTRO3 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 | 1,2',
      'R6a R6b R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('the last row of a table keeps the content after the table in place', () => {
    // The referencing row ends the table, and a three-line paragraph follows it. Moving
    // the row would also move that paragraph and every page break after it.
    const laid = layoutProbe(INTRO + tbl(rows(5, refs)) + para('TAIL', 3), notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 TAIL1 | 1,2',
      'TAIL2 TAIL3 | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...names(5), 'TAIL1', 'TAIL2', 'TAIL3']);
  });

  test('a short table ending mid-page keeps its referencing row', () => {
    const laid = layoutProbe(INTRO + tbl(rows(6, refs)) + para('TAIL', 3), notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a R5b2 R6a R6b | 1,2',
      'TAIL1 TAIL2 TAIL3 | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a vertical merge in another cell does not keep the table band', () => {
    // The first column merges rows 1 through 8. The referencing cells do not merge.
    const merged = rows(8, refs, (n, spec) => ({
      ...spec,
      firstTcPr: n === 1 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>',
      first: n === 1 ? cite('M') : cite(''),
    }));
    const laid = layoutProbe(INTRO + tbl(merged) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 M R1b1 R2b R3b R4b R5b2 R6b | 1,2',
      'R7b R8b TAIL | 2c',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a reference in a nested table takes the outer row band', () => {
    const nested = rows(8, refs, (n, spec) =>
      n === 5 ? { ...spec, second: tbl([tr({ name: 'N', note: 2 })]) + cite('') } : spec
    );
    const laid = layoutProbe(INTRO + tbl(nested) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a Na Nb2 | 1,2',
      'R6a R6b R7a R7b R8a R8b TAIL | 2c',
    ]);
    expect(noteLines(laid.layout, 0, 2)).toBe(2);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('a row with room for one note line below it', () => {
  // Four introduction lines leave room for one line of the four-line note below row 5, so
  // the row moves to the next page, where its note fits whole. The hold-out keeps it there.
  const refs = new Map([
    [1, 1],
    [5, 2],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 4],
  ]);
  const INTRO4 = para('INTRO', 4);
  const intro = ['INTRO1', 'INTRO2', 'INTRO3', 'INTRO4'];

  test('moves with its note to the next page and stays there', () => {
    const laid = layoutProbe(INTRO4 + tbl(rows(8, refs)) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 INTRO3 INTRO4 R1a R1b1 R2a R2b R3a R3b R4a R4b | 1',
      'R5a R5b2 R6a R6b R7a R7b R8a R8b TAIL | 2',
    ]);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, [...intro, ...names(8), 'TAIL'], [1, 2]);
  });

  test('a warm pass after an edit matches a clean layout', () => {
    const session = createLayoutSession();
    layoutProbe(INTRO4 + tbl(rows(8, refs)) + TAIL, notes, session, 1);
    const edited = INTRO4.replace('INTRO1', 'INTROx1') + tbl(rows(8, refs)) + TAIL;
    const warm = layoutProbe(edited, notes, session, 2);
    const clean = layoutProbe(edited, notes);
    expect(pages(warm.layout)).toEqual(pages(clean.layout));
    expect(warm.fixedPoint).toBe(true);
  });

  test('a whole row that ends the page moves with its note', () => {
    // Row 8 ends page 1 and cites a two-line note with no room below it. The page after
    // opens with the paragraph after the table, so row 8 is whole, not a split head.
    const lastRefs = new Map([[8, 1]]);
    const lastNotes = new Map([[1, 2]]);
    const body = (intro: string) => intro + tbl(rows(8, lastRefs)) + TAIL;
    const laid = layoutProbe(body(INTRO4), lastNotes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 INTRO3 INTRO4 R1a R1b R2a R2b R3a R3b R4a R4b R5a R5b R6a R6b R7a R7b | ',
      'R8a R8b1 TAIL | 1',
    ]);
    expect(laid.fixedPoint).toBe(true);
    // A warm pass that reaches the same shape from a layout where row 8 had room agrees.
    const session = createLayoutSession();
    layoutProbe(body(INTRO), lastNotes, session, 1);
    const warm = layoutProbe(body(INTRO4), lastNotes, session, 2);
    expect(pages(warm.layout)).toEqual(pages(laid.layout));
    expect(warm.fixedPoint).toBe(true);
  });

  test('a rotated referencing cell takes its row band', () => {
    // The exact 35pt row leaves room for one note line below it.
    const rotated = rows(8, refs, (n, spec) =>
      n === 5
        ? {
            ...spec,
            trPr: '<w:trHeight w:val="700" w:hRule="exact"/>',
            secondTcPr: '<w:textDirection w:val="btLr"/>',
          }
        : spec
    );
    const laid = layoutProbe(INTRO + tbl(rotated) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b | 1',
      'R5a R5b2 R6a R6b R7a R7b R8a R8b TAIL | 2',
    ]);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('a multi-line referencing row', () => {
  // Row 5's first cell holds three lines, and its second cell cites a two-line note from
  // its only line. One note line fits below the row, and the whole note fits below the
  // reference line.
  const refs = new Map([
    [1, 1],
    [5, 2],
  ]);
  const notes = new Map([
    [1, 1],
    [2, 2],
  ]);
  const tall = (trPr?: string) =>
    rows(8, refs, (n, spec) => (n === 5 ? { ...spec, trPr, first: para('R5a', 3) } : spec));
  const lines = names(8).flatMap((name) => (name === 'R5a' ? ['R5a1', 'R5a2', 'R5a3'] : [name]));

  test('continues on the next page below the reference line', () => {
    const laid = layoutProbe(INTRO + tbl(tall()) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b R5a1 R5a2 R5b2 | 1,2',
      'R5a3 R6a R6b R7a R7b R8a R8b TAIL | ',
    ]);
    const { band } = bandOf(laid, 2);
    expect(band.bottom - band.top).toBeCloseTo(14, 3);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...lines, 'TAIL'], [1, 2]);
  });

  test('moves whole with its note when it cannot split', () => {
    const laid = layoutProbe(INTRO + tbl(tall('<w:cantSplit/>')) + TAIL, notes);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b1 R2a R2b R3a R3b R4a R4b | 1',
      'R5a1 R5a2 R5a3 R5b2 R6a R6b R7a R7b R8a R8b TAIL | 2',
    ]);
    expect(laid.fixedPoint).toBe(true);
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...lines, 'TAIL'], [1, 2]);
  });

  test('a row that the body alone moves publishes no hold', () => {
    // Nine introduction lines leave 16pt, and the row that cannot split needs 56pt. It
    // moves for body reasons, so the page before it reserves nothing to keep it out.
    const pushed = rows(4, new Map([[3, 1]]), (n, spec) =>
      n === 3 ? { ...spec, trPr: '<w:cantSplit/>', first: para('R3a', 4) } : spec
    );
    const laid = layoutProbe(para('INTRO', 9) + tbl(pushed) + TAIL, new Map([[1, 1]]));
    expect(pages(laid.layout)[1]).toStartWith('R3a1 R3a2 R3a3 R3a4 R3b1');
    expect(laid.reserves.get(0) ?? 0).toBe(0);
    expect(laid.fixedPoint).toBe(true);
  });
});

describe('rows that keep the whole-table band', () => {
  const refs = new Map([[5, 1]]);
  const notes = new Map([[1, 1]]);

  const tableBand = (laid: Laid, noteId: number) => {
    const { band, table } = bandOf(laid, noteId);
    expect(band.top).toBeCloseTo(table.box.y, 3);
    expect(band.bottom).toBeCloseTo(table.box.y + table.box.height, 3);
    expect(band.evictable).toBe(false);
  };

  test('a reference in a vertically merged cell that spans rows', () => {
    const merged = rows(8, refs, (n, spec) =>
      n === 5
        ? { ...spec, secondTcPr: '<w:vMerge w:val="restart"/>' }
        : n === 6
          ? { ...spec, secondTcPr: '<w:vMerge/>', second: cite('') }
          : spec
    );
    tableBand(layoutProbe(INTRO + tbl(merged) + TAIL, notes), 1);
  });

  test('a row that keeps with the next row', () => {
    const kept = rows(8, refs, (n, spec) =>
      n === 5 ? { ...spec, first: cite('R5a', undefined, '<w:keepNext/>') } : spec
    );
    tableBand(layoutProbe(INTRO + tbl(kept) + TAIL, notes), 1);
  });

  test('a reference in an authored header row', () => {
    const header = rows(8, new Map([[1, 1]]), (n, spec) =>
      n === 1 ? { ...spec, trPr: '<w:tblHeader/>' } : spec
    );
    tableBand(layoutProbe(INTRO + tbl(header) + TAIL, notes), 1);
  });

  test('a positioned table', () => {
    const floating =
      '<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="text" w:tblpY="0"/>';
    tableBand(layoutProbe(INTRO + tbl(rows(8, refs), floating) + TAIL, notes), 1);
  });
});

describe('rows that take the row band but do not move', () => {
  test('the first body row under repeated header rows', () => {
    // Row 9 opens page 2 under the repeated header row. Moving it would reopen page 3 the
    // same way, so its band never evicts.
    const refs = new Map([[9, 1]]);
    const laid = layoutProbe(
      INTRO +
        tbl(rows(14, refs, (n, spec) => (n === 1 ? { ...spec, trPr: '<w:tblHeader/>' } : spec))) +
        TAIL,
      new Map([[1, 1]])
    );
    const { band, table, page } = bandOf(laid, 1);
    expect(page).toBe(1);
    const header = table.rows[0]!;
    const row = table.rows[1]!;
    expect(header.isHeaderRepeat).toBe(true);
    expect(band.top).toBeCloseTo(row.box.y, 3);
    expect(band.blockTop).toBeCloseTo(row.box.y - header.box.height, 3);
    expect(band.evictable).toBe(false);
  });

  test('a row taller than the page keeps every line and its note', () => {
    // Row 4 holds twenty lines and cites a note from its first line.
    const tall = rows(6, new Map([[4, 1]]), (n, spec) =>
      n === 4 ? { ...spec, first: para('T', 20) } : spec
    );
    const laid = layoutProbe(INTRO + tbl(tall) + TAIL, new Map([[1, 2]]));
    const lines = names(6).flatMap((name) =>
      name === 'R4a' ? Array.from({ length: 20 }, (_, i) => `T${i + 1}`) : [name]
    );
    // The row's head stays on page 1 with its reference: a split head is not moved to the
    // next page, where the rest of the row would fill the band below the reference again.
    // The note budgets below the reference line, so the row continues on page 2 below it.
    expectComplete(laid.layout, ['INTRO1', 'INTRO2', ...lines, 'TAIL'], [1]);
    expect(pages(laid.layout)).toEqual([
      'INTRO1 INTRO2 R1a R1b R2a R2b R3a R3b T1 T2 T3 T4 R4b1 | 1',
      'T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 | ',
      'T17 T18 T19 T20 R5a R5b R6a R6b TAIL | ',
    ]);
    const { band } = bandOf(laid, 1);
    expect(band.endsPageRowId).toBeDefined();
    expect(rowContinuesOn(bodyOnlyPage(laid.layout.pages[1]!), band.endsPageRowId!)).toBe(true);
    expect(laid.fixedPoint).toBe(true);
  });

  test('a row below a row that keeps with it', () => {
    const kept = rows(8, new Map([[5, 1]]), (n, spec) =>
      n === 4 ? { ...spec, first: cite('R4a', undefined, '<w:keepNext/>') } : spec
    );
    const { band, table } = bandOf(layoutProbe(INTRO + tbl(kept) + TAIL, new Map([[1, 1]])), 1);
    const row = table.rows.find((r) => r.rowIndex === 4)!;
    expect(band.top).toBeCloseTo(row.box.y, 3);
    expect(band.evictable).toBe(false);
  });
});
