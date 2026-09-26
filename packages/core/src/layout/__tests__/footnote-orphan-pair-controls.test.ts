// A reference on the second line of a widow-controlled paragraph (an opening pair) stays
// on its page only when its note can start there with at least two lines. Otherwise the pair
// moves to the next page with its whole note, and independent paragraphs ahead of the pair
// stay behind. Exact 24 pt body lines and 12 pt note lines make the page geometry exact; the
// top margin leaves a few points of slack so no line ends exactly on a limit.
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
import type { NotesLayoutInput } from '../note-pagination.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

interface Probe {
  /** Line count and widow control per paragraph. */
  readonly paragraphs: readonly { readonly lines: number; readonly widowControl?: boolean }[];
  /** Line number (1-based) -> footnote ids referenced at its end. */
  readonly refs: Readonly<Record<number, readonly number[]>>;
  /** Footnote id -> number of note lines. */
  readonly notes: Readonly<Record<number, number>>;
  /** Top margin in twips (1440 leaves the 648 pt body a whole number of lines). */
  readonly top: number;
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
        runs.push(run(`<w:t xml:space="preserve">Line ${String(line).padStart(2, '0')}</w:t>`));
        for (const id of probe.refs[line] ?? []) {
          runs.push(
            run(`<w:footnoteReference w:id="${id}"/>`, '<w:vertAlign w:val="superscript"/>')
          );
        }
        if (index < paragraph.lines - 1) runs.push(run('<w:br/>'));
      }
      const props =
        `<w:widowControl w:val="${paragraph.widowControl ? 1 : 0}"/>` +
        '<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="exact"/>';
      return `<w:p><w:pPr>${props}</w:pPr>${runs.join('')}</w:p>`;
    })
    .join('');
  const noteParagraph = (content: string) =>
    '<w:p><w:pPr><w:widowControl w:val="0"/>' +
    `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>${content}</w:p>`;
  const noteRun = (content: string) => `<w:r><w:rPr><w:sz w:val="20"/></w:rPr>${content}</w:r>`;
  const notes = Object.entries(probe.notes)
    .map(
      ([id, count]) =>
        `<w:footnote w:id="${id}">${noteParagraph(
          Array.from(
            { length: count },
            (_, i) =>
              `${i ? noteRun('<w:br/>') : ''}${noteRun(`<w:t xml:space="preserve">Note ${id} line ${i + 1}</w:t>`)}`
          ).join('')
        )}</w:footnote>`
    )
    .join('');
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
        `<w:pgMar w:top="${probe.top}" w:right="1440" w:bottom="1440" w:left="1440"/>` +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:type="separator" w:id="-1">${noteParagraph(noteRun('<w:separator/>'))}</w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0">${noteParagraph(noteRun('<w:continuationSeparator/>'))}</w:footnote>` +
        notes +
        '</w:footnotes>'
    ),
  });
}

function layoutProbe(probe: Probe): SemanticLayout {
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
    producer: 'footnote-orphan-pair-controls',
  };
  return layoutSemanticDocument(part, 1, {
    measurer,
    notes,
    session: createLayoutSession(),
    producer: 'footnote-orphan-pair-controls',
  });
}

/** `first-last` body line and the note ids (`c` for a continuation) per page. */
function pages(layout: SemanticLayout): string[] {
  return layout.pages.map((page) => {
    const labels = page.fragments.flatMap((f) =>
      f.kind === 'paragraph'
        ? f.lines.flatMap((line) => {
            const match = /^Line (\d{2})/.exec(line.spans.map((span) => span.text).join(''));
            return match ? [Number(match[1])] : [];
          })
        : []
    );
    const notes = (page.footnotes?.notes ?? []).map(
      (n) => `${n.noteId}${n.continuation ? 'c' : ''}`
    );
    return `${labels[0]}-${labels.at(-1)}${notes.length ? ` [${notes.join(' ')}]` : ''}`;
  });
}

const ones = (count: number) => Array.from({ length: count }, () => ({ lines: 1 }));

describe('footnote references on the second line of an opening pair', () => {
  // Lines 22-23 open a widow-controlled paragraph and line 23 cites a 10-line note. With
  // note 1 (7 lines) on page 1, the pair fits the page but no line of note 2 does.
  test('the pair moves with its note when the note cannot start', () => {
    const layout = layoutProbe({
      paragraphs: [...ones(21), { lines: 6, widowControl: true }, ...ones(20)],
      refs: { 1: [1], 23: [2] },
      notes: { 1: 7, 2: 10 },
      top: 1380,
    });
    expect(pages(layout)).toEqual(['1-21 [1]', '22-42 [2]', '43-47']);
  });

  // Lines 13-37 are independent one-line paragraphs and lines 38-43 open a widow-controlled
  // paragraph whose second line cites note 2. Page 2 could hold line 39 but none of its note.
  for (const [noteLines, top, expected] of [
    [14, 1380, ['1-12 [1 3]', '13-37', '38-56 [2]', '57-68']],
    [8, 1320, ['1-12 [1 3]', '13-37', '38-59 [2]', '60-68']],
  ] as const) {
    test(`independent lines stay while the pair moves with a ${noteLines}-line note`, () => {
      const layout = layoutProbe({
        paragraphs: [...ones(37), { lines: 6, widowControl: true }, ...ones(25)],
        refs: { 3: [1], 12: [3], 39: [2] },
        notes: { 1: 24, 3: 4, 2: noteLines },
        top,
      });
      expect(pages(layout)).toEqual([...expected]);
    });
  }

  // Note 1 has 4 lines, so three lines of note 2 fit below line 23: the pair stays and the
  // note continues on page 2.
  test('the pair stays and its note splits when the note can start', () => {
    const layout = layoutProbe({
      paragraphs: [...ones(21), { lines: 6, widowControl: true }, ...ones(20)],
      refs: { 1: [1], 23: [2] },
      notes: { 1: 4, 2: 10 },
      top: 1440,
    });
    const [first, second] = pages(layout);
    expect(first).toBe('1-23 [1 2]');
    expect(second).toMatch(/^24-\d+ \[2c\]$/);
  });
});
