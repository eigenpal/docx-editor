// Section-aware pagination: cover geometry, next-page section breaks, and per-section furniture.
//
// The comprehensive fixture opens with a cover section (2-inch top margin, no HF refs) ended by
// a paragraph-level `w:sectPr` with no `w:type` (⇒ nextPage). Later sections declare their own
// header/footer references. Layout must honour each section — not the final body `sectPr` alone.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
} from '@docx-editor.dev/core-contract/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function pageText(layout: ReturnType<typeof layoutSemanticDocument>, pageIndex: number): string {
  const page = layout.pages[pageIndex];
  if (!page) return '';
  const parts: string[] = [];
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    for (const line of fragment.lines) {
      for (const span of line.spans) parts.push(span.text);
    }
  }
  return parts.join(' ');
}

function furnitureFor(
  pkg: ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P } ? P : never,
  part: import('@docx-editor.dev/core-contract/store').OoxmlPart
): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  const measurer = createFixedMeasurer(6, 14);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source) {
        laid.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'test'));
      }
      return laid;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  });
}

describe('section-aware pagination (cover + furniture)', () => {
  test('comprehensive fixture: 2-inch cover margin, cover-only page 1, no cover HF', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const sections = enumerateDocumentSections(part);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0]!.properties.margins.topTwips).toBe(2880);
    expect(sections[0]!.properties.breakType).toBe('nextPage');

    const hf = resolveHeaderFooterPartsBySection(loaded.package);
    expect(hf[0]!.headers.size).toBe(0);
    expect(hf[0]!.footers.size).toBe(0);
    expect(hf[1]!.headers.size).toBeGreaterThan(0);

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      sectionFurniture: furnitureFor(loaded.package, part),
    });

    const cover = layout.pages[0]!;
    expect(cover.contentBox.y - cover.box.y).toBe(144); // 2880 twips = 144pt
    expect(cover.header).toBeUndefined();
    expect(cover.footer).toBeUndefined();
    const coverText = pageText(layout, 0);
    expect(coverText).toMatch(/COMPREHENSIVE/i);
    expect(coverText).not.toMatch(/Table\s+of\s+Contents/i);

    const second = layout.pages[1]!;
    expect(second.contentBox.y - second.box.y).toBe(72); // 1-inch body margin
    expect(second.header).toBeDefined();
    expect(pageText(layout, 1)).toMatch(/Table\s+of\s+Contents/i);
  });

  test('minimal two-section package: cover has no furniture; body inherits nothing from cover', () => {
    const headerXml = `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>BODY HDR</w:t></w:r></w:p></w:hdr>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId6" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(headerXml),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>COVER</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:sectPr>' +
          '<w:pgSz w:w="12240" w:h="15840"/>' +
          '<w:pgMar w:top="2880" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
          '</w:sectPr></w:pPr></w:p>' +
          '<w:p><w:r><w:t>BODY</w:t></w:r></w:p>' +
          '<w:sectPr>' +
          '<w:headerReference w:type="default" r:id="rId6"/>' +
          '<w:pgSz w:w="12240" w:h="15840"/>' +
          '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
          '</w:sectPr>' +
          '</w:body></w:document>'
      ),
    });

    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    expect(bySection[0]!.headers.size).toBe(0);
    expect(bySection[1]!.headers.get('default')?.name).toBe('/word/header1.xml');

    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      sectionFurniture: furnitureFor(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    expect(layout.pages[0]!.header).toBeUndefined();
    expect(pageText(layout, 0)).toContain('COVER');
    expect(pageText(layout, 0)).not.toContain('BODY');
    expect(layout.pages[1]!.header).toBeDefined();
    expect(pageText(layout, 1)).toContain('BODY');
  });

  test('a later section with no refs inherits earlier furniture (ECMA-376 §17.10.1)', () => {
    const headerXml = `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>INHERITED</w:t></w:r></w:p></w:hdr>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId8" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(headerXml),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>first</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:sectPr>' +
          '<w:headerReference w:type="default" r:id="rId8"/>' +
          '<w:type w:val="continuous"/>' +
          '</w:sectPr></w:pPr></w:p>' +
          '<w:p><w:r><w:t>second</w:t></w:r></w:p>' +
          '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>' +
          '</w:body></w:document>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    expect(bySection).toHaveLength(2);
    expect(bySection[0]!.headers.get('default')?.name).toBe('/word/header1.xml');
    expect(bySection[1]!.headers.get('default')?.name).toBe('/word/header1.xml');
  });
});
