// An `=` formula over page fields (`{ = { PAGE } }`, `{ = { PAGE } + 1 }`) shows the page's
// value. Templates build "Page X of Y" this way. The formula has a value on each page, so the
// result saved in the file is only the value of one page. ECMA-376 Part 1, 17.16.1 (the `=`
// field) and 17.16.3 (formulas and expressions, with fields that result in a single value as
// operands).
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import { detectStoryPageFields } from '../field-instruction.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const measurer = createFixedMeasurer(6, 14);

const BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const SEPARATE = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const instr = (value: string) =>
  `<w:r><w:instrText xml:space="preserve">${value}</w:instrText></w:r>`;
const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;

function complexField(instruction: string, cached: string): string {
  return BEGIN + instr(` ${instruction} `) + SEPARATE + (cached ? text(cached) : '') + END;
}

/**
 * A formula field as a DOCX file stores it: `before`, the operand fields, then `after` in the
 * instruction, with `cached` as the saved result.
 */
function formula(operands: readonly string[], cached: string, before = ' = ', after = ' '): string {
  return (
    BEGIN +
    instr(before) +
    operands.join('') +
    instr(after) +
    SEPARATE +
    (cached ? text(cached) : '') +
    END
  );
}

const pageOperand = (instruction = 'PAGE') => complexField(instruction, '5');

