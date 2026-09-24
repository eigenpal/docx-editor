// Footnote budgets at the page bottom: the note area may use the last line's trailing
// line-spacing depth, while a reference line keeps its full box above the notes.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { collectNoteReferences } from '../../store/package/note-references.ts';
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
