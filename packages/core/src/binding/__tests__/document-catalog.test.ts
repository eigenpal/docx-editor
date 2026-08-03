// Document catalogs over the tree session: fonts in use and style definitions.
//
// What these pin down: the derivation reads run-level `w:rFonts`, the styles part
// (docDefaults AND `w:style` rPr), and header parts; hostile names from the file are
// dropped at the derivation boundary rather than passed to chrome; the answers are
// memoized but survive edits; and a document without a styles part answers empty.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(options: { body: string; styles?: string; header?: string }): Uint8Array {
  const { body, styles, header } = options;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        (header
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  const documentRels: string[] = [];
  if (styles) {
    files['word/styles.xml'] = strToU8(styles);
    documentRels.push(`<Relationship Id="rId10" Type="${STYLES_REL}" Target="styles.xml"/>`);
  }
  if (header) {
    files['word/header1.xml'] = strToU8(header);
    documentRels.push(`<Relationship Id="rId11" Type="${HEADER_REL}" Target="header1.xml"/>`);
  }
  if (documentRels.length > 0) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL_NS}">${documentRels.join('')}</Relationships>`
    );
  }
  return zipSync(files);
}

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

const run = (font: string, text: string) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>${text}</w:t></w:r>`;

const STYLES_XML =
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr></w:style>' +
  // No w:name: the display name falls back to the styleId.
  '<w:style w:type="table" w:styleId="TableGrid"/>' +
  // Unknown type: not a pickable style kind, dropped.
  '<w:style w:type="weird" w:styleId="Bogus"><w:name w:val="Bogus"/></w:style>' +
  '</w:styles>';

describe('documentFonts', () => {
  test('collects run, docDefaults, style-rPr, and header fonts, deduped and sorted', () => {
    const session = open(
      docx({
        body:
          `<w:p>${run('Calibri', 'one')}${run('Arial', 'two')}</w:p>` +
          // Same family, different casing: collapses to the first-seen spelling.
          `<w:p>${run('arial', 'three')}</w:p>` +
          // The section references the header, which is what makes its part resolve.
          `<w:sectPr><w:headerReference xmlns:r="${R}" w:type="default" r:id="rId11"/></w:sectPr>`,
        styles: STYLES_XML,
        header: `<w:hdr xmlns:w="${W}"><w:p>${run('Impact', 'head')}</w:p></w:hdr>`,
      })
    );
    // Sorted by code point; `arial` deduped into first-seen `Arial`; `MS Mincho` comes
    // from the eastAsia attribute and `Georgia` from a style's rPr.
    expect(session.documentFonts()).toEqual([
      'Arial',
      'Calibri',
      'Cambria',
      'Georgia',
      'Impact',
      'MS Mincho',
    ]);
  });

  test('header fonts require the header to be referenced by the section', () => {
    // The header PART exists but no sectPr references it, so resolveHeaderFooterParts
    // resolves nothing — its fonts must not leak in through mere part presence.
    const session = open(
      docx({
        body: `<w:p>${run('Calibri', 'x')}</w:p>`,
        header: `<w:hdr xmlns:w="${W}"><w:p>${run('Impact', 'head')}</w:p></w:hdr>`,
      })
    );
    expect(session.documentFonts()).toEqual(['Calibri']);
  });

  test('hostile names are dropped: over-length and control characters', () => {
    const long = 'A'.repeat(500);
    const session = open(
      docx({
        body: `<w:p>${run(long, 'a')}${run('Bad&#x09;Name', 'b')}${run('Calibri', 'c')}</w:p>`,
      })
    );
    expect(session.documentFonts()).toEqual(['Calibri']);
  });

  test('memoized per revision, and an edit does not lose fonts', () => {
    const session = open(docx({ body: `<w:p>${run('Calibri', 'hello')}</w:p>` }));
    const first = session.documentFonts();
    expect(session.documentFonts()).toBe(first);
    const [paragraphId] = session.paragraphIds();
    const applied = session.applyTreeOps([
      { op: 'insertText', paragraphId: paragraphId!, offset: 0, text: 'Z' },
    ]);
    expect(applied.committed).toBe(true);
    expect(session.documentFonts()).toEqual(['Calibri']);
  });
});

describe('documentStyles', () => {
  test('returns the accepted definitions with name fallback and type filtering', () => {
    const session = open(docx({ body: '<w:p><w:r><w:t>x</w:t></w:r></w:p>', styles: STYLES_XML }));
    expect(
      session.documentStyles().map(({ styleId, name, type }) => ({ styleId, name, type }))
    ).toEqual([
      { styleId: 'Normal', name: 'Normal', type: 'paragraph' },
      { styleId: 'Strong', name: 'Strong', type: 'character' },
      // Missing w:name falls back to the styleId; the 'weird'-typed style is dropped.
      { styleId: 'TableGrid', name: 'TableGrid', type: 'table' },
    ]);
    // Every entry carries a preview for a picker to render the row in its own face.
    for (const entry of session.documentStyles()) {
      expect(entry.preview).toBeDefined();
    }
    // Memoized once: the styles part is immutable in-session.
    expect(session.documentStyles()).toBe(session.documentStyles());
  });

  test('hostile definitions are dropped or repaired at the boundary', () => {
    const longId = 'S'.repeat(200);
    const styles =
      `<w:styles xmlns:w="${W}">` +
      `<w:style w:type="paragraph" w:styleId="${longId}"><w:name w:val="Long"/></w:style>` +
      '<w:style w:type="paragraph" w:styleId="Ok"><w:name w:val="Ctl&#x09;Name"/></w:style>' +
      '</w:styles>';
    const session = open(docx({ body: '<w:p><w:r><w:t>x</w:t></w:r></w:p>', styles }));
    // The over-length styleId is unaddressable (dropped); the control-character name
    // falls back to the valid styleId.
    expect(
      session.documentStyles().map(({ styleId, name, type }) => ({ styleId, name, type }))
    ).toEqual([{ styleId: 'Ok', name: 'Ok', type: 'paragraph' }]);
  });

  test('a document without a styles part answers empty', () => {
    const session = open(docx({ body: '<w:p><w:r><w:t>x</w:t></w:r></w:p>' }));
    expect(session.documentStyles()).toEqual([]);
  });
});
