// Footnotes taller than the remaining page: the first fragment stays on the reference
// page, the remainder drains forward, and drained reservations release (issue #608).
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
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// Letter page, 1-inch margins, createFixedMeasurer(6, 14): the default run size is 10pt,
// so a line is 14 * 10/11 pt tall, a character 6 * 10/11 pt wide, and the 468pt content
// column breaks at floor(468 / (60/11)) = 85 characters.
const LINE_H = 14 * (10 / 11);
const CHARS_PER_LINE = 85;

function packageXml(documentBody: string, footnotes: string): Uint8Array {
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
        documentBody +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
        '</w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        footnotes +
        '</w:footnotes>'
    ),
  });
}

/** 60 one-line body paragraphs; `refs` maps paragraph index → footnote id. */
function bodyParas(count: number, refs: ReadonlyMap<number, number>, edited = false): string {
  return Array.from({ length: count }, (_, i) => {
    const label = edited && i === 0 ? `Body para ${i} EDITED` : `Body para ${i}`;
    const id = refs.get(i);
    return id !== undefined
      ? `<w:p><w:r><w:t>${label} ref</w:t><w:footnoteReference w:id="${id}"/></w:r></w:p>`
      : `<w:p><w:r><w:t>${label}</w:t></w:r></w:p>`;
  }).join('');
}

function singleRunFootnote(id: number, chars: number): string {
  return `<w:footnote w:id="${id}"><w:p><w:r><w:t>${'f'.repeat(chars)}</w:t></w:r></w:p></w:footnote>`;
}

function layoutOf(
  bytes: Uint8Array,
  producer: string,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1
): SemanticLayout {
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
    measurer: createFixedMeasurer(6, 14),
    producer,
  };
  return layoutSemanticDocument(part, revision, {
    measurer: notes.measurer,
    notes,
    ...(session ? { session } : {}),
    producer,
  });
}

function bodyLineCount(page: PageRecord): number {
  let lines = 0;
  for (const fragment of page.fragments) {
    if (fragment.kind === 'paragraph') lines += fragment.lines.length;
  }
  return lines;
}

function placedNoteHeight(page: PageRecord): number {
  return (page.footnotes?.notes ?? []).reduce((sum, note) => sum + note.box.height, 0);
}

/**
 * Every non-drain page that keeps at most one body line must be a genuine full-page
 * footnote continuation. A near-empty body page with little or no footnote content is
 * exactly the starved shape of issue #608: a reservation outliving the content it was
 * measured for. The final page is exempt — trailing body can legitimately end there.
 */
function expectNoStarvedPages(layout: SemanticLayout): void {
  for (const page of layout.pages) {
    if (page.noteStream !== undefined) continue;
    if (page.index === layout.pages.length - 1) continue;
    if (bodyLineCount(page) > 1) continue;
    expect(placedNoteHeight(page)).toBeGreaterThanOrEqual(page.contentBox.height - 4 * LINE_H);
  }
}

function expectFullyDrained(layout: SemanticLayout, expectedNoteLines: number): void {
  let placed = 0;
  for (const page of layout.pages) placed += placedNoteHeight(page);
  expect(placed).toBeCloseTo(expectedNoteLines * LINE_H, 1);
}

