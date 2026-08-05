// Where a themed document's font comes from: the theme part, through `w:rFonts`.
//
// Word states the body face once, as `w:asciiTheme="minorHAnsi"` in `w:docDefaults`, and the
// heading face as `majorHAnsi` on the heading styles. A template built that way names no
// concrete font anywhere, so a lane that reads only `w:ascii`/`w:hAnsi` resolves EVERY run to
// no family and measures and paints the whole document in the surface's fallback face — the
// author's theme is invisible even when the reader has both fonts installed.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Body font by theme reference in `w:docDefaults`; heading font by theme on the style. */
const STYLES: OoxmlElement = part(
  '/word/styles.xml',
  `<w:styles xmlns:w="${W}">
    <w:docDefaults>
      <w:rPrDefault>
        <w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr>
      </w:rPrDefault>
    </w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Heading2">
      <w:name w:val="heading 2"/>
      <w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/></w:rPr>
    </w:style>
  </w:styles>`
).root;

const THEME = { major: 'Aharoni', minor: 'Grandview' };

const BODY =
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Experience</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Body text</w:t></w:r></w:p>`;

function familiesOf(themeFonts: { major: string | null; minor: string | null }) {
  const document = part(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
  );
  const layout = layoutSemanticDocument(document, 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: buildStyleCascadeTable(STYLES, themeFonts),
  });
  return paragraphFragmentsOf(layout.pages[0]!).map(
    (fragment) => fragment.lines[0]?.spans[0]?.style.fontFamily ?? null
  );
}

describe('a themed document lays out in its theme fonts', () => {
  test('major for headings, minor for body — neither named anywhere but the theme', () => {
    expect(familiesOf(THEME)).toEqual(['Aharoni', 'Grandview']);
  });

  test('without a theme every run falls through to the surface default', () => {
    // The regression this guards: the document renders, and renders entirely wrong.
    expect(familiesOf({ major: null, minor: null })).toEqual([null, null]);
  });

  test('retheming changes the cascade token, so cached breaks are not reused', () => {
    // The faces change while no style material moves; a token blind to the theme would
    // hand back lines measured in the old font.
    const before = buildStyleCascadeTable(STYLES, THEME).cacheToken;
    const after = buildStyleCascadeTable(STYLES, { major: 'Georgia', minor: 'Verdana' }).cacheToken;
    expect(before).not.toBe(after);
  });
});
