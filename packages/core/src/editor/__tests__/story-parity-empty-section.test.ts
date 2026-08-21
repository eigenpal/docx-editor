// A section write from a header reaches the section the reader is looking at.
//
// A trailing body-level `w:sectPr` is minted as an EMPTY final section, which is ordinary in a
// multi-section package — and it is a section whose header a reader stands in. It holds no
// paragraph, so it has no anchor, and an anchor borrowed from elsewhere is not a smaller
// mistake than none: `targetSectionNodes` resolves an anchor to the first `w:sectPr` at or
// after it, so the first paragraph of the body pins the write to SECTION 0. An omitted anchor
// writes every section — broader than asked, but it does include the one the caller means.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { paragraphFragmentsOfBlocks } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const FIRST_R_ID = 'rId10';
const TAIL_R_ID = 'rId11';
const START_RIGHT = 2000;
const APPLIED_RIGHT = 4321;

/**
 * Two sections, the second EMPTY — every paragraph closes the first, and the body-level
 * `w:sectPr` mints the second with nothing in it. Each has its own header, so entering one
 * names the section unambiguously.
 */
function emptyTailSectionDocx(): Uint8Array {
  const margins = `<w:pgMar w:top="1440" w:right="${START_RIGHT}" w:bottom="1440" w:left="1440"/>`;
  const body =
    '<w:p><w:pPr><w:sectPr>' +
    `<w:headerReference w:type="default" r:id="${FIRST_R_ID}"/>${margins}` +
    '</w:sectPr></w:pPr><w:r><w:t>Only paragraph</w:t></w:r></w:p>';
  const override = (name: string): string =>
    `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.header+xml"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        override('header1.xml') +
        override('header2.xml') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${FIRST_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="${TAIL_R_ID}" Type="${R}/header" Target="header2.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>First</w:t></w:r></w:p></w:hdr>`
    ),
    'word/header2.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Tail</w:t></w:r></w:p></w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${TAIL_R_ID}"/>${margins}` +
        '</w:sectPr></w:body></w:document>'
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
  const editor = createDocxEditor({ document: emptyTailSectionDocx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

/** The right margin each section resolves to, in section order. */
function rightMargins(editor: DocxEditorInstance): number[] {
  const surface = editor.surface!;
  // Read through the layout's own pages, which is what the reader sees.
  const seen: number[] = [];
  for (const page of surface.layout().pages) {
    const [fragment] = paragraphFragmentsOfBlocks(page.fragments);
    if (!fragment) continue;
    seen.push(surface.sectionPropertiesAt(fragment.paragraphId).margins.rightTwips);
  }
  return seen;
}

describe('a section write from an empty section’s header still reaches it', () => {
  test('the tail section’s geometry moves, and not only section 0’s', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: TAIL_R_ID })).toBe(true);

    const result = editor.exec({
      type: 'setPageSetup',
      scope: 'section',
      marginRight: APPLIED_RIGHT,
    });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);

    // Borrowing the body's first paragraph as an anchor pinned this to section 0 and left the
    // page the reader was looking at untouched. The section the caret is in must move.
    const tail = surface.sectionProperties().margins.rightTwips;
    expect(tail, 'the tail section did not take the change').toBe(APPLIED_RIGHT);
    // And the section that does hold paragraphs is reachable at all, so this is not vacuous.
    expect(rightMargins(editor).length).toBeGreaterThan(0);
  });
});
