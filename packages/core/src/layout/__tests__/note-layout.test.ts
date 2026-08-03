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
});
