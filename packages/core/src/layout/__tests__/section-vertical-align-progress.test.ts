// Section vertical alignment on the pages a pass shows before it ends: they match the pages
// the finished pass publishes, with notes and with content controls.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  layoutSemanticDocumentSteps,
} from '../semantic-layout.ts';
import type { LayoutSession } from '../layout-session.ts';
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = WML_NAMESPACE_URI;
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
// 11pt text is 14pt per line. The text area is 160pt tall.
const measurer = createFixedMeasurer(6, 14);
const geometry = { width: 200, height: 200, margin: { left: 20, right: 20, top: 20, bottom: 20 } };
const SIZE = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const SECT =
  '<w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="400" w:right="400" w:bottom="400" ' +
  'w:left="400" w:header="200" w:footer="200" w:gutter="0"/><w:vAlign w:val="center"/></w:sectPr>';

const run = (text: string) => `<w:r>${SIZE}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (text: string) => `<w:p><w:pPr>${SIZE}</w:pPr>${run(text)}</w:p>`;
const control = (id: number, inner: string) =>
  `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:alias w:val="Field ${id}"/></w:sdtPr>` +
  `<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

function lineTops(page: PageRecord): number[] {
  return page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) => Math.round(line.box.y * 1000) / 1000)
      : []
  );
}

function part(body: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECT}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType: 'application/xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

/** Runs a live pass and finalizes each report with the previous pass's pages after it. */
function progressLayouts(
  source: OoxmlPart,
  session: LayoutSession,
  previous: SemanticLayout | null,
  options: Partial<Parameters<typeof layoutSemanticDocument>[2]> = {}
): { readonly shown: SemanticLayout[]; readonly final: SemanticLayout } {
  const steps = layoutSemanticDocumentSteps(source, 2, {
    measurer,
    geometry,
    session,
    ...options,
  });
  const shown: SemanticLayout[] = [];
  let next = steps.next();
  while (!next.done) {
    const progress = next.value;
    if (progress?.finalize && progress.pages.length > 0) {
      const tail = previous?.pages.slice(progress.pages.length) ?? [];
      shown.push(progress.finalize([...progress.pages, ...tail]));
    }
    next = steps.next();
  }
  return { shown, final: next.value };
}

describe('section vertical alignment before a pass ends', () => {
  test('pages reused from the previous pass are not moved a second time', () => {
    // Every fifth line sits in a content control; 40 lines fill four pages.
    const lines = (first: string) =>
      Array.from({ length: 40 }, (_, index) => {
        const paragraph = p(index === 0 ? first : `line ${index}`);
        return index % 5 === 0 ? control(index + 1, paragraph) : paragraph;
      }).join('');
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part(lines('alpha')), 1, { measurer, geometry, session });
    expect(first.pages).toHaveLength(4);
    // An edit on the first page lays it out again; the reports show the old pages after it.
    const { shown, final } = progressLayouts(part(lines('bravo')), session, first);
    expect(shown.length).toBeGreaterThan(0);
    for (const layout of shown)
      for (let index = 0; index < layout.pages.length; index += 1)
        expect(lineTops(layout.pages[index]!)).toEqual(lineTops(final.pages[index]!));
  });

  test('a page with a footnote stays top-aligned while the pass runs', () => {
    const body =
      `<w:p><w:pPr>${SIZE}</w:pPr>${run('cited')}<w:r>${SIZE}<w:footnoteReference w:id="1"/></w:r></w:p>` +
      // A short first page: the note fits beside the body in every report.
      `<w:p><w:pPr>${SIZE}</w:pPr><w:r>${SIZE}<w:br w:type="page"/></w:r></w:p>` +
      Array.from({ length: 4 }, (_, index) => p(`line ${index}`)).join('');
    const note = (inner: string) => `<w:p><w:pPr>${SIZE}</w:pPr><w:r>${SIZE}${inner}</w:r></w:p>`;
    const entries = {
      '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
      '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
      'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}${SECT}</w:body></w:document>`,
      'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${note('<w:separator/>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${note('<w:continuationSeparator/>')}</w:footnote><w:footnote w:id="1">${note('<w:t>Note</w:t>')}</w:footnote></w:footnotes>`,
    };
    const loaded = readOoxmlPackage(
      zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])))
    );
    if (!loaded.ok) throw Error(loaded.reason);
    const source = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const fn = resolveFootnoteProperties(undefined, undefined);
    const en = resolveEndnoteProperties(undefined, undefined);
    const notes = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      documentFootnoteProps: fn,
      footnotePropsBySection: [fn],
      documentEndnoteProps: en,
      endnotePropsBySection: [en],
      measurer,
      producer: 'section-vertical-align-progress-test',
    };
    const { shown, final } = progressLayouts(source, createLayoutSession(), null, { notes });
    expect(final.pages[0]!.footnotes).toBeDefined();
    expect(lineTops(final.pages[0]!)[0]).toBe(0);
    expect(shown.length).toBeGreaterThan(0);
    for (const layout of shown) expect(lineTops(layout.pages[0]!)[0]).toBe(0);
  });
});
