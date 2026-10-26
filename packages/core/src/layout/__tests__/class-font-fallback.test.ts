// A missing family falls back to a face of its own class, in measurement and in paint.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { FontSource, FontSourceSubstitution } from '../../contracts/editor.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import {
  fontFamilyClassFromName,
  fontTableFamilyClass,
} from '../../store/package/font-family-class.ts';
import { fontTableClasses } from '../../store/package/font-table-alternates.ts';
import { DEFAULT_CANVAS_FONT_STACK, fallbackStackForFamily } from '../canvas-measurer.ts';
import {
  admittedDocumentSubstitutions,
  applyDocumentFontSubstitutions,
  documentFontSubstitutionPlan,
  fallbacksForMissingFamilies,
} from '../document-font-substitution.ts';
import { composeFontConfiguration } from '../font-composition.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A Calibri document that sets one run in `family`, with an optional font table entry. */
function documentWith(
  family: string,
  tableEntry = `<w:font w:name="${family}"/>`,
  slots = `w:ascii="${family}" w:hAnsi="${family}"`
) {
  const opened = openHeadlessDocument(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts ${slots}/></w:rPr><w:t>Text</w:t></w:r></w:p></w:body></w:document>`
      ),
      'word/fontTable.xml': strToU8(`<w:fonts xmlns:w="${W}">${tableEntry}</w:fonts>`),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
      ),
    })
  );
  if (!opened.ok) throw new Error(opened.reason);
  return opened.view;
}

function source(family: string, weight: number, style: 'normal' | 'italic'): FontSource {
  return {
    request: { family, weight, style },
    id: `${family}-${weight}-${style}`,
    bytes: new Uint8Array([1]),
    hash: '0'.repeat(64),
    faceIndex: 0,
  };
}

const FACES = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;

/** Bundled faces under their own names, reached from Word names by host substitution. */
function hostFonts() {
  const pairs = [
    ['Calibri', 'Carlito'],
    ['Arial', 'Liberation Sans'],
    ['Times New Roman', 'Liberation Serif'],
    ['Courier New', 'Liberation Mono'],
  ] as const;
  const sources = pairs.flatMap(([, face]) =>
    FACES.map(([weight, style]) => source(face, weight, style))
  );
  const substitutions: FontSourceSubstitution[] = pairs.flatMap(([word, face]) =>
    FACES.map(([weight, style]) => ({
      from: { family: word, weight, style },
      to: { family: face, weight, style },
    }))
  );
  return composeFontConfiguration({ sources, substitutions });
}

function fallbackOf(family: string, tableEntry?: string, slots?: string): string | undefined {
  const document = documentWith(family, tableEntry, slots);
  const plan = documentFontSubstitutionPlan(document, [family]);
  const fonts = applyDocumentFontSubstitutions(hostFonts(), plan);
  return fonts.substitutions?.find(
    (substitution) => substitution.from.family === family && substitution.from.weight === 400
  )?.to.family;
}

test('the name and the font table state a family class', () => {
  expect(fontFamilyClassFromName('Lexington Serif')).toBe('serif');
  expect(fontFamilyClassFromName('Some Sans Serif')).toBe('sans');
  expect(fontFamilyClassFromName('Fira Mono')).toBe('mono');
  expect(fontFamilyClassFromName('Garamond')).toBe('serif');
  expect(fontFamilyClassFromName('Lexington')).toBeUndefined();
  expect(fontTableFamilyClass('roman', undefined)).toBe('serif');
  expect(fontTableFamilyClass('swiss', 'fixed')).toBe('mono');
  expect(fontTableFamilyClass('decorative', undefined)).toBeUndefined();
  const table = documentWith(
    'Lexington',
    '<w:font w:name="Lexington"><w:family w:val="roman"/></w:font>'
  );
  expect(fontTableClasses(table.currentPackage()).get('lexington')).toBe('serif');
});

test('a missing serif family falls back to the serif face, not the sans-serif default', () => {
  expect(fallbackOf('Lexington Serif')).toBe('Liberation Serif');
});

test('the font table class decides a family whose name states none', () => {
  expect(
    fallbackOf('Lexington', '<w:font w:name="Lexington"><w:family w:val="roman"/></w:font>')
  ).toBe('Liberation Serif');
  expect(
    fallbackOf('Lexington', '<w:font w:name="Lexington"><w:pitch w:val="fixed"/></w:font>')
  ).toBe('Liberation Mono');
});

test('a family of no stated class keeps the document default, through its host substitute', () => {
  expect(fallbackOf('Lexington')).toBe('Carlito');
});

test('a family that falls back is still reported as substituted', () => {
  const document = documentWith('Lexington Serif');
  const plan = documentFontSubstitutionPlan(document, ['Lexington Serif']);
  const fonts = applyDocumentFontSubstitutions(hostFonts(), plan);
  // The test configuration has no real bytes, so admission is judged by the planned target.
  const snapshot = { resolve: () => ({}) } as never;
  expect(admittedDocumentSubstitutions(fonts, plan, snapshot).has('lexington serif')).toBe(true);
});

test('a family the host maps itself is served, not reported as substituted', () => {
  // The host serves Lexington Serif with the same face the plan's fallback reaches.
  const document = documentWith('Lexington Serif');
  const plan = documentFontSubstitutionPlan(document, ['Lexington Serif']);
  const own = { family: 'Lexington Serif', weight: 400, style: 'normal' as const };
  const hostSubstitutions = [
    { from: own, to: { family: 'Liberation Serif', weight: 400, style: 'normal' as const } },
  ];
  const fonts = applyDocumentFontSubstitutions(
    composeFontConfiguration({ ...hostFonts(), substitutions: hostSubstitutions }),
    plan
  );
  const snapshot = { resolve: () => ({}) } as never;
  const reported = admittedDocumentSubstitutions(fonts, plan, snapshot, hostSubstitutions);
  expect(reported.has('lexington serif')).toBe(false);
});

test('paint and canvas measurement fall back through a stack of the same class', () => {
  expect(fallbackStackForFamily('Lexington Serif')).toContain('serif');
  expect(fallbackStackForFamily('Lexington Serif')).toContain('Liberation Serif');
  expect(fallbackStackForFamily('Fira Mono')).toContain('monospace');
  expect(fallbackStackForFamily('Lexington')).toBe(DEFAULT_CANVAS_FONT_STACK);
  expect(fallbackStackForFamily(null)).toBe(DEFAULT_CANVAS_FONT_STACK);
  // A host's own stack still serves a family of no class, but a classed family takes the class
  // stack in both paths: paint never sees the host's stack.
  expect(fallbackStackForFamily('Lexington', 'Custom, sans-serif')).toBe('Custom, sans-serif');
  expect(fallbackStackForFamily('Lexington Serif', 'Custom, sans-serif')).toBe(
    fallbackStackForFamily('Lexington Serif')
  );
});

test('a family the host already substitutes keeps the host face', () => {
  // Arial is not a source, but the host maps it to its metric twin; the document default's
  // substitute must not take its place.
  expect(fallbackOf('Arial')).toBe('Liberation Sans');
});

test('the document default family is not reported as a document substitution', () => {
  const document = documentWith('Calibri');
  const plan = documentFontSubstitutionPlan(document, ['Calibri']);
  const fonts = applyDocumentFontSubstitutions(hostFonts(), plan);
  const snapshot = { resolve: () => ({}) } as never;
  expect(admittedDocumentSubstitutions(fonts, plan, snapshot).has('calibri')).toBe(false);
});

test('a font table class that names an object property is no class at all', () => {
  const entry = '<w:font w:name="Example"><w:family w:val="constructor"/></w:font>';
  expect(fontTableFamilyClass('constructor', undefined)).toBeUndefined();
  expect(() =>
    documentFontSubstitutionPlan(documentWith('Example', entry), ['Example'])
  ).not.toThrow();
  expect(fallbackOf('Example', entry)).toBe('Carlito');
});

test('a classed family named in every script slot still falls back by its Latin slots', () => {
  // The East Asian and complex-script slot defaults differ from the Latin one, which made the
  // family ambiguous and left it with no substitution.
  const slots = `w:ascii="Lexington Serif" w:hAnsi="Lexington Serif" w:eastAsia="Lexington Serif" w:cs="Lexington Serif"`;
  expect(fallbackOf('Lexington Serif', undefined, slots)).toBe('Liberation Serif');
});

test('a family the platform has installed keeps its own face', () => {
  const document = documentWith('Georgia');
  const plan = documentFontSubstitutionPlan(document, ['Georgia']);
  expect(plan.fallbacks.get('georgia')).toBe('Times New Roman');
  const fallbacks = fallbacksForMissingFamilies(plan.fallbacks, (family) => family === 'georgia');
  const fonts = applyDocumentFontSubstitutions(hostFonts(), plan, fallbacks);
  expect(fonts.substitutions?.some((substitution) => substitution.from.family === 'Georgia')).toBe(
    false
  );
});
