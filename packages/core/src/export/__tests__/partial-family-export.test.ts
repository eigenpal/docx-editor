// A family that the host serves for some faces only exports every face in that family.
//
// The host serves the regular and bold faces of a swiss family through its stand-in, and no
// italic. The document default is serif, so the class fallback of the family is a sans-serif
// face that the host also has. The italic must draw from the stand-in, like the faces that the
// host serves, and not from the class fallback or as unshaped text.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { sha256FontBytes } from '../../layout/index.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';
import { ExportResourceError } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../../layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );
const regularBytes = fixture('DejaVuSans.ttf');
const boldBytes = fixture('DejaVuSans-Bold.ttf');

type Style = 'normal' | 'italic';
const face = (family: string, weight: number, style: Style) => ({ family, weight, style });
const source = (family: string, weight: number, style: Style, bytes: Uint8Array) => ({
  request: face(family, weight, style),
  id: `${family}-${weight}-${style}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});
const FACES = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;

function partialFamilyDocument(): Uint8Array {
  const run = (text: string, italic: boolean) =>
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Brand Light" w:hAnsi="Brand Light"/>${italic ? '<w:i/>' : ''}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="r" Type="${OD}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="f" Type="${OD}/fontTable" Target="fontTable.xml"/><Relationship Id="s" Type="${OD}/styles" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${run('Regular text', false)}${run('Italic text', true)}</w:body></w:document>`
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}"><w:font w:name="Brand Light"><w:family w:val="swiss"/></w:font><w:font w:name="Times New Roman"><w:family w:val="roman"/></w:font></w:fonts>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    ),
  });
}

function partialFamilyFonts() {
  return {
    sources: [
      source('Stand In', 400, 'normal', regularBytes),
      source('Stand In', 700, 'normal', boldBytes),
      ...FACES.map(([weight, style]) =>
        source('Liberation Sans', weight, style, weight === 700 ? boldBytes : regularBytes)
      ),
      ...FACES.map(([weight, style]) => source('Liberation Serif', weight, style, regularBytes)),
    ],
    substitutions: [
      ...([400, 700] as const).map((weight) => ({
        from: face('Brand Light', weight, 'normal'),
        to: face('Stand In', weight, 'normal'),
      })),
      ...FACES.map(([weight, style]) => ({
        from: face('Arial', weight, style),
        to: face('Liberation Sans', weight, style),
      })),
      ...FACES.map(([weight, style]) => ({
        from: face('Times New Roman', weight, style),
        to: face('Liberation Serif', weight, style),
      })),
      // The export default family, so that only the partial family is incomplete.
      ...FACES.map(([weight, style]) => ({
        from: face('Calibri', weight, style),
        to: face('Liberation Sans', weight, style),
      })),
    ],
  };
}

test('an italic that the host does not serve exports from the family that serves the rest', async () => {
  const opened = await openFontBackedDocumentForExport(partialFamilyDocument(), {
    fonts: partialFamilyFonts(),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const drawnFrom = (weight: number, style: Style) =>
      opened.session.admittedFontFace(face('Brand Light', weight, style))?.family;
    expect(drawnFrom(400, 'normal')).toBe('Stand In');
    expect(drawnFrom(700, 'normal')).toBe('Stand In');
    expect(drawnFrom(400, 'italic')).toBe('Stand In');
    expect(drawnFrom(700, 'italic')).toBe('Stand In');
    // The italic draws as a synthesized style, which does not complete the family.
    const brand = opened.session.fontResolution.families.find(
      (entry) => entry.family === 'Brand Light'
    );
    expect(brand?.faces.map(({ weight, style }) => `${weight} ${style}`)).toEqual([
      '400 normal',
      '700 normal',
      '400 italic',
      '700 italic',
    ]);
    expect(brand?.coverage).toBe('partial');
  } finally {
    opened.session.dispose();
  }
});

test('strict font policy still refuses a family whose italic is synthesized', async () => {
  let refusal: unknown;
  try {
    const opened = await openFontBackedDocumentForExport(partialFamilyDocument(), {
      fonts: partialFamilyFonts(),
      fontPolicy: 'strict',
    });
    if (opened.ok) opened.session.dispose();
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(ExportResourceError);
  expect((refusal as Error).message).toMatch(/incomplete families: Brand Light$/);
});

/** The family's own bytes for the regular and bold faces, beside a complete class fallback. */
function ownFacesFonts() {
  const fonts = partialFamilyFonts();
  return {
    sources: [
      source('Brand Light', 400, 'normal', regularBytes),
      source('Brand Light', 700, 'normal', boldBytes),
      ...fonts.sources.filter(({ request }) => request.family !== 'Stand In'),
    ],
    substitutions: fonts.substitutions.filter(({ from }) => from.family !== 'Brand Light'),
  };
}

test('an italic that a family lacks exports from its own faces, not its class fallback', async () => {
  const opened = await openFontBackedDocumentForExport(partialFamilyDocument(), {
    fonts: ownFacesFonts(),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const drawnFrom = (weight: number, style: Style) =>
      opened.session.admittedFontFace(face('Brand Light', weight, style))?.family;
    for (const [weight, style] of FACES) expect(drawnFrom(weight, style)).toBe('Brand Light');
    const brand = opened.session.fontResolution.families.find(
      (entry) => entry.family === 'Brand Light'
    );
    expect(brand?.coverage).toBe('partial');
  } finally {
    opened.session.dispose();
  }
});

test('strict font policy refuses a family whose own italic is synthesized', async () => {
  let refusal: unknown;
  try {
    const opened = await openFontBackedDocumentForExport(partialFamilyDocument(), {
      fonts: ownFacesFonts(),
      fontPolicy: 'strict',
    });
    if (opened.ok) opened.session.dispose();
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(ExportResourceError);
  expect((refusal as Error).message).toMatch(/incomplete families: Brand Light$/);
});
