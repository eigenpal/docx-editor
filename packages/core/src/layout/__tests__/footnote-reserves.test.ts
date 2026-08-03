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
import { layoutSemanticDocument } from '../semantic-layout.ts';
import {
  buildPageRefHits,
  computeFootnoteReserves,
  provisionalNoteMarks,
  type NotesLayoutInput,
} from '../note-pagination.ts';
import { collectNoteReferences } from '../../store/package/note-references.ts';
import type { PageRecord } from '../semantic-records.ts';

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
});
