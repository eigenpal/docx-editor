// Navigation Find ordering and scope metadata across addressable Word stories.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function textbox(text: string): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Search box"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${p(text)}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function fixture(): Uint8Array {
  const section =
    '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
    '<w:footerReference w:type="default" r:id="rFooter"/></w:sectPr>';
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" ` +
    `xmlns:a="${A}" xmlns:wps="${WPS}"><w:body>` +
    p('needle body') +
    `<w:p>${textbox('needle textbox')}<w:pPr>${section}</w:pPr></w:p>` +
    section +
    '</w:body></w:document>';
  const contentTypes =
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
    '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
    '</Types>';
  const relationships =
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
    `<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>` +
    `<Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
    `<Relationship Id="rEndnotes" Type="${R}/endnotes" Target="endnotes.xml"/>` +
    '</Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(relationships),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('needle header')}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${p('needle footer')}</w:ftr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:id="-1" w:type="separator">${p('needle separator-only')}</w:footnote>` +
        `<w:footnote w:id="1">${p('needle footnote')}</w:footnote></w:footnotes>`
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">` +
        `<w:endnote w:id="-1" w:type="separator">${p('needle separator-only')}</w:endnote>` +
        `<w:endnote w:id="2">${p('needle endnote')}</w:endnote></w:endnotes>`
    ),
  });
}

function variantFixture(titlePage: boolean, evenAndOddHeaders: boolean): Uint8Array {
  const section =
    '<w:headerReference w:type="first" r:id="rFirst"/>' +
    '<w:headerReference w:type="even" r:id="rEven"/>' +
    (titlePage ? '<w:titlePg/>' : '');
  const settings = evenAndOddHeaders ? '<w:evenAndOddHeaders/>' : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header-first.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/header-even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${p('body')}<w:sectPr>${section}</w:sectPr></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rFirst" Type="${R}/header" Target="header-first.xml"/>` +
        `<Relationship Id="rEven" Type="${R}/header" Target="header-even.xml"/>` +
        `<Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/>` +
        '</Relationships>'
    ),
    'word/header-first.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('variant first')}</w:hdr>`),
    'word/header-even.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('variant even')}</w:hdr>`),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
  });
}

function open(bytes: Uint8Array = fixture()): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

describe('navigation Find stories', () => {
  test('searches stories in order with scopes and deduplicated furniture parts', () => {
    const matches = open().findText('needle').matches;

    expect(matches.map((match) => match.text)).toEqual(Array(5).fill('needle'));
    expect(matches.map((match) => match.paragraphIndex)).toEqual([0, 0, 0, 0, 0]);
    expect(matches.map((match) => match.scope)).toEqual([
      undefined,
      { kind: 'headerFooter', rId: 'rHeader' },
      { kind: 'headerFooter', rId: 'rFooter' },
      { kind: 'note', id: 'footnote:1' },
      { kind: 'note', id: 'endnote:2' },
    ]);
  });

  test('skips separator notes', () => {
    expect(open().findText('separator-only').matches).toEqual([]);
  });

  test('skips text-box stories until the surface can address them', () => {
    expect(open().findText('needle textbox').matches).toEqual([]);
  });

  test.each([
    [false, false, []],
    [true, false, ['variant first']],
    [false, true, ['variant even']],
    [true, true, ['variant first', 'variant even']],
  ] as const)(
    'searches only paintable first and even furniture for titlePage=%s evenAndOdd=%s',
    (titlePage, evenAndOddHeaders, expected) => {
      const matches = open(variantFixture(titlePage, evenAndOddHeaders)).findText(
        'variant'
      ).matches;

      expect(matches.map((match) => match.contextAfter.trim())).toEqual(
        expected.map((text) => text.slice('variant'.length).trim())
      );
      expect(matches.map((match) => match.scope)).toEqual(
        expected.map((text) => ({
          kind: 'headerFooter',
          rId: text.endsWith('first') ? 'rFirst' : 'rEven',
        }))
      );
    }
  );

  test('applies one match budget across story boundaries', () => {
    const result = open().findText('needle', { limit: 4 });

    expect(result.matches).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });
});
