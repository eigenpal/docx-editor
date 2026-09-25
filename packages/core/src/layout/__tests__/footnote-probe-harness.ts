// Synthetic footnote probes: labeled body lines (L01, L02, ...) with footnote references,
// laid out with the fixed measurer, plus the page and note invariants the footnote tests
// check.
import { expect } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { collectNoteReferences, resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
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

/** Double-spaced `auto` lines with no paragraph spacing: 30.55 pt boxes. */
export const DOUBLE_SPACED = 'w:after="0" w:line="480" w:lineRule="auto"';

export interface ProbeParagraph {
  readonly lines: number;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  /** Widow control is off unless true. */
  readonly widowControl?: boolean;
  /** Raw `w:spacing` attributes; {@link DOUBLE_SPACED} when omitted. */
  readonly spacing?: string;
  /** A 3 pt bottom border. */
  readonly bottomBorder?: boolean;
}

export interface Probe {
  /** Labeled body lines, each ended by a manual break; one paragraph unless `paragraphs`. */
  readonly lines: number;
  /** Line counts per paragraph (summing to `lines`), with their keep properties. */
  readonly paragraphs?: readonly ProbeParagraph[];
  /** Body line number (1-based) → footnote ids referenced at its end. */
  readonly refs: Readonly<Record<number, readonly number[]>>;
  /** Footnote id → number of 10 pt lines. */
  readonly notes: Readonly<Record<number, number>>;
  readonly widowControl?: boolean;
  /** Equal-width section columns. */
  readonly columns?: number;
}

export function probeDocx(probe: Probe): Uint8Array {
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
        (paragraph.keepLines ? '<w:keepLines/>' : '') +
        (paragraph.widowControl === true ? '' : '<w:widowControl w:val="0"/>');
      const border = paragraph.bottomBorder
        ? '<w:pBdr><w:bottom w:val="single" w:sz="24" w:space="4" w:color="000000"/></w:pBdr>'
        : '';
      return (
        `<w:p><w:pPr>${keeps}${border}<w:spacing ${paragraph.spacing ?? DOUBLE_SPACED}/>` +
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
  const columns = probe.columns ? `<w:cols w:num="${probe.columns}" w:space="720"/>` : '';
  const entries: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>${columns}</w:sectPr></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${noteParagraph('<w:r><w:separator/></w:r>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${noteParagraph('<w:r><w:continuationSeparator/></w:r>')}</w:footnote>${notes}</w:footnotes>`,
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
}

type LoadedPackage = Extract<ReturnType<typeof readOoxmlPackage>, { ok: true }>;

export function loadProbe(probe: Probe): LoadedPackage {
  const loaded = readOoxmlPackage(probeDocx(probe));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded;
}

export function notesInput(loaded: LoadedPackage): NotesLayoutInput {
  const fn = resolveFootnoteProperties(undefined, undefined);
  const en = resolveEndnoteProperties(undefined, undefined);
  return {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: null,
    documentFootnoteProps: fn,
    footnotePropsBySection: [fn],
    documentEndnoteProps: en,
    endnotePropsBySection: [en],
    measurer: createFixedMeasurer(),
    producer: 'footnote-probe-test',
  };
}

export function runProbe(probe: Probe) {
  const loaded = loadProbe(probe);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const notes = notesInput(loaded);
  const session = createLayoutSession();
  const layout = layoutSemanticDocument(part, 1, { measurer: notes.measurer, notes, session });
  return { part, notes, session, layout };
}

export function layoutProbe(probe: Probe): SemanticLayout {
  return runProbe(probe).layout;
}

/**
 * The published reserves are the reflow loop's fixed point: recomputed over the final body,
 * they come back unchanged and stable. An orbit the loop cut short fails this.
 */
export function expectFixedPoint(probe: Probe): void {
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
export function summary(page: PageRecord): string {
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

export const pages = (probe: Probe) => layoutProbe(probe).pages.map(summary);

/** Page summaries plus each note area's top, so geometry drift shows up too. */
export const shapeOf = (layout: SemanticLayout) =>
  layout.pages.map((page) => {
    const area = page.footnotes;
    return `${summary(page)}${area ? ` @${(area.box.y - page.contentBox.y).toFixed(2)}` : ''}`;
  });

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

/** The painted line labeled `L<line>` on `page`. */
export function labeledLine(page: PageRecord, line: number) {
  return page.fragments
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    .find((entry) =>
      entry.spans.some((span) => span.text.startsWith(`L${String(line).padStart(2, '0')}`))
    )!;
}

/** Every reference line's full box ends above its page's note area. */
export function expectReferenceBoxesClear(probe: Probe, layout: SemanticLayout): void {
  const pageOfLine = linePages(layout);
  for (const line of Object.keys(probe.refs)) {
    const page = layout.pages[pageOfLine.get(Number(line))!]!;
    const refLine = labeledLine(page, Number(line));
    expect(refLine.box.y + refLine.box.height).toBeLessThanOrEqual(
      page.footnotes!.box.y - page.contentBox.y + 0.001
    );
  }
}

/**
 * Every note starts whole on its reference's page — nothing split, carried, or missing —
 * and every reference line's full box ends above its page's note area.
 */
export function expectNotesWithReferences(probe: Probe, layout = layoutProbe(probe)): void {
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
  }
  expectReferenceBoxesClear(probe, layout);
}

/**
 * A warm session and a clean layout over one editable body. `edit` applies a store op and
 * returns whether it applied; `compare` lays out the current revision both ways.
 */
export function warmSessionOver(probe: Probe) {
  const loaded = loadProbe(probe);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const bodyStore = store.bodyStore();
  const notes = notesInput(loaded);
  const session = createLayoutSession();
  let revision = 1;
  const paragraphIds = () =>
    (bodyStore.part.root.children?.[0]?.children ?? [])
      .filter((node) => node.kind === 'paragraph')
      .map((node) => node.id);
  return {
    paragraphIds,
    warm: () =>
      layoutSemanticDocument(bodyStore.part, revision, {
        measurer: notes.measurer,
        notes,
        session,
      }),
    clean: () =>
      layoutSemanticDocument(bodyStore.part, revision, { measurer: notes.measurer, notes }),
    edit(op: TreeDocOp): boolean {
      const applied = bodyStore.transact((ctx) => ctx.apply(op));
      if (applied.ok) revision += 1;
      return applied.ok;
    },
  };
}
