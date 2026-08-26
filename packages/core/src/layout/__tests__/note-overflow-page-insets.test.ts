// A note-overflow sheet resolves the content box its OWN index gets.
//
// `cloneEmptyOverflowPage` mints a blank sheet from an existing one. Copying that page's
// content box was right while every page in a section shared one; once each page derives its
// own, a sheet cloned from a title page inherits a box its own `default` variant never
// resolves to, and lays its notes against it.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, resolveHeaderFooterPartsBySection } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { enumerateDocumentSections, geometryOfSection } from '../index.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

describe('note overflow sheets on a title-page section', () => {
  test('a drain sheet uses its own variant box, not the title page it was cloned from', () => {
    const noteParas = Array.from(
      { length: 60 },
      (_, i) => `<w:p><w:r><w:t>Footnote drain ${i} ${'x'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}">` +
          '<w:p><w:r><w:t>H one</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>H two</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>H three</w:t></w:r></w:p>' +
          '</w:hdr>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
          `<w:sectPr><w:headerReference w:type="default" r:id="rId7"/>` +
          `<w:pgSz w:w="12240" w:h="7200"/>` +
          `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>` +
          `<w:titlePg/></w:sectPr>` +
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
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer,
      producer: 'probe',
    };
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    const geometry = geometryOfSection(sections[0]!.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const parts = bySection[0]!;
    const headers = new Map();
    for (const [variant, hfPart] of parts.headers) {
      headers.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'probe'));
    }
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes,
      producer: 'probe',
      sectionFurniture: [
        {
          titlePage: parts.titlePage,
          evenAndOddHeaders: parts.evenAndOddHeaders,
          headers,
          footers: new Map(),
        },
      ],
    });
    // Page 0 is the title page: no `first` header reference, so no header and no push-down.
    const first = layout.pages[0]!;
    expect(first.header).toBeUndefined();
    expect(first.contentBox.y - first.box.y).toBe(geometry.margin.top);

    // Every drain sheet shows the `default` variant's index, so it gets that variant's box.
    const headerFlow = headers.get('default')!.flowHeight;
    const defaultTop = Math.max(geometry.margin.top, (geometry.headerDistance ?? 36) + headerFlow);
    expect(defaultTop).toBeGreaterThan(geometry.margin.top);

    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drain.length).toBeGreaterThan(0);
    for (const page of drain) {
      expect(page.contentBox.y - page.box.y).toBeCloseTo(defaultTop, 6);
      expect(page.contentBox.height).toBeCloseTo(
        geometry.height - defaultTop - geometry.margin.bottom,
        6
      );
      // The notes it carries start inside that box, not in the band above it.
      expect(page.footnotes!.box.y).toBeGreaterThanOrEqual(page.contentBox.y - 0.001);
    }
  });
});
