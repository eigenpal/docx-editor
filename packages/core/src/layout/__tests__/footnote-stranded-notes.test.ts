// A footnote starts on the page of its reference line, below that line's full box, and the
// reflow loop reaches the same answer cold and warm. These probes cover shapes where the
// hold-out release or the attach floor used to strand a note on a later page, or raise the
// note area into a reference line in another column.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { bodyOnlyPage } from '../note-fragment-geometry.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { footnoteReservesEqual } from '../note-reserves.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { LineRecord, PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOUBLE = 'w:after="0" w:line="480" w:lineRule="auto"';

interface Paragraph {
  readonly lines: number;
  readonly widowControl?: boolean;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  readonly spacing?: string;
}

interface Probe {
  /** Labeled lines (`L01`, `L02`, ...) joined by manual breaks within each paragraph. */
  readonly paragraphs: readonly Paragraph[];
  /** Line number (1-based) -> footnote ids referenced at its end. */
  readonly refs: Readonly<Record<number, readonly number[]>>;
  /** Footnote id -> number of 10 pt note lines. */
  readonly notes: Readonly<Record<number, number>>;
  readonly columns?: number;
}

function probeDocx(probe: Probe): Uint8Array {
  const run = (content: string, props = '') =>
    `<w:r><w:rPr>${props}<w:sz w:val="24"/></w:rPr>${content}</w:r>`;
  let line = 0;
  const body = probe.paragraphs
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
      const props =
        (paragraph.keepNext ? '<w:keepNext/>' : '') +
        (paragraph.keepLines ? '<w:keepLines/>' : '') +
        (paragraph.widowControl ? '' : '<w:widowControl w:val="0"/>') +
        `<w:spacing ${paragraph.spacing ?? DOUBLE}/>`;
      return `<w:p><w:pPr>${props}<w:rPr><w:sz w:val="24"/></w:rPr></w:pPr>${runs.join('')}</w:p>`;
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
  const columns = probe.columns ? `<w:cols w:num="${probe.columns}" w:space="720"/>` : '';
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
      `<w:document xmlns:w="${W}"><w:body>${body}` +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>${columns}` +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1">${noteParagraph('<w:r><w:separator/></w:r>')}</w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0">${noteParagraph('<w:r><w:continuationSeparator/></w:r>')}</w:footnote>` +
        notes +
        '</w:footnotes>'
    ),
  });
}

function layoutProbe(
  probe: Probe,
  session: LayoutSession = createLayoutSession(),
  revision = 1
): { layout: SemanticLayout; fixedPoint: boolean } {
  const loaded = readOoxmlPackage(probeDocx(probe));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  const measurer = createFixedMeasurer();
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    footnotePropsBySection: [fn],
    endnotePropsBySection: [en],
    documentFootnoteProps: fn,
    documentEndnoteProps: en,
    measurer,
    producer: 'footnote-stranded-notes',
  };
  const layout = layoutSemanticDocument(part, revision, {
    measurer,
    notes,
    session,
    producer: 'footnote-stranded-notes',
  });
  const used = session.notePageBottomReserves ?? new Map<number, number>();
  const refs = collectNoteReferences(part);
  const hits = buildPageRefHits(refs, new Map(refs.map((ref) => [ref.paragraphId, 0])));
  const computed = computeFootnoteReserves(
    { ...layout, pages: layout.pages.map(bodyOnlyPage) },
    hits,
    notes,
    provisionalNoteMarks(hits, notes),
    undefined,
    used
  );
  return {
    layout,
    fixedPoint: computed.stable && footnoteReservesEqual(computed.reserves, used),
  };
}

/**
 * Whether another pass over the same session republishes the same pages and reserves. The
 * strict reserve recomputation in {@link layoutProbe} does not apply once the orphan-pair
 * phase has run, because that phase publishes its own map.
 */
function settles(
  probe: Probe,
  session: LayoutSession,
  layout: SemanticLayout,
  revision = 1
): boolean {
  const reserves = session.notePageBottomReserves;
  const again = layoutProbe(probe, session, revision).layout;
  return (
    JSON.stringify(pages(again)) === JSON.stringify(pages(layout)) &&
    footnoteReservesEqual(session.notePageBottomReserves ?? new Map(), reserves ?? new Map())
  );
}

const label = (line: LineRecord) => /^L\d+/.exec(line.spans.map((span) => span.text).join(''));

function labeledLines(page: PageRecord): { readonly line: LineRecord; readonly number: number }[] {
  return page.fragments.flatMap((f) =>
    f.kind === 'paragraph'
      ? f.lines.flatMap((line) => {
          const match = label(line);
          return match ? [{ line, number: Number(match[0].slice(1)) }] : [];
        })
      : []
  );
}

/** `L01..L14 | 1 2c` per page: first and last body line, then the page's notes. */
function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const lines = labeledLines(page).map(({ number }) => `L${String(number).padStart(2, '0')}`);
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${lines[0] ?? '-'}..${lines.at(-1) ?? '-'}${notes.length ? ` | ${notes.join(' ')}` : ''}`;
  });
}

/**
 * Every way a probe's notes can go wrong: a note whose first fragment is not on its
 * reference line's page, and a note area that rises into the full box of a reference line
 * whose note starts on that page.
 */
function strandedNotes(probe: Probe, layout: SemanticLayout): string[] {
  const problems: string[] = [];
  const refPage = new Map<number, number>();
  for (const page of layout.pages) {
    const heads = new Set(
      (page.footnotes?.notes ?? []).filter((n) => !n.continuation).map((n) => n.noteId)
    );
    const top = page.footnotes ? page.footnotes.box.y - page.contentBox.y : Infinity;
    for (const { line, number } of labeledLines(page)) {
      for (const id of probe.refs[number] ?? []) {
        refPage.set(id, page.index);
        if (heads.has(id) && line.box.y + line.box.height > top + 0.01) {
          problems.push(`note ${id}: area enters its reference line on page ${page.index}`);
        }
      }
    }
  }
  for (const [id, pageIndex] of refPage) {
    const head = layout.pages.findIndex((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === id && !n.continuation)
    );
    if (head !== pageIndex) problems.push(`note ${id}: reference on ${pageIndex}, head on ${head}`);
  }
  return problems;
}

describe('footnote attach floor across columns', () => {
  // Two columns. L09 ends column 1 and cites note 3; L14 sits higher in column 2 and cites
  // note 1. Note 1 lays out after note 3, and its own line would let the stack rise into
  // L09's line box. The stack stays below every reference line whose note starts on the page.
  const probe: Probe = {
    paragraphs: [
      {
        lines: 12,
        widowControl: true,
        keepLines: true,
        spacing: 'w:before="120" w:after="240" w:line="480" w:lineRule="auto"',
      },
      {
        lines: 3,
        widowControl: true,
        spacing: 'w:before="240" w:after="0" w:line="480" w:lineRule="auto"',
      },
    ],
    refs: { 2: [5], 5: [2, 4], 8: [6], 9: [3], 14: [1] },
    notes: { 1: 4, 2: 4, 3: 2, 4: 12, 5: 6, 6: 1 },
    columns: 2,
  };

  test('the note area stays below each reference line in both columns', () => {
    const session = createLayoutSession();
    const { layout } = layoutProbe(probe, session);
    expect(strandedNotes(probe, layout)).toEqual([]);
    expect(settles(probe, session, layout)).toBe(true);
  });
});
