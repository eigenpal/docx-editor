import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

function themedBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rStyles" Type="${OFFICE_REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rTheme" Type="${OFFICE_REL}/theme" Target="theme/theme1.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>漢字</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        '<w:rFonts w:eastAsiaTheme="minorEastAsia"/>' +
        '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
    ),
    'word/theme/theme1.xml': strToU8(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Parity">` +
        '<a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface="MS Gothic"/></a:majorFont>' +
        '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="SimSun"/></a:minorFont>' +
        '</a:fontScheme></a:themeElements></a:theme>'
    ),
  });
}

test('byte exports resolve the same East Asian theme face exposed by live layout', async () => {
  const opened = openDocumentForExport(themedBytes());
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  try {
    const layout = await opened.session.layout();
    const faces: Array<string | null> = [];
    forEachSemanticSpan(layout, ({ span }) => faces.push(span.style.fontFamilyEastAsia));
    expect(faces).toContain('SimSun');
  } finally {
    opened.session.dispose();
  }
});

test('invalid display modes never enter export-session caches', async () => {
  expect(() =>
    openDocumentForExport(new Uint8Array(), {
      displayMode: 'final' as never,
    })
  ).toThrow(RangeError);

  const opened = openDocumentForExport(themedBytes());
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    for (const invalid of ['final', 'all_markup', '']) {
      await expect(opened.session.layoutFor(invalid as never)).rejects.toThrow(RangeError);
    }
    expect((await opened.session.layoutFor('all-markup')).displayMode).toBe('all-markup');
  } finally {
    opened.session.dispose();
  }
});
