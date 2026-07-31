// Safe PAGE / NUMPAGES field projection: allowlist, hostile instructions, and layout geometry.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  allowlistedPageField,
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  MAX_FIELD_INSTRUCTION_CHARS,
  normalizeFieldInstruction,
  piecesOfParagraph,
  projectPageFieldValue,
  type PageFurniture,
} from '../index.ts';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

const measurer = createFixedMeasurer(6, 14);

function parsePart(xml: string): OoxmlPart {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${xml}<w:sectPr/></w:body></w:document>`
    ),
  };
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error('load failed');
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

function footerDoc(footerBody: string, body = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${footerBody}</w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

function storyText(part: OoxmlPart, pageContext?: { pageNumber: number; pageCount: number }): string {
  const story = layoutHeaderFooterStory(part, 400, measurer, 'test', undefined, undefined, pageContext);
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans.map((s) => s.text)) : []
    )
    .join('');
}

function furnitureFromPackage(
  pkg: import('@docx-editor.dev/core-contract/store').OoxmlPackage,
  part: OoxmlPart
): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
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

describe('field instruction allowlist', () => {
  test('normalizes and accepts only exact PAGE / NUMPAGES', () => {
    expect(normalizeFieldInstruction('  page  ')).toBe('PAGE');
    expect(normalizeFieldInstruction('NUMPAGES \\* MERGEFORMAT')).toBe('NUMPAGES');
    expect(allowlistedPageField('PAGE')).toBe('PAGE');
    expect(allowlistedPageField(' numpages ')).toBe('NUMPAGES');
    expect(allowlistedPageField('PAGE \\* MERGEFORMAT')).toBe('PAGE');
  });

  test('rejects hostile and non-allowlisted instructions', () => {
    expect(allowlistedPageField('INCLUDETEXT "http://evil"')).toBeNull();
    expect(allowlistedPageField('DDEAUTO Excel')).toBeNull();
    expect(allowlistedPageField('DATE')).toBeNull();
    expect(allowlistedPageField('TOC \\o "1-3"')).toBeNull();
    expect(allowlistedPageField('PAGE \\n Arabic')).toBeNull();
    expect(allowlistedPageField('P')).toBeNull();
    expect(normalizeFieldInstruction('x'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1))).toBeNull();
  });

  test('projectPageFieldValue emits decimal digits', () => {
    expect(projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 26 })).toBe('2');
    expect(projectPageFieldValue('NUMPAGES', { pageNumber: 2, pageCount: 26 })).toBe('26');
  });
});

describe('complex field piece projection', () => {
  test('empty PAGE/NUMPAGES project under page context and keep surrounding offsets', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:t>Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 2, pageCount: 26 });
    expect(pieces.map((p) => p.text)).toEqual(['Page ', '2', ' of ', '26']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 5 });
    expect(pieces[1]).toMatchObject({ start: 5, end: 5, projected: true });
    expect(pieces[2]).toMatchObject({ start: 5, end: 9 });
    expect(pieces[3]).toMatchObject({ start: 9, end: 9, projected: true });
  });

  test('without page context empty fields stay empty', () => {
    const part = parsePart(
      `<w:p><w:r><w:t>Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(piecesOfParagraph(paragraph).map((p) => p.text)).toEqual(['Page ']);
  });

  test('non-allowlisted fields keep cached result text and never evaluate', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE \\@ "yyyy"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1999</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(piecesOfParagraph(paragraph, [], { pageNumber: 1, pageCount: 9 }).map((p) => p.text)).toEqual([
      '1999',
    ]);
  });

  test('INCLUDETEXT stays inert even with a result', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>INCLUDETEXT "http://evil.example/x"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>cached</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(piecesOfParagraph(paragraph, [], { pageNumber: 1, pageCount: 2 }).map((p) => p.text)).toEqual([
      'cached',
    ]);
  });

  test('allowlisted projection replaces stale cached PAGE result', () => {
    const part = parsePart(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
    expect(piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 }).map((p) => p.text)).toEqual([
      '7',
    ]);
  });
});

