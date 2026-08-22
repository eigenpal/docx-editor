// One header part serving several sections binds the section it is PAINTED on.
//
// A header can be the default of more than one section — inheritance makes that the ordinary
// shape — so "the first section that names this rId" is a different page's geometry from the
// one the reader is standing on. Entering programmatically left the section unbound and every
// downstream reader fell through to that first-naming guess: the ruler clamped to another
// page's margins, `insertTableOp` divided another page's width, and Page Setup wrote another
// section's `w:sectPr`.
//
// The pointer route always forwarded the page it clicked, so the two entries into the same
// header disagreed about the same paragraph. They must agree.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphFragmentsOfBlocks } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const SHARED_R_ID = 'rId10';
const PORTRAIT_WIDTH = 12240;
const LANDSCAPE_WIDTH = 15840;

/**
 * Two sections of different paper sharing ONE header part.
 *
 * Section 0 carries `w:titlePg` and declares no first-page header, so the shared part paints
 * only on section 1's page. "The first section that names this rId" is therefore section 0 — a
 * page the header never appears on, which is what makes the wrong answer visible.
 */
function sharedHeaderDocx(): Uint8Array {
  const section = (width: number, height: number, extra = ''): string =>
    `<w:sectPr>${extra}<w:headerReference w:type="default" r:id="${SHARED_R_ID}"/>` +
    `<w:pgSz w:w="${width}" w:h="${height}"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  const body =
    `<w:p><w:pPr>${section(PORTRAIT_WIDTH, 15840, '<w:titlePg/>')}</w:pPr>` +
    '<w:r><w:t>First section</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second section</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${SHARED_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Shared letterhead</w:t></w:r></w:p></w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `${section(LANDSCAPE_WIDTH, 12240)}</w:body></w:document>`
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: sharedHeaderDocx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

/** The shared header's paragraph, and the page index it is painted on. */
function paintedHeader(editor: DocxEditorInstance): {
  readonly paragraphId: string;
  readonly pageIndex: number;
} {
  const pages = editor.surface!.layout().pages;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const [fragment] = paragraphFragmentsOfBlocks(pages[pageIndex]!.header?.fragments ?? []);
    if (fragment) return { paragraphId: fragment.paragraphId, pageIndex };
  }
  throw new Error('the shared header was never painted');
}

describe('a shared header binds the section it is painted on', () => {
  test('entering by rId alone agrees with entering by page', () => {
    const editor = mount();
    const surface = editor.surface!;
    const { paragraphId, pageIndex } = paintedHeader(editor);
    const painted = surface.sectionAtPage(pageIndex).sectionIndex;

    // By rId ALONE — the programmatic route, which used to leave the section unbound.
    expect(surface.enterHeaderFooter({ rId: SHARED_R_ID })).toBe(true);
    expect(surface.headerFooterState()?.sectionIndex, 'bound the wrong section').toBe(painted);
    const viaRId = surface.sectionPropertiesAt(paragraphId).pageSize.widthTwips;
    surface.exitHeaderFooter();

    // By PAGE — the pointer route, which always forwarded it.
    expect(surface.enterHeaderFooter({ rId: SHARED_R_ID, pageIndex, sectionIndex: painted })).toBe(
      true
    );
    const viaPage = surface.sectionPropertiesAt(paragraphId).pageSize.widthTwips;

    expect(viaRId, 'the two entry routes disagree about the same header').toBe(viaPage);
    // And it is the page the header actually appears on, not the first section naming it.
    expect(viaRId).toBe(LANDSCAPE_WIDTH);
  });

  test('page setup from that header writes its own section', async () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: SHARED_R_ID })).toBe(true);

    const result = editor.exec({ type: 'setPageSetup', scope: 'section', marginRight: 4321 });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);

    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    // The paragraph-level `w:sectPr` is section 0 and the body-level one is section 1. Only
    // the second may have moved: writing section 0 changes a page this header never shows on.
    const rights = [...xml.matchAll(/w:right="(\d+)"/g)].map((match) => match[1]);
    expect(rights).toEqual(['1440', '4321']);
  });
});
