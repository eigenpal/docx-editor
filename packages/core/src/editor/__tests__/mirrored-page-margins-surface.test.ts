// Mirrored side margins on the editing surface.
//
// `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) is a settings.xml flag. The
// surface reads it with the document, lays the pages out with it, and paints each page's
// content at the side its number gives. Typing on an even page and undo keep that side.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { openDocumentForExport } from '../../export/export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// US Letter: left 2in, right 0.5in, gutter 0.5in.
const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="720" ' +
  'w:bottom="1440" w:left="2880" w:header="720" w:footer="720" w:gutter="720"/></w:sectPr>';

function docx(settings: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraph('first page')}${pageBreak}` +
        `${paragraph('second page')}${pageBreak}${paragraph('third page')}${SECTION}</w:body></w:document>`
    ),
  });
}

function mount(settings: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(settings), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

const contentLefts = (surface: PaginatedSurface) =>
  surface.layout().pages.map((page) => page.contentBox.x - page.box.x);

const paintedLefts = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('.docx-page-content')].map((content) =>
    Number.parseFloat(content.style.left)
  );

describe('mirrored side margins on the surface', () => {
  test('layout and paint put an even page on the other side', () => {
    const { surface, container } = mount('<w:mirrorMargins/>');
    expect(contentLefts(surface)).toEqual([180, 36, 180]);
    expect(paintedLefts(container)).toEqual([180, 36, 180]);
  });

  test('a document without the setting, or with it off, keeps one side', () => {
    expect(contentLefts(mount('').surface)).toEqual([180, 180, 180]);
    expect(contentLefts(mount('<w:mirrorMargins w:val="0"/>').surface)).toEqual([180, 180, 180]);
  });

  test('even and odd headers move the gutter of an even page', () => {
    expect(contentLefts(mount('<w:evenAndOddHeaders/>').surface)).toEqual([180, 144, 180]);
  });

  test('typing on an even page and undo keep the page on its side', () => {
    const { surface, container } = mount('<w:mirrorMargins/>');
    const second = surface
      .layout()
      .pages[1]!.fragments.find((fragment) => fragment.kind === 'paragraph');
    if (!second || second.kind !== 'paragraph') throw new Error('no paragraph on page 2');
    surface.setSelection({
      anchor: { paragraphId: second.paragraphId, offset: 0 },
      head: { paragraphId: second.paragraphId, offset: 0 },
    });
    surface.type('X');
    expect(surface.session.bodyText()).toContain('Xsecond page');
    expect(contentLefts(surface)).toEqual([180, 36, 180]);
    expect(paintedLefts(container)).toEqual([180, 36, 180]);
    surface.undo();
    expect(surface.session.bodyText()).toContain('second page');
    expect(surface.session.bodyText()).not.toContain('Xsecond');
    expect(contentLefts(surface)).toEqual([180, 36, 180]);
  });

  test('the export session lays the same pages out', async () => {
    const opened = openDocumentForExport(docx('<w:mirrorMargins/>'));
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const { pages } = await opened.session.layout();
      expect(pages.map((page) => page.contentBox.x - page.box.x)).toEqual([180, 36, 180]);
    } finally {
      opened.session.dispose();
    }
  });
});
