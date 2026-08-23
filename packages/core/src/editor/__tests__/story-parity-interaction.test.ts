// Interaction indexes reach every story the page draws.
//
// These are the lanes that answer "what is under the pointer". Each walked `page.fragments`
// alone, so a table or a link painted in a header was there, visible, and inert: the table
// offered no row or column handles on hover, and clicking the link opened no popover.
//
// Geometry is the trap in widening them. A story's fragments are laid out relative to its OWN
// box, not to the page content box, so an index that records them against the body's origin
// puts every handle at the wrong point on the page rather than fixing anything. The table
// occurrence carries its origin for exactly that reason.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { tableInteractionIndex } from '../../layout/semantic-table-interaction.ts';
import { paragraphTextFromLayout } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const HEADER_R_ID = 'rId10';
const LINK_R_ID = 'rId30';
const LINK_URL = 'https://example.test/from-a-header';

/** A one-row, two-column table. */
const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

/** An external hyperlink run. */
const LINK =
  `<w:p><w:hyperlink r:id="${LINK_R_ID}"><w:r><w:t>Sample document</w:t></w:r>` +
  '</w:hyperlink></w:p>';

/** A block content control, so the header carries one too. */
const CONTROL =
  '<w:sdt><w:sdtPr><w:tag w:val="hdrControl"/><w:id w:val="7"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Controlled</w:t></w:r></w:p></w:sdtContent></w:sdt>';

function docx(): Uint8Array {
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
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    // The header carries BOTH a table and an external link.
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${LINK_R_ID}" Type="${R}/hyperlink" Target="${LINK_URL}"` +
        ' TargetMode="External"/></Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}">${LINK}${TABLE}${CONTROL}</w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t>Body</w:t></w:r></w:p>${TABLE}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
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
  const editor = createDocxEditor({ document: docx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

describe('the table hover index covers every story', () => {
  test('a table in a header is indexed, against its own origin', () => {
    const editor = mount();
    const layout = editor.surface!.layout();
    const page = layout.pages[0]!;
    const header = page.header;
    expect(header, 'the fixture painted no header').toBeDefined();

    const occurrences = tableInteractionIndex(layout).occurrences;
    // Both tables: the body's and the header's. Only the body's used to be here, so hovering
    // the header's offered no row or column handles at all.
    expect(occurrences.length, 'the header table was not indexed').toBeGreaterThan(1);

    const origins = new Set(occurrences.map((occ) => occ.pageContentBox));
    expect(origins.has(page.contentBox), 'the body table lost its origin').toBe(true);
    // The header's occurrence carries the HEADER's box. Recording it against the body's
    // content box would place every handle at the wrong point on the page.
    expect(origins.has(header!.box), 'the header table was indexed at the body origin').toBe(true);
  });
});

describe('a link resolves from the story it is in', () => {
  test('a header link is found while the caret is in the body', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.activeScope()).toEqual({ kind: 'body' });

    // The id the painted header link carries. Reading it from the layout rather than guessing.
    const linkId = headerLinkId(editor);
    expect(linkId, 'the header link was never projected').toBeDefined();

    // `linkById` used to scan the paragraphs of whatever story was OPEN, so a reader in the
    // body who clicked a header link got null and no popover ever opened.
    const link = surface.hyperlinks.linkById(linkId!);
    expect(link, 'the header link did not resolve from the body').not.toBeNull();
    expect(link?.href).toBe(LINK_URL);
  });
});

/** The `w:hyperlink` node id inside the header part, which is what a link id is. */
function headerLinkId(editor: DocxEditorInstance): string | undefined {
  const part = editor.surface!.session.currentPackage().parts.get('/word/header1.xml');
  if (!part) return undefined;
  const walk = (node: OoxmlNode): string | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.localName === 'hyperlink') return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(part.root);
}
describe('content-control geometry is body-only, and says so', () => {
  test('a control in a header publishes no boundary', () => {
    const editor = mount();
    const layout = editor.surface!.layout();

    // KNOWN LIMIT, pinned so it is a decision rather than a surprise. The boundary derivation
    // is a single-part pass over the body, and the layout only ever receives furniture as
    // laid-out fragments plus a part NAME — it never holds the header's part object. So a
    // control in a header has no geometry, and its outline cannot draw or hit-test.
    //
    // The behaviour built on it does work: `contentControlAt` resolves a furniture control
    // through the tree rather than through geometry, which is why editing one is fine.
    // Fixing the chrome means threading furniture parts into the layout's boundary pass.
    expect((layout.contentControls ?? []).some((entry) => entry.tag === 'hdrControl')).toBe(false);
    // And the control IS reachable, so this is a missing OUTLINE, not a missing control. That
    // is what makes it a chrome limit rather than a functional one.
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const inControl = surface.session
      .paragraphIdsIn({ kind: 'headerFooter', rId: HEADER_R_ID })
      .find((id) => paragraphTextFromLayout(surface.layout(), id) === 'Controlled');
    expect(inControl, 'the header control holds no paragraph').toBeDefined();
    surface.setSelection({
      anchor: { paragraphId: inControl!, offset: 0 },
      head: { paragraphId: inControl!, offset: 0 },
    });
    expect(editor.query({ type: 'contentControlAt' })?.tag).toBe('hdrControl');
  });
});
