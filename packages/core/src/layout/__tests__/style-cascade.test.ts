// Bounded layout-side style cascade (docDefaults, basedOn, last-wins duplicates).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core-contract/store';
import {
  MAX_STYLE_BASED_ON_DEPTH,
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  cascadedBottomBorder,
  isValidStyleId,
} from '../style-cascade.ts';
import { resolveRunStyle } from '../run-style.ts';
import { paragraphSpacing } from '../paragraph-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadStyles(body: string): OoxmlElement {
  const result = readOoxmlPart(`<w:styles xmlns:w="${W}">${body}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function loadDocument(body: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const HEADING1_FIRST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:rPr><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style>`;

const HEADING1_LAST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:before="360" w:after="200"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/>` +
  `<w:color w:val="1B3A5C"/><w:sz w:val="36"/></w:rPr></w:style>`;

const HEADING2_LAST =
  `<w:style w:type="paragraph" w:styleId="Heading2">` +
  `<w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:before="280" w:after="160"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Arial"/><w:b/>` +
  `<w:color w:val="2E75B6"/><w:sz w:val="30"/></w:rPr></w:style>`;

const DOC_DEFAULTS =
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Arial"/><w:sz w:val="22"/>` +
  `</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>`;

describe('isValidStyleId guards attacker-controlled ids', () => {
  test('rejects empty, over-long, control, and dangerous keys', () => {
    expect(isValidStyleId(undefined)).toBe(false);
    expect(isValidStyleId('')).toBe(false);
    expect(isValidStyleId('a'.repeat(129))).toBe(false);
    expect(isValidStyleId('bad\nid')).toBe(false);
    expect(isValidStyleId('__proto__')).toBe(false);
    expect(isValidStyleId('constructor')).toBe(false);
    expect(isValidStyleId('Heading1')).toBe(true);
  });
});

describe('buildStyleCascadeTable last-wins and docDefaults', () => {
  test('duplicate Heading1 keeps the last definition', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_FIRST + HEADING1_LAST));
    const style = table.styles.get('Heading1')!;
    expect(resolveRunStyle(style.runProperties)).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 18,
      bold: true,
      color: '1B3A5C',
    });
    expect(paragraphSpacing(style.paragraphProperties)).toEqual({ before: 18, after: 10 });
  });

  test('docDefaults populate the table', () => {
    const table = buildStyleCascadeTable(loadStyles(DOC_DEFAULTS));
    expect(resolveRunStyle(table.docDefaultsRun)).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 11,
    });
  });
});