describe('oversized footnote starts on its reference page (issue #608)', () => {
  // The issue's repro table: one long footnote referenced from paragraph 2 of 60.
  test.each([[6000], [9000], [14000]])('fn=%i chars', (chars) => {
    const layout = layoutOf(
      packageXml(bodyParas(60, new Map([[1, 1]])), singleRunFootnote(1, chars)),
      `fn-overflow-${chars}`
    );

    // The reference page (page 0 — the citation sits on paragraph 2) hosts the note's
    // FIRST fragment, not a continuation, with real height.
    const refPage = layout.pages[0]!;
    expect(refPage.footnotes).toBeTruthy();
    const head = refPage.footnotes!.notes.find((n) => n.noteId === 1);
    expect(head).toBeTruthy();
    expect(head!.continuation).not.toBe(true);
    expect(head!.box.height).toBeGreaterThan(LINE_H);
    // Body keeps the referencing line — the page is not evacuated to a drain sheet.
    expect(bodyLineCount(refPage)).toBeGreaterThanOrEqual(2);

    // Hand-computed packing: body lines + note lines at one line height per line, ignoring
    // the two separators — the result must land within one page of it.
    const noteLines = Math.ceil(chars / CHARS_PER_LINE);
    const expected = Math.ceil(((60 + noteLines) * LINE_H) / refPage.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);

    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('two adjacent footnotes totalling more than one page drain without starving pages', () => {
    const refs = new Map([
      [1, 1],
      [2, 2],
    ]);
    const layout = layoutOf(
      packageXml(bodyParas(60, refs), singleRunFootnote(1, 6000) + singleRunFootnote(2, 6000)),
      'fn-adjacent'
    );

    const refPage = layout.pages[0]!;
    const head = refPage.footnotes?.notes.find((n) => n.noteId === 1);
    expect(head).toBeTruthy();
    expect(head!.continuation).not.toBe(true);
    expect(head!.box.height).toBeGreaterThan(LINE_H);

    const noteLines = 2 * Math.ceil(6000 / CHARS_PER_LINE);
    const expected = Math.ceil(((60 + noteLines) * LINE_H) / refPage.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);

    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('a footnote taller than an entire page caps and drains without unbounded pages', () => {
    const noteParaTexts = Array.from(
      { length: 250 },
      (_, i) => `Giant note para ${i} ${'x'.repeat(70)}`
    );
    const noteParas = noteParaTexts
      .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
      .join('');
    const layout = layoutOf(
      packageXml(bodyParas(6, new Map([[1, 1]])), `<w:footnote w:id="1">${noteParas}</w:footnote>`),
      'fn-giant'
    );

    const refPage = layout.pages[0]!;
    const head = refPage.footnotes?.notes.find((n) => n.noteId === 1);
    expect(head).toBeTruthy();
    expect(head!.continuation).not.toBe(true);
    expect(bodyLineCount(refPage)).toBeGreaterThanOrEqual(2);

    let noteLines = 0;
    for (const text of noteParaTexts) noteLines += Math.ceil(text.length / CHARS_PER_LINE);
    const expected = Math.ceil(((6 + noteLines) * LINE_H) / refPage.contentBox.height);
    expect(Math.abs(layout.pages.length - expected)).toBeLessThanOrEqual(1);

    // Drain sheets exist, each carries note content, and the drain terminates.
    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drain.length).toBeGreaterThan(0);
    for (const page of drain) {
      expect((page.footnotes?.notes.length ?? 0) > 0).toBe(true);
    }
    expectFullyDrained(layout, noteLines);
    expectNoStarvedPages(layout);
  });

  test('warm session converges to the cold layout after an edit near the reference', () => {
    const footnotes = singleRunFootnote(1, 9000);
    const session = createLayoutSession();
    const loadedCold = layoutOf(
      packageXml(bodyParas(60, new Map([[1, 1]])), footnotes),
      'fn-warm-converge'
    );
    // Cold pass carries the session forward.
    const withSession = layoutOf(
      packageXml(bodyParas(60, new Map([[1, 1]])), footnotes),
      'fn-warm-converge',
      session
    );
    expect(shapeOf(withSession)).toBe(shapeOf(loadedCold));

    // Edit paragraph 0, one paragraph above the reference; the warm pass must publish
    // exactly what a clean pass over the edited document publishes.
    const editedBytes = packageXml(bodyParas(60, new Map([[1, 1]]), true), footnotes);
    const warm = layoutOf(editedBytes, 'fn-warm-converge', session, 2);
    const clean = layoutOf(editedBytes, 'fn-warm-converge', undefined, 2);
    expect(shapeOf(warm)).toBe(shapeOf(clean));
    expectNoStarvedPages(warm);
  });
});

const shapeOf = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) => ({
      index: page.index,
      contentBox: page.contentBox,
      noteStream: page.noteStream ?? null,
      bodyLines: bodyLineCount(page),
      fragments: page.fragments.map((f) => ({
        kind: f.kind,
        id: f.id,
        box: f.box,
      })),
      footnoteHeight: page.footnotes?.box.height ?? 0,
      footnoteNotes: (page.footnotes?.notes ?? []).map((n) => ({
        id: n.noteId,
        continuation: n.continuation ?? false,
        height: n.box.height,
      })),
    }))
  );