describe('header/footer page-context layout cache', () => {
  test('withPageContext projects distinct digit widths per page key', () => {
    const bytes = footerDoc(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4000"/></w:tabs></w:pPr>` +
        `<w:r><w:t>L</w:t><w:tab/></w:r>` +
        `<w:r><w:t>Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((p) => p.name.includes('footer1'))!;
    const baseline = layoutHeaderFooterStory(footer, 300, measurer, 'test');
    expect(storyText(footer)).toBe('L\tPage  of ');
    const page2 = baseline.withPageContext({ pageNumber: 2, pageCount: 26 });
    const page10 = baseline.withPageContext({ pageNumber: 10, pageCount: 26 });
    expect(
      page2.fragments
        .flatMap((f) => (f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []))
        .join('')
    ).toBe('L\tPage 2 of 26');
    expect(
      page10.fragments
        .flatMap((f) => (f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []))
        .join('')
    ).toBe('L\tPage 10 of 26');
    // Distinct digit widths → distinct right-tab advances for the same stop.
    const tabWidth = (story: typeof page2): number => {
      const spans = story.fragments.flatMap((f) =>
        f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans) : []
      );
      return spans.find((s) => s.text === '\t')!.box.width;
    };
    expect(tabWidth(page2)).not.toBe(tabWidth(page10));
    expect(baseline.withPageContext({ pageNumber: 2, pageCount: 26 })).toBe(page2);
  });
});

describe('document layout page index and page count', () => {
  test('footer fields show physical page index and total pages', () => {
    const body =
      Array.from({ length: 5 }, (_, i) => `<w:p><w:r><w:t>line ${i}</w:t></w:r></w:p>`).join('') +
      Array.from({ length: 20 }, () => `<w:p><w:r><w:t>${'x'.repeat(40)}</w:t></w:r></w:p>`).join('');
    const bytes = footerDoc(
      `<w:p><w:r><w:t>Page </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t> of </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      body
    );
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      geometry: {
        width: 200,
        height: 100,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pageCount = layout.pages.length;
    for (const page of layout.pages) {
      const text = page.footer?.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('');
      expect(text).toBe(`Page ${page.index + 1} of ${pageCount}`);
      expect(page.footer?.pageFieldProjector).toBeUndefined();
    }
  });
});

describe('comprehensive fixture footer PAGE/NUMPAGES', () => {
  test('body page footer shows Page N of totalPages', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pageCount = layout.pages.length;
    // Cover (index 0) has no HF; first body sheet with footer1 is index 1.
    const page = layout.pages[1]!;
    expect(page.footer).toBeDefined();
    const text = page.footer!.fragments
      .flatMap((f) =>
        f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
      )
      .join('');
    expect(text).toContain(`Page 2 of ${pageCount}`);
    expect(text).toMatch(/QA Automation Department/);
  });

  test('cover stays bare; remapped body furniture keeps authored sheet-relative Y', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const sections = enumerateDocumentSections(part);
    const bodyGeometry = geometryOfSection(sections[1]!.properties);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureFromPackage(loaded.package, part),
    });

    expect(layout.pages[0]!.header).toBeUndefined();
    expect(layout.pages[0]!.footer).toBeUndefined();

    for (let index = 1; index < Math.min(layout.pages.length, 4); index += 1) {
      const page = layout.pages[index]!;
      expect(page.header).toBeDefined();
      expect(page.footer).toBeDefined();
      expect(page.header!.box.y - page.box.y).toBeCloseTo(bodyGeometry.headerDistance ?? 36, 5);
      expect(
        page.box.y + page.box.height - (page.footer!.box.y + page.footer!.box.height)
      ).toBeCloseTo(bodyGeometry.footerDistance ?? 36, 5);
      const text = page.footer!.fragments
        .flatMap((f) =>
          f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans.map((s) => s.text)) : []
        )
        .join('');
      expect(text).toContain(`Page ${index + 1} of ${layout.pages.length}`);
    }
  });
});