function packageOf(body: string, sectPr: string, footer?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${footer ?? '<w:p/>'}</w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>` +
        (footer ? '<w:footerReference w:type="default" r:id="rId1"/>' : '') +
        `${sectPr}<w:pgSz w:w="12240" w:h="15840"/>` +
        '<w:pgMar w:top="1080" w:right="720" w:bottom="1080" w:left="720" w:footer="500"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function furnitureOf(pkg: OoxmlPackage, part: OoxmlPart): readonly (PageFurniture | undefined)[] {
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return enumerateDocumentSections(part).map((section, index) => {
    const parts = bySection[index];
    if (!parts || parts.footers.size === 0) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const footers = new Map();
    for (const [variant, footer] of parts.footers) {
      footers.set(variant, layoutHeaderFooterStory(footer, width, measurer, 'formula'));
    }
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: new Map(),
      footers,
    };
  });
}

function layoutOf(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'formula',
    sectionFurniture: furnitureOf(loaded.package, part),
  });
}

function spansOf(fragments: readonly { kind: string }[]): string[] {
  return fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? (fragment as { lines: readonly { spans: readonly { text: string }[] }[] }).lines.flatMap(
          (line) => line.spans.map((span) => span.text)
        )
      : []
  );
}

const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const threePages = ['one', 'two', 'three']
  .map((label) => `<w:p>${text(`Body ${label}`)}</w:p>`)
  .join(pageBreak);

function footerTexts(footer: string, sectPr = ''): string[] {
  const layout = layoutOf(packageOf(threePages, sectPr, footer));
  return layout.pages.map((page) => spansOf(page.footer?.fragments ?? []).join(''));
}

function footerPart(footer: string): OoxmlPart {
  const loaded = readOoxmlPackage(packageOf(threePages, '', footer));
  if (!loaded.ok) throw new Error(loaded.reason);
  return [...loaded.package.parts.values()].find((part) => part.name.includes('footer1'))!;
}

describe('a formula that wraps one page field', () => {
  const pageXofY =
    '<w:p>' +
    text('Page ') +
    formula([pageOperand()], '5') +
    text(' of ') +
    formula([pageOperand('NUMPAGES')], '5') +
    '</w:p>';

  test('shows each page its own number in a footer', () => {
    expect(footerTexts(pageXofY)).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
  });

  test('is detected as a live page field', () => {
    expect(detectStoryPageFields(footerPart(pageXofY).root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
  });

  test('accepts SECTIONPAGES and an Arabic or MERGEFORMAT operand switch', () => {
    const footer =
      '<w:p>' +
      formula([pageOperand('PAGE \\* Arabic \\* MERGEFORMAT')], '5') +
      text('/') +
      formula([pageOperand('SECTIONPAGES')], '5') +
      '</w:p>';
    expect(footerTexts(footer)).toEqual(['1/3', '2/3', '3/3']);
  });

  test("renders the value through the formula's own switches", () => {
    const footer =
      '<w:p>' +
      formula([pageOperand()], '05', ' = ', ' \\# "00" ') +
      text(' ') +
      formula([pageOperand()], 'v', ' = ', ' \\* roman \\* MERGEFORMAT ') +
      text(' ') +
      formula([pageOperand()], '5', '=', '') +
      '</w:p>';
    expect(footerTexts(footer)).toEqual(['01 i 1', '02 ii 2', '03 iii 3']);
  });

  test('keeps the saved result over a PAGE operand in a roman section', () => {
    // The operand yields `i`, which is not a number, so the formula has no value.
    const footer =
      '<w:p>' +
      formula([pageOperand()], '5') +
      text(' ') +
      formula([pageOperand()], '7', ' = ', ' \\# "00" ') +
      text(' ') +
      pageOperand() +
      '</w:p>';
    expect(footerTexts(footer, '<w:pgNumType w:fmt="lowerRoman"/>')).toEqual([
      '5 7 i',
      '5 7 ii',
      '5 7 iii',
    ]);
    expect(detectStoryPageFields(footerPart(footer).root).hasPage).toBe(true);
  });

  test('shows a PAGE operand in a decimalZero section, not in a dashed one', () => {
    const footer = `<w:p>${formula([pageOperand()], '5')}${text('|')}${pageOperand()}</w:p>`;
    expect(footerTexts(footer, '<w:pgNumType w:fmt="decimalZero"/>')).toEqual([
      '1|01',
      '2|02',
      '3|03',
    ]);
    expect(footerTexts(footer, '<w:pgNumType w:fmt="numberInDash"/>')).toEqual([
      '5|- 1 -',
      '5|- 2 -',
      '5|- 3 -',
    ]);
  });

  test('shows numeric operands in a letter section', () => {
    const footer =
      '<w:p>' +
      formula([pageOperand('PAGE \\* Arabic')], '5') +
      text('/') +
      formula([pageOperand('NUMPAGES')], '5') +
      text('/') +
      formula([pageOperand('SECTIONPAGES')], '5') +
      '</w:p>';
    expect(footerTexts(footer, '<w:pgNumType w:fmt="upperLetter"/>')).toEqual([
      '1/3/3',
      '2/3/3',
      '3/3/3',
    ]);
  });

  test('shows the page number in the body', () => {
    const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');
    const field = `<w:p>${text('[')}${formula([pageOperand()], '7')}${text(']')}</w:p>`;
    const layout = layoutOf(packageOf(filler + field, ''));
    expect(layout.pages.length).toBe(2);
    expect(spansOf(layout.pages[1]!.fragments).join('')).toContain('[2]');
  });

  test('keeps the saved result in the body of a roman section', () => {
    const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');
    const field = `<w:p>${text('[')}${formula([pageOperand()], '7')}${text(']')}</w:p>`;
    const layout = layoutOf(packageOf(filler + field, '<w:pgNumType w:fmt="upperRoman"/>'));
    expect(layout.pages.length).toBe(2);
    expect(spansOf(layout.pages[1]!.fragments).join('')).toContain('[7]');
  });
});

describe('formulas that stay inert', () => {
  const inert: readonly [string, string][] = [
    ['two operands without an operator', formula([pageOperand(), pageOperand('NUMPAGES')], '10')],
    ['a division by zero', formula([pageOperand()], '!Zero Divide', ' = ', ' / 0 ')],
    ['a function', formula([pageOperand()], '1', ' = ABS( ', ' ) ')],
    ['an operand with a number format', formula([pageOperand('PAGE \\* roman')], 'v')],
    ['an operand with a picture', formula([pageOperand('PAGE \\# "00"')], '5')],
    ['a field that is not a page field', formula([complexField('SEQ Figure', '5')], '5')],
    ['a nested operand', formula([BEGIN + instr(' PAGE ') + pageOperand() + END], '5')],
    [
      'an operand whose code nests another field',
      formula(
        [BEGIN + instr(' PAGE ') + complexField('QUOTE x', 'x') + SEPARATE + text('5') + END],
        '5'
      ),
    ],
    ['no operand', formula([], '5', ' = 5 ')],
    ['a formula over a formula', formula([formula([pageOperand()], '5')], '5')],
    [
      'a formula in an IF instruction',
      formula([formula([pageOperand()], '5')], 'other', ' IF ', ' = 1 "one" "other" '),
    ],
    ['a page field that is not a formula', formula([pageOperand()], '5', ' IF ', ' = 1 "x" ')],
    ['a formula with an unsupported switch', formula([pageOperand()], '5', ' = ', ' \\* Ordinal ')],
  ];

  for (const [name, field] of inert) {
    test(`keeps the saved result for ${name}`, () => {
      const footer = `<w:p>${text('[')}${field}${text(']')}</w:p>`;
      const saved = footerTexts(footer)[0]!;
      expect(footerTexts(footer)).toEqual([saved, saved, saved]);
      expect(detectStoryPageFields(footerPart(footer).root)).toEqual({
        hasPage: false,
        hasNumPages: false,
        hasSectionPages: false,
      });
    });
  }
});

describe('a formula in the result of a simple field', () => {
  const footer = `<w:p><w:fldSimple w:instr=" QUOTE x ">${formula([pageOperand()], '5')}</w:fldSimple></w:p>`;

  test('shows each page its own number', () => {
    expect(footerTexts(footer)).toEqual(['1', '2', '3']);
  });

  test('keeps the saved result over a PAGE operand in a roman section', () => {
    expect(footerTexts(footer, '<w:pgNumType w:fmt="lowerRoman"/>')).toEqual(['5', '5', '5']);
  });
});

describe('a formula beside a drawing that holds its own story', () => {
  test('keeps its operands across the drawing', () => {
    // The text box story walks with the field state saved and restored around it. Only the
    // outer formula holds NUMPAGES, after the drawing.
    const drawing =
      '<w:r><w:drawing><w:txbxContent><w:p>' +
      text('box') +
      '</w:p></w:txbxContent></w:drawing></w:r>';
    const field =
      BEGIN +
      instr(' = ') +
      pageOperand() +
      drawing +
      instr(' + ') +
      pageOperand('NUMPAGES') +
      instr(' ') +
      SEPARATE +
      text('9') +
      END;
    expect(detectStoryPageFields(footerPart(`<w:p>${field}</w:p>`).root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
  });
});

describe('a formula whose operand result nests another field', () => {
  test('shows each page its own number', () => {
    // The operand's saved result is replaced, so a field inside it does not change the value.
    const operand =
      BEGIN + instr(' PAGE ') + SEPARATE + text('5') + complexField('QUOTE 7', '7') + END;
    const footer = `<w:p>${formula([operand], '57')}</w:p>`;
    expect(footerTexts(footer)).toEqual(['1', '2', '3']);
    expect(detectStoryPageFields(footerPart(footer).root).hasPage).toBe(true);
  });
});

describe('a formula in the result of another complex field', () => {
  const outer = (inner: string) => BEGIN + instr(' QUOTE "x" ') + SEPARATE + inner + END;
  const footer = `<w:p>${outer(text('[') + formula([pageOperand()], '5') + text(']'))}</w:p>`;

  test('shows each page its own number, as in a simple field', () => {
    expect(footerTexts(footer)).toEqual(['[1]', '[2]', '[3]']);
    expect(detectStoryPageFields(footerPart(footer).root).hasPage).toBe(true);
  });

  test('shows it two fields deep', () => {
    const deep = `<w:p>${outer(outer(formula([pageOperand('NUMPAGES')], '5')))}</w:p>`;
    expect(footerTexts(deep)).toEqual(['3', '3', '3']);
  });

  test('keeps the saved result over a PAGE operand in a roman section', () => {
    expect(footerTexts(footer, '<w:pgNumType w:fmt="lowerRoman"/>')).toEqual(['[5]', '[5]', '[5]']);
  });

  test('evaluates arithmetic', () => {
    const arithmetic = `<w:p>${outer(formula([pageOperand()], '6', ' = ', ' + 10 '))}</w:p>`;
    expect(footerTexts(arithmetic)).toEqual(['11', '12', '13']);
  });

  test('keeps the saved result on a page where the formula has no value', () => {
    const operands = [pageOperand(), pageOperand('NUMPAGES'), pageOperand()];
    const field = BEGIN + instr(' = 6 / ( ') + operands[1] + instr(' - ') + operands[2];
    const divided = field + instr(' ) ') + SEPARATE + text('9') + END;
    expect(footerTexts(`<w:p>${outer(text('[') + divided + text(']'))}</w:p>`)).toEqual([
      '[3]',
      '[6]',
      '[9]',
    ]);
  });
});

describe('a formula with tracked changes in its instruction', () => {
  const REVISION = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
  const inserted = (content: string) => `<w:ins w:id="1" ${REVISION}>${content}</w:ins>`;
  const deleted = (content: string) => `<w:del w:id="2" ${REVISION}>${content}</w:del>`;
  const delInstr = (value: string) =>
    `<w:r><w:delInstrText xml:space="preserve">${value}</w:delInstrText></w:r>`;
  const delText = (value: string) =>
    `<w:r><w:delText xml:space="preserve">${value}</w:delText></w:r>`;
  const deletedPage = deleted(BEGIN + delInstr(' PAGE ') + SEPARATE + delText('5') + END);
  const footerOf = (field: string) => `<w:p>${text('[')}${field}${text(']')}</w:p>`;

  // A tracked deletion of only the operand, or a tracked insertion, leaves the `=` in place.
  const live: readonly [string, string][] = [
    [
      'a deleted operand',
      BEGIN + instr(' = ') + deletedPage + instr(' ') + SEPARATE + text('9') + END,
    ],
    [
      'an inserted operand',
      BEGIN + instr(' = ') + inserted(pageOperand()) + instr(' ') + SEPARATE + text('9') + END,
    ],
    [
      'an inserted `=`',
      BEGIN + inserted(instr(' = ')) + pageOperand() + instr(' ') + SEPARATE + text('9') + END,
    ],
    ['an inserted formula', inserted(formula([pageOperand()], '9'))],
  ];
  for (const [name, field] of live) {
    test(`shows each page its own number for ${name}`, () => {
      expect(footerTexts(footerOf(field))).toEqual(['[1]', '[2]', '[3]']);
    });
  }

  test('shows nothing when only the `=` is deleted', () => {
    // With the deletion accepted, the field holds only its operand and has no instruction.
    const field =
      BEGIN + deleted(delInstr(' = ')) + pageOperand() + instr(' ') + SEPARATE + text('9') + END;
    expect(footerTexts(footerOf(field))).toEqual(['[]', '[]', '[]']);
  });

  test('shows nothing for a page field whose code alone is deleted', () => {
    const field = BEGIN + deleted(delInstr(' PAGE ')) + SEPARATE + text('9') + END;
    expect(footerTexts(footerOf(field))).toEqual(['[]', '[]', '[]']);
    // A wholly deleted page field still shows its value, marked as deleted.
    expect(footerTexts(footerOf(deletedPage))).toEqual(['[1]', '[2]', '[3]']);
  });

  test('keeps the saved result of a deleted formula', () => {
    const field = deleted(
      BEGIN +
        delInstr(' = ') +
        BEGIN +
        delInstr(' PAGE ') +
        SEPARATE +
        delText('5') +
        END +
        delInstr(' ') +
        SEPARATE +
        delText('9') +
        END
    );
    expect(footerTexts(footerOf(field))).toEqual(['[9]', '[9]', '[9]']);
    expect(detectStoryPageFields(footerPart(footerOf(field)).root).hasPage).toBe(false);
  });
});

describe('a formula in a complex field inside a simple field result', () => {
  const footer =
    '<w:p><w:fldSimple w:instr=" QUOTE x ">' +
    BEGIN +
    instr(' QUOTE "y" ') +
    SEPARATE +
    formula([pageOperand()], '5') +
    END +
    '</w:fldSimple></w:p>';

  test('shows each page its own number', () => {
    expect(footerTexts(footer)).toEqual(['1', '2', '3']);
  });

  test('keeps the saved result over a PAGE operand in a roman section', () => {
    expect(footerTexts(footer, '<w:pgNumType w:fmt="lowerRoman"/>')).toEqual(['5', '5', '5']);
  });
});

describe('a formula with arithmetic', () => {
  test('shows each page its own value in a footer', () => {
    const footer =
      '<w:p>' +
      formula([pageOperand()], '9', ' = ', ' + 1 ') +
      text('|') +
      formula([pageOperand('NUMPAGES'), pageOperand()], '9', ' = ', ' ').replace(
        `${END}${BEGIN}`,
        `${END}${instr(' - ')}${BEGIN}`
      ) +
      text('|') +
      formula([pageOperand()], '9', ' = ( ', ' + 1 ) * 2 \\# "00" ') +
      text('|') +
      formula([pageOperand()], '9', ' = ', ' / 2 ') +
      '</w:p>';
    expect(footerTexts(footer)).toEqual(['2|2|04|0.5', '3|1|06|1', '4|0|08|1.5']);
    expect(detectStoryPageFields(footerPart(footer).root)).toEqual({
      hasPage: true,
      hasNumPages: true,
      hasSectionPages: false,
    });
  });

  test('keeps the saved result on a page where it has no value', () => {
    const field =
      BEGIN +
      instr(' = 6 / ( ') +
      pageOperand('NUMPAGES') +
      instr(' - ') +
      pageOperand() +
      instr(' ) ') +
      SEPARATE +
      text('saved') +
      END;
    expect(footerTexts(`<w:p>${field}</w:p>`)).toEqual(['3', '6', 'saved']);
  });

  test('keeps the saved result over a PAGE operand in a roman section', () => {
    const footer =
      '<w:p>' +
      formula([pageOperand()], '9', ' = ', ' + 1 ') +
      text('|') +
      formula([pageOperand('PAGE \\* Arabic')], '9', ' = ', ' + 1 ') +
      '</w:p>';
    expect(footerTexts(footer, '<w:pgNumType w:fmt="lowerRoman"/>')).toEqual(['9|2', '9|3', '9|4']);
  });

  test('shows the page value in the body', () => {
    const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');
    const field = `<w:p>${text('[')}${formula([pageOperand()], '7', ' = ', ' * 10 ')}${text(']')}</w:p>`;
    const layout = layoutOf(packageOf(filler + field, ''));
    expect(layout.pages.length).toBe(2);
    expect(spansOf(layout.pages[1]!.fragments).join('')).toContain('[20]');
  });

  test('paints nothing in the body where it has no value and its saved result has a space', () => {
    // The field was measured at one digit, so the saved result would paint over the text after it.
    const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');
    const divided =
      BEGIN +
      instr(' = 1 / ( ') +
      pageOperand() +
      instr(' - 2 ) ') +
      SEPARATE +
      text('!Zero Divide') +
      END;
    const layout = layoutOf(
      packageOf(`${filler}<w:p>${text('[')}${divided}${text(']')}</w:p>`, '')
    );
    expect(layout.pages.length).toBe(2);
    expect(spansOf(layout.pages[1]!.fragments).join('')).toContain('[]');
  });

  test('keeps the saved result in the body on a page where it has no value', () => {
    const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');
    const divided =
      BEGIN + instr(' = 1 / ( ') + pageOperand() + instr(' - 2 ) ') + SEPARATE + text('77') + END;
    const layout = layoutOf(
      packageOf(`${filler}<w:p>${text('[')}${divided}${text(']')}</w:p>`, '')
    );
    expect(layout.pages.length).toBe(2);
    expect(spansOf(layout.pages[1]!.fragments).join('')).toContain('[77]');
  });
});

describe('page fields in another field result in the body', () => {
  const outer = (inner: string) => BEGIN + instr(' QUOTE "x" ') + SEPARATE + inner + END;
  const simple = (inner: string, instruction = ' QUOTE x ') =>
    `<w:fldSimple w:instr="${instruction}">${inner}</w:fldSimple>`;
  const filler = Array.from({ length: 60 }, () => `<w:p>${text('Line')}</w:p>`).join('');

  /** The text of the second page, where each item's paragraph lands. */
  function secondPage(items: readonly string[], sectPr = ''): string {
    const body = filler + items.map((item) => `<w:p>${item}</w:p>`).join('');
    const layout = layoutOf(packageOf(body, sectPr));
    expect(layout.pages.length).toBe(2);
    return spansOf(layout.pages[1]!.fragments).join('|');
  }

  test('shows the value of the page each field lands on', () => {
    const page = secondPage([
      text('a=') + outer(pageOperand()),
      text('b=') + outer(text('[') + pageOperand() + text(']')),
      text('c=') + outer(formula([pageOperand()], '7', ' = ', ' + 10 ')),
      text('d=') + simple(formula([pageOperand()], '7', ' = ', ' * 3 ')),
      text('e=') + simple(simple(text('5'), ' NUMPAGES ')),
      text('f=') + outer(outer(formula([pageOperand()], '7'))),
    ]);
    expect(page).toContain('a=|2');
    expect(page).toContain('b=|[2]');
    expect(page).toContain('c=|12');
    expect(page).toContain('d=|6');
    expect(page).toContain('e=|2');
    expect(page).toContain('f=|2');
  });

  test('keeps the saved result where it cannot be measured as one word', () => {
    const page = secondPage([text('a=') + outer(text('Page ') + pageOperand() + text(' of 9'))]);
    expect(page.replaceAll('|', '')).toContain('a=Page 5 of 9');
  });

  test('keeps the saved result of a field inside a nested instruction', () => {
    const nestedIf =
      BEGIN +
      instr(' IF ') +
      pageOperand() +
      instr(' = 1 "one" "two" ') +
      SEPARATE +
      text('two') +
      END;
    expect(secondPage([text('a=') + outer(nestedIf)])).toContain('a=|two');
  });

  test('follows the section format, and keeps a formula over PAGE in a roman section', () => {
    const page = secondPage(
      [text('a=') + outer(pageOperand()), text('b=') + outer(formula([pageOperand()], '7'))],
      '<w:pgNumType w:fmt="lowerRoman"/>'
    );
    expect(page).toContain('a=|ii');
    expect(page).toContain('b=|7');
  });

  test('keeps a long saved result whole', () => {
    const long = 'x'.repeat(300);
    const page = secondPage([text('a=') + outer(formula([pageOperand()], long))]);
    expect(page.replaceAll('|', '')).toContain(`a=${long}`);
  });

  test('keeps the saved result of a formula on a page where it has no value', () => {
    const divided =
      BEGIN + instr(' = 1 / ( ') + pageOperand() + instr(' - 2 ) ') + SEPARATE + text('77') + END;
    expect(secondPage([text('a=') + outer(text('[') + divided + text(']'))])).toContain('a=|[77]');
  });
});
