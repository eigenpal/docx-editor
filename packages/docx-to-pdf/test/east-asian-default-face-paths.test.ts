/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The PDF and an editor that serves other fonts break the same lines: whether the document
// defaults name an East Asian face does not depend on which East Asian faces a host has. The
// PDF draws Noto Sans CJK JP; the editor's packaged fonts draw no CJK face at all.
import { expect, test } from 'bun:test';
import {
  createPackagedFileFetch,
  openFontBackedDocumentForExport,
} from '@docx-editor.dev/core/export';
import { HARD_MAX_FONT_BYTES, linesOf } from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT, packagedFonts } from '@docx-editor.dev/fonts';
import { openExportSession } from '../src/open-session.ts';
import { formatDefaultsDocx } from './fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORDS = Array.from({ length: 160 }, (_, i) => ['lorem', 'ipsum', 'dolor', 'amet'][i % 4]);

/** A Latin legacy document whose spaces shrink only beside an East Asian default face. */
function legacyDocument(eastAsia: string): Uint8Array {
  const styles =
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${eastAsia}"/>` +
    '<w:sz w:val="24"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>' +
    '</w:docDefaults></w:styles>';
  const settings =
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>` +
    '<w:compat><w:compatSetting w:name="compatibilityMode" ' +
    'w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>';
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) =>
      `<w:p><w:pPr><w:ind w:right="${i * 37}"/><w:jc w:val="both"/></w:pPr>` +
      `<w:r><w:t>${WORDS.join(' ')}</w:t></w:r></w:p>`
  ).join('');
  const relationships =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '</Relationships>';
  return formatDefaultsDocx(paragraphs, {
    'word/styles.xml': styles,
    'word/settings.xml': settings,
    'word/_rels/document.xml.rels': relationships,
  });
}

async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const opened = await openExportSession(bytes, { useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return linesOf(await opened.session.layout()).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  } finally {
    opened.session.dispose();
  }
}

async function editorLines(bytes: Uint8Array): Promise<string[]> {
  const fonts = packagedFonts({
    install: false,
    fetcher: createPackagedFileFetch({
      trustedRoot: new URL('./', FONT_ASSET_ROOT),
      maxBytes: HARD_MAX_FONT_BYTES,
    }),
  });
  const opened = await openFontBackedDocumentForExport(bytes, { fonts: [fonts] });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return linesOf(await opened.session.layout()).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  } finally {
    opened.session.dispose();
  }
}

test.each(['Noto Sans CJK JP', 'Noto Sans JP', 'MS Mincho'])(
  'the PDF and the editor fonts break the same lines with %s as the default face',
  async (face) => {
    const document = legacyDocument(face);
    const [pdf, editor] = await Promise.all([pdfLines(document), editorLines(document)]);
    expect(pdf.length).toBeGreaterThan(10);
    expect(editor).toEqual(pdf);
    // A Latin default face keeps natural spaces, so these documents do shrink theirs.
    expect(await pdfLines(legacyDocument('Times New Roman'))).not.toEqual(pdf);
  }
);
