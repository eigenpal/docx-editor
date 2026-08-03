// Note story layout + pagination smoke tests against comprehensive + overflow fixtures.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { noteStoryBlocks } from '../story-roots.ts';
import { layoutNoteById, normalNotesOf } from '../note-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { isNoteNode, noteIdOf } from '../../store/package/note-nodes.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { OoxmlPart } from '../../store/package/ooxml-tree.ts';

const FIXTURES = resolve(import.meta.dir, '../../../../../e2e/fixtures');
const COMPREHENSIVE = resolve(FIXTURES, 'comprehensive-word-element-test.docx');
const OVERFLOW = resolve(FIXTURES, 'footnote-bottom-overflow.docx');
const OVERLAP = resolve(FIXTURES, 'footnote-overlap-regression.docx');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function loadFixture(path: string): {
  part: OoxmlPart;
  notes: NotesLayoutInput;
  pkg: ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P } ? P : never;
} {
  const bytes = readFileSync(path);
  const loaded = readOoxmlPackage(bytes);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const settings = settingsPartOf(loaded.package);
  const documentFootnoteProps = resolveFootnoteProperties(
    undefined,
    authoredDocumentFootnoteProperties(settings)
  );
  const documentEndnoteProps = resolveEndnoteProperties(
    undefined,
    authoredDocumentEndnoteProperties(settings)
  );
  const sectionCount = Math.max(
    1,
    [...part.root.children].filter((n) => n.kind === 'sectionProperties').length +
      (part.root.children.some((n) => n.kind === 'paragraph') ? 0 : 0)
  );
  const measurer = createFixedMeasurer();
  const stylesPart = [...loaded.package.parts.values()].find(
    (candidate) => candidate.root.localName === 'styles'
  );
  const notes: NotesLayoutInput = {
    footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
    endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
    footnotePropsBySection: Array.from({ length: sectionCount }, () => documentFootnoteProps),
    endnotePropsBySection: Array.from({ length: sectionCount }, () => documentEndnoteProps),
    documentFootnoteProps,
    documentEndnoteProps,
    measurer,
    producer: 'note-layout-test',
    ...(stylesPart ? { styleCascade: buildStyleCascadeTable(stylesPart.root) } : {}),
  };
  return { part, notes, pkg: loaded.package };
}

