// List number formats in the `text/html` clipboard flavor: copy writes the CSS counter style of
// each level's `w:numFmt`, and paste reads it back.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { strFromU8, strToU8, writeZip } from '../../store/package/zip.ts';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { interopHtmlFromFragment } from '../clipboard-html-write.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** A copied fragment: one list paragraph in a one-level list with `numFmt`. */
function copiedList(numFmt: string): string {
  const entries = new Map<string, Uint8Array>([
    [
      '[Content_Types].xml',
      strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
          `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/>` +
          '</Types>'
      ),
    ],
    [
      '_rels/.rels',
      strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" ` +
          'Target="word/document.xml"/></Relationships>'
      ),
    ],
    [
      'word/_rels/document.xml.rels',
      strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${R}/numbering" ` +
          'Target="numbering.xml"/></Relationships>'
      ),
    ],
    [
      'word/numbering.xml',
      strToU8(
        `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
          `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/></w:lvl>` +
          '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
      ),
    ],
    [
      'word/document.xml',
      strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/>` +
          '<w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p></w:body></w:document>'
      ),
    ],
  ]);
  return interopHtmlFromFragment(writeZip(entries));
}

/** The `w:numFmt` of the first level the pasted HTML list becomes. */
function pastedNumFmt(html: string): string | undefined {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(`projection refused: ${projected.reason}`);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(`read-back refused: ${read.reason}`);
  const numbering = strFromU8(read.package.partBytes.get('/word/numbering.xml')!);
  return /w:numFmt w:val="([^"]+)"/.exec(numbering)?.[1];
}

describe('list number formats in clipboard HTML', () => {
  test('copy writes the CSS counter style of an East Asian, Hebrew, or Indic format', () => {
    for (const [numFmt, css] of [
      ['chineseCountingThousand', 'simp-chinese-informal'],
      ['ideographLegalTraditional', 'trad-chinese-formal'],
      ['ideographTraditional', 'cjk-heavenly-stem'],
      ['hebrew1', 'hebrew'],
      ['thaiNumbers', 'thai'],
      ['hindiNumbers', 'devanagari'],
    ] as const) {
      expect([numFmt, copiedList(numFmt)]).toEqual([
        numFmt,
        expect.stringContaining(`<ol style="list-style-type:${css}">`),
      ]);
    }
  });

  test('copy writes decimal for a format without a CSS counter style', () => {
    // A receiver then shows the right number in another script, never a wrong number.
    expect(copiedList('koreanDigital')).toContain('<ol style="list-style-type:decimal">');
    expect(copiedList('aiueo')).toContain('<ol style="list-style-type:decimal">');
  });

  test('paste reads a CSS counter style back to its number format', () => {
    for (const [css, numFmt] of [
      ['simp-chinese-informal', 'chineseCountingThousand'],
      ['cjk-ideographic', 'taiwaneseCountingThousand'],
      ['thai', 'thaiNumbers'],
      ['upper-latin', 'upperLetter'],
      // A counter style without a number format stays decimal.
      ['hiragana', 'decimal'],
    ] as const) {
      const html = `<ol style="list-style-type:${css}"><li>item</li></ol>`;
      expect([css, pastedNumFmt(html)]).toEqual([css, numFmt]);
    }
  });

  test('a copied list pastes back with its number format', () => {
    for (const numFmt of ['chineseLegalSimplified', 'japaneseCounting', 'ideographZodiac']) {
      expect([numFmt, pastedNumFmt(copiedList(numFmt))]).toEqual([numFmt, numFmt]);
    }
  });
});