describe('cascadeParagraphFormatting basedOn, cycles, depth, overrides', () => {
  test('basedOn inherits parent size while own color wins', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="Base">` +
      `<w:rPr><w:sz w:val="40"/><w:color w:val="111111"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/>` +
      `<w:rPr><w:color w:val="AABBCC"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    const paragraph = part.root.children[0]!.children[0]!;
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    const cascaded = cascadeParagraphFormatting(table, pPr);
    expect(resolveRunStyle(cascaded.runProperties)).toMatchObject({
      fontSizePt: 20,
      color: 'AABBCC',
    });
  });

  test('basedOn cycles stop without hanging', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/>` +
      `<w:rPr><w:sz w:val="30"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/>` +
      `<w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    const paragraph = part.root.children[0]!.children[0]!;
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    const cascaded = cascadeParagraphFormatting(table, pPr);
    expect(resolveRunStyle(cascaded.runProperties)).toMatchObject({
      fontSizePt: 15,
      color: 'FF0000',
    });
  });

  test('basedOn depth is capped', () => {
    const parts: string[] = [];
    for (let i = 0; i <= MAX_STYLE_BASED_ON_DEPTH + 4; i += 1) {
      const id = `S${i}`;
      const based =
        i === 0 ? '' : `<w:basedOn w:val="S${i - 1}"/>`;
      const sz = 20 + i;
      parts.push(
        `<w:style w:type="paragraph" w:styleId="${id}">${based}` +
          `<w:rPr><w:sz w:val="${sz}"/></w:rPr></w:style>`
      );
    }
    const tip = `S${MAX_STYLE_BASED_ON_DEPTH + 4}`;
    const table = buildStyleCascadeTable(loadStyles(parts.join('')));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="${tip}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    const paragraph = part.root.children[0]!.children[0]!;
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    const cascaded = cascadeParagraphFormatting(table, pPr);
    // Depth cap walks at most MAX entries tip-first; the oldest ancestors beyond the cap
    // are dropped, so size comes from the oldest kept link rather than S0.
    expect(cascaded.runProperties.some((property) => property.localName === 'sz')).toBe(true);
    const size = resolveRunStyle(cascaded.runProperties).fontSizePt;
    expect(size).toBeGreaterThan(0);
    // S0 (sz=20 → 10pt) must not participate once the chain exceeds the cap.
    expect(size).not.toBe(10);
  });

  test('direct run formatting overrides inherited style', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const inherited = cascadeParagraphFormatting(
      table,
      loadDocument(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
      ).root.children[0]!.children[0]!.children.find((child) => child.kind === 'paragraphProperties')
    ).runProperties;
    const merged = cascadeRunProperties(inherited, [
      { localName: 'sz', attributes: { val: '24' } },
      { localName: 'color', attributes: { val: '00FF00' } },
    ]);
    expect(resolveRunStyle(merged)).toMatchObject({
      fontFamily: 'Arial',
      bold: true,
      fontSizePt: 12,
      color: '00FF00',
    });
  });

  test('direct paragraph spacing overrides style spacing', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/>` +
        `<w:spacing w:before="40" w:after="60"/></w:pPr>` +
        `<w:r><w:t>x</w:t></w:r></w:p>`
    );
    const pPr = part.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    const cascaded = cascadeParagraphFormatting(table, pPr);
    expect(paragraphSpacing(cascaded.paragraphProperties)).toEqual({ before: 2, after: 3 });
  });

  test('cascaded bottom border inherits from style unless direct pBdr wins', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="Ruled">` +
      `<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="24" w:color="FF0000" w:space="4"/>` +
      `</w:pBdr></w:pPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const styled = cascadeParagraphFormatting(
      table,
      loadDocument(
        `<w:p><w:pPr><w:pStyle w:val="Ruled"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
      ).root.children[0]!.children[0]!.children.find((child) => child.kind === 'paragraphProperties')
    );
    expect(cascadedBottomBorder(styled.paragraphPropertyNodes)).toMatchObject({
      color: 'FF0000',
      widthPt: 3,
      spacePt: 4,
    });
  });
});

describe('layout applies Heading1 / Heading2 cascade', () => {
  const measurer = createFixedMeasurer(6, 14);

  test('Heading1 fixture: Arial bold 18pt #1B3A5C with spacing 18/10', () => {
    const table = buildStyleCascadeTable(
      loadStyles(DOC_DEFAULTS + HEADING1_FIRST + HEADING1_LAST + HEADING2_LAST)
    );
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
        `<w:r><w:t>Table of Contents</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    const [line] = linesOf(layout);
    const span = line!.spans[0]!;
    expect(span.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 18,
      bold: true,
      color: '1B3A5C',
    });
    const fragment = layout.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind === 'paragraph') {
      expect(fragment.spacing).toEqual({ before: 18, after: 10 });
      expect(fragment.box.y).toBe(0);
      expect(fragment.lines[0]!.box.y).toBe(18);
    }
  });

  test('sibling Heading2 last-wins values', () => {
    const table = buildStyleCascadeTable(
      loadStyles(
        `<w:style w:type="paragraph" w:styleId="Heading2">` +
          `<w:rPr><w:color w:val="000000"/><w:sz w:val="20"/></w:rPr></w:style>` +
          HEADING2_LAST
      )
    );
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Section</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 15,
      bold: true,
      color: '2E75B6',
    });
  });

  test('docDefaults apply to bare runs with no pStyle', () => {
    const table = buildStyleCascadeTable(loadStyles(DOC_DEFAULTS));
    const part = loadDocument(`<w:p><w:r><w:t>body</w:t></w:r></w:p>`);
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      fontSizePt: 11,
    });
  });

  test('direct run rPr still wins over Heading1', () => {
    const table = buildStyleCascadeTable(loadStyles(HEADING1_LAST));
    const part = loadDocument(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
        `<w:r><w:rPr><w:sz w:val="20"/><w:color w:val="00AA00"/></w:rPr>` +
        `<w:t>mixed</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, styleCascade: table });
    expect(linesOf(layout)[0]!.spans[0]!.style).toMatchObject({
      fontFamily: 'Arial',
      bold: true,
      fontSizePt: 10,
      color: '00AA00',
    });
  });
});