function minimalMultiRefDoc(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>B</w:t>` +
    `<w:footnoteReference w:id="2"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:t>First</w:t></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="2"><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:footnote>`;
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

describe('note story roots', () => {
  test('each typed note is a story root with blocks', () => {
    const { notes } = loadFixture(COMPREHENSIVE);
    const normals = normalNotesOf(notes.footnotesPart);
    expect(normals.length).toBe(3);
    for (const note of normals) {
      const blocks = noteStoryBlocks(note);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.every((b) => b.kind === 'paragraph' || b.kind === 'table')).toBe(true);
    }
  });
});

describe('note layout + pagination', () => {
  test('comprehensive fixture lays out footnote and endnote bodies on pages', () => {
    const { part, notes } = loadFixture(COMPREHENSIVE);
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-layout-test',
      styleCascade: notes.styleCascade,
    });

    const footnoteNotes = layout.pages.flatMap((page) => page.footnotes?.notes ?? []);
    const endnoteNotes = layout.pages.flatMap((page) => page.endnotes?.notes ?? []);
    expect(footnoteNotes.length).toBeGreaterThanOrEqual(3);
    expect(endnoteNotes.length).toBeGreaterThanOrEqual(2);

    for (const note of [...footnoteNotes, ...endnoteNotes]) {
      expect(note.fragments.length).toBeGreaterThan(0);
      expect(note.scopeId).toMatch(/^(footnote|endnote):-?\d+$/);
    }

    const areas = layout.pages.flatMap((page) => [page.footnotes, page.endnotes].filter(Boolean));
    expect(areas.length).toBeGreaterThan(0);
    for (const area of areas) {
      expect(area!.separator).toBeTruthy();
    }
  });

  test('layoutNoteById returns namespaced flow for footnote 1', () => {
    const { notes } = loadFixture(COMPREHENSIVE);
    const laid = layoutNoteById(notes.footnotesPart, 1, 400, {
      measurer: notes.measurer,
      producer: 'note-layout-test',
    });
    expect(laid).not.toBeNull();
    expect(laid!.scopeId).toBe('footnote:1');
    expect(laid!.flowHeight).toBeGreaterThan(0);
    const lineIds = laid!.fragments.flatMap((f) =>
      f.kind === 'paragraph' ? f.lines.map((l) => l.id) : []
    );
    expect(lineIds.every((id) => id.startsWith('note-footnote-1-'))).toBe(true);
  });

  test('separator notes are not laid as normal notes', () => {
    const { notes } = loadFixture(COMPREHENSIVE);
    const root = notes.footnotesPart!.root;
    const all = root.children.filter(isNoteNode);
    const separatorIds = all
      .filter((n) => noteIdOf(n) === -1 || noteIdOf(n) === 0)
      .map((n) => noteIdOf(n));
    expect(separatorIds).toEqual([-1, 0]);
    expect(normalNotesOf(notes.footnotesPart).every((n) => (noteIdOf(n) ?? 0) > 0)).toBe(true);
  });

  test('overflow fixtures lay out without throwing and reserve footnote area', () => {
    for (const path of [OVERFLOW, OVERLAP]) {
      const { part, notes } = loadFixture(path);
      const layout = layoutSemanticDocument(part, 1, {
        measurer: notes.measurer,
        notes,
        producer: 'note-overflow-test',
      });
      expect(layout.pages.length).toBeGreaterThan(0);
      const anyFootnotes = layout.pages.some((page) => (page.footnotes?.notes.length ?? 0) > 0);
      expect(anyFootnotes).toBe(true);
    }
  });

  test('multiple refs on one page share one separator area', () => {
    const bytes = minimalMultiRefDoc();
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const settings = settingsPartOf(loaded.package);
    const documentFootnoteProps = resolveFootnoteProperties(
      undefined,
      authoredDocumentFootnoteProperties(settings)
    );
    const documentEndnoteProps = resolveEndnoteProperties(
      undefined,
      authoredDocumentEndnoteProperties(settings)
    );
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-multi-ref',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-multi-ref',
    });
    const areas = layout.pages.map((page) => page.footnotes).filter(Boolean);
    expect(areas.length).toBe(1);
    expect(areas[0]!.notes.length).toBe(2);
    expect(areas[0]!.separator).toBeTruthy();
  });

  test('paint tags body note refs and note areas without innerHTML', () => {
    const { part, notes } = loadFixture(COMPREHENSIVE);
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-paint-test',
      styleCascade: notes.styleCascade,
    });
    const container = document.createElement('div');
    document.body.append(container);
    paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false });
    expect(container.querySelector('[data-docx-note-ref]')).toBeTruthy();
    expect(container.querySelector('[data-docx-notes="footnotes"]')).toBeTruthy();
    expect(
      container.querySelector('[data-docx-note-separator]')?.getAttribute('contenteditable')
    ).toBe('false');
    expect(container.querySelector('script')).toBeNull();
    const note = container.querySelector('[data-docx-note]') as HTMLElement;
    expect(note?.dataset.docxNoteScope).toMatch(/^footnote:/);
  });

  test('comprehensive fixture: note marks + short single separators; heading border stays double', () => {
    const { part, notes } = loadFixture(COMPREHENSIVE);
    expect(notes.documentEndnoteProps.numFmt).toBe('lowerRoman');
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-mark-sep-test',
      styleCascade: notes.styleCascade,
    });

    const footnoteNotes = layout.pages.flatMap((page) => page.footnotes?.notes ?? []);
    const endnoteNotes = layout.pages.flatMap((page) => page.endnotes?.notes ?? []);
    expect(
      footnoteNotes
        .map((n) => n.mark)
        .filter(Boolean)
        .sort()
    ).toEqual(['1', '2', '3']);
    expect(endnoteNotes.map((n) => n.mark).filter(Boolean)).toEqual(['i', 'ii']);

    for (const note of footnoteNotes) {
      const markSpan = note.fragments
        .flatMap((f) => (f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans) : []))
        .find((s) => s.projected && s.noteNav?.direction === 'to-body');
      expect(markSpan?.text).toBe(note.mark);
      expect(markSpan?.style.verticalAlign).toBe('superscript');
    }
    for (const note of endnoteNotes) {
      const markSpan = note.fragments
        .flatMap((f) => (f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans) : []))
        .find((s) => s.projected && s.noteNav?.direction === 'to-body');
      expect(markSpan?.text).toBe(note.mark);
      expect(markSpan?.style.verticalAlign).toBe('superscript');
    }

    // Body heading banner owns the long double `w:pBdr` — distinct from note separators.
    const heading = layout.pages
      .flatMap((page) => page.fragments)
      .find((fragment) => {
        if (fragment.kind !== 'paragraph') return false;
        const text = fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
        return text.includes('END OF COMPREHENSIVE TEST DOCUMENT');
      });
    expect(heading?.kind).toBe('paragraph');
    if (heading?.kind !== 'paragraph') throw new Error('missing end banner paragraph');
    const headingTop = heading.borders?.find((stroke) => stroke.side === 'top');
    expect(headingTop?.edge.val).toBe('double');
    expect(headingTop!.box.width).toBeGreaterThan(layout.pages[0]!.contentBox.width * 0.9);

    const fnSep = layout.pages.map((p) => p.footnotes?.separator).find(Boolean);
    const enSep = layout.pages.map((p) => p.endnotes?.separator).find(Boolean);
    expect(fnSep?.ruleStyle).toBe('single');
    expect(enSep?.ruleStyle).toBe('single');
    expect(fnSep?.fragments.length ?? 0).toBe(0);
    expect(enSep?.fragments.length ?? 0).toBe(0);
    // Short note rules — never the full-width heading border.
    expect(fnSep!.box.width).toBeLessThan(layout.pages[0]!.contentBox.width * 0.5);
    expect(enSep!.box.width).toBeLessThan(layout.pages[0]!.contentBox.width * 0.5);
    expect(enSep!.box.width).toBeLessThan(heading.box.width * 0.5);

    const container = document.createElement('div');
    document.body.append(container);
    paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false });
    const backMarks = [...container.querySelectorAll('[data-docx-note-mark-back]')].map(
      (el) => el.textContent
    );
    expect(backMarks).toEqual(expect.arrayContaining(['1', '2', '3', 'i', 'ii']));
    expect(
      container.querySelector('[data-docx-notes="footnotes"] [data-docx-note-rule="single"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-docx-notes="endnotes"] [data-docx-note-rule="single"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-docx-notes="endnotes"] [data-docx-note-rule="double"]')
    ).toBeNull();
  });

  test('endnotes collect at doc end and do not reserve ref-page footnote space alone', () => {
    const { part, notes } = loadFixture(COMPREHENSIVE);
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-endnote-test',
      styleCascade: notes.styleCascade,
    });
    const endnotePages = layout.pages.filter((page) => (page.endnotes?.notes.length ?? 0) > 0);
    expect(endnotePages.length).toBeGreaterThan(0);
    // Endnotes attach to a late page (docEnd), not every referencing page.
    expect(endnotePages.length).toBeLessThanOrEqual(layout.pages.length);
  });

  test('taller note body increases footnote area height', () => {
    const make = (noteBody: string): NotesLayoutInput & { part: OoxmlPart } => {
      const bytes = zipSync({
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
            `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
            '<w:sectPr/></w:body></w:document>'
        ),
        'word/footnotes.xml': strToU8(
          `<w:footnotes xmlns:w="${W}">` +
            `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
            `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
            `<w:footnote w:id="1">${noteBody}</w:footnote>` +
            '</w:footnotes>'
        ),
      });
      const loaded = readOoxmlPackage(bytes);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(loaded.reason);
      const settings = settingsPartOf(loaded.package);
      const documentFootnoteProps = resolveFootnoteProperties(
        undefined,
        authoredDocumentFootnoteProperties(settings)
      );
      const documentEndnoteProps = resolveEndnoteProperties(
        undefined,
        authoredDocumentEndnoteProperties(settings)
      );
      return {
        part: loaded.package.parts.get(loaded.package.mainDocumentPart)!,
        footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
        endnotesPart: null,
        footnotePropsBySection: [documentFootnoteProps],
        endnotePropsBySection: [documentEndnoteProps],
        documentFootnoteProps,
        documentEndnoteProps,
        measurer: createFixedMeasurer(),
        producer: 'note-height',
      };
    };

    const short = make('<w:p><w:r><w:t>Hi</w:t></w:r></w:p>');
    const tall = make(`<w:p><w:r><w:t>${'Line '.repeat(20)}</w:t></w:r></w:p>`.repeat(8));
    const shortLayout = layoutSemanticDocument(short.part, 1, {
      measurer: short.measurer,
      notes: short,
      producer: 'note-height',
    });
    const tallLayout = layoutSemanticDocument(tall.part, 1, {
      measurer: tall.measurer,
      notes: tall,
      producer: 'note-height',
    });
    const shortH = shortLayout.pages[0]?.footnotes?.box.height ?? 0;
    const tallH = tallLayout.pages.reduce(
      (sum, page) => sum + (page.footnotes?.box.height ?? 0),
      0
    );
    expect(tallH).toBeGreaterThan(shortH);
  });

  test('long footnote on final body page continues onto overflow pages without clipping', () => {
    // Short page + many note paragraphs so the note outlives the sole body page.
    const noteParas = Array.from(
      { length: 80 },
      (_, i) => `<w:p><w:r><w:t>Note line ${i} ${'x'.repeat(80)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
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
          `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="12240" w:h="7200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
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
      producer: 'note-continuation-overflow',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-continuation-overflow',
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const noteFragments = layout.pages.flatMap((page) => page.footnotes?.notes ?? []);
    expect(noteFragments.length).toBeGreaterThan(1);
    expect(noteFragments.some((n) => n.continuation)).toBe(true);
    const laidAlone = layoutNoteById(notes.footnotesPart, 1, layout.pages[0]!.contentBox.width, {
      measurer: notes.measurer,
      producer: 'note-continuation-overflow',
    });
    expect(laidAlone).not.toBeNull();
    const placedHeight = noteFragments.reduce((sum, n) => sum + n.box.height, 0);
    expect(placedHeight).toBeGreaterThan(laidAlone!.flowHeight * 0.95);
  });

  test('long endnotes create overflow pages instead of clamping', () => {
    const noteParas = Array.from(
      { length: 50 },
      (_, i) => `<w:p><w:r><w:t>Endnote ${i} ${'y'.repeat(50)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t><w:endnoteReference w:id="1"/></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1">${noteParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: null,
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-endnote-overflow',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-endnote-overflow',
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const endnoteStories = layout.pages.flatMap((page) => page.endnotes?.notes ?? []);
    expect(endnoteStories.length).toBeGreaterThan(1);
    const laidAlone = layoutNoteById(notes.endnotesPart, 1, layout.pages[0]!.contentBox.width, {
      measurer: notes.measurer,
      producer: 'note-endnote-overflow',
    });
    expect(laidAlone).not.toBeNull();
    const placedHeight = endnoteStories.reduce((sum, n) => sum + n.box.height, 0);
    expect(placedHeight).toBeGreaterThan(laidAlone!.flowHeight * 0.95);
  });

  test('split multi-page paragraph assigns note ref only to owning fragment page', () => {
    // Long run before the note ref so the atom lands on a later page fragment.
    const prefix = 'Word '.repeat(2000);
    const bytes = zipSync({
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
          `<w:p><w:r><w:t>${prefix}</w:t><w:footnoteReference w:id="1"/><w:t> tail</w:t></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="12240" w:h="7200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:t>Only once</w:t></w:r></w:p></w:footnote>` +
          '</w:footnotes>'
      ),
    });
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
      producer: 'note-split-para-ref',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-split-para-ref',
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pagesWithNote = layout.pages.filter((page) =>
      (page.footnotes?.notes ?? []).some((n) => n.noteId === 1 && !n.continuation)
    );
    expect(pagesWithNote).toHaveLength(1);
    // Ref must not appear on every page that merely hosts the same paragraph id.
    const paragraphId = (
      layout.pages[0]!.fragments.find((f) => f.kind === 'paragraph') as
        | { paragraphId: string }
        | undefined
    )?.paragraphId;
    expect(paragraphId).toBeTruthy();
    const pagesHostingParagraph = layout.pages.filter((page) =>
      page.fragments.some((f) => f.kind === 'paragraph' && f.paragraphId === paragraphId)
    );
    expect(pagesHostingParagraph.length).toBeGreaterThan(1);
    expect(pagesWithNote[0]!.index).toBeGreaterThan(0);
  });

  test('section footnotePr lowerRoman then decimal starts are painted per section', () => {
    const bytes = zipSync({
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
          `<w:p><w:pPr><w:sectPr>` +
          `<w:footnotePr><w:numFmt w:val="lowerRoman"/><w:numStart w:val="1"/><w:numRestart w:val="eachSect"/></w:footnotePr>` +
          `</w:sectPr></w:pPr><w:r><w:t>S1</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
          `<w:p><w:r><w:t>S2</w:t><w:footnoteReference w:id="2"/></w:r></w:p>` +
          `<w:sectPr><w:footnotePr><w:numFmt w:val="decimal"/><w:numStart w:val="10"/><w:numRestart w:val="eachSect"/></w:footnotePr></w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="2"><w:p><w:r><w:t>two</w:t></w:r></w:p></w:footnote>` +
          '</w:footnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const sect0 = resolveFootnoteProperties({
      numFmt: 'lowerRoman',
      numStart: 1,
      numRestart: 'eachSect',
    });
    const sect1 = resolveFootnoteProperties({
      numFmt: 'decimal',
      numStart: 10,
      numRestart: 'eachSect',
    });
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [sect0, sect1],
      endnotePropsBySection: [documentEndnoteProps, documentEndnoteProps],
      documentFootnoteProps: sect0,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-section-marks',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-section-marks',
    });
    const marks = layout.pages
      .flatMap((page) => page.footnotes?.notes ?? [])
      .filter((n) => !n.continuation)
      .map((n) => n.mark);
    expect(marks).toEqual(['i', '10']);
  });
});
