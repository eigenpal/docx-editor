// The bounded `=` formula evaluator over page-field operands. ECMA-376 Part 1, 17.16.3
// (formulas and expressions) and 17.16.3.3 (operators). Each operand is written `#` in the
// instruction strings below and replaced by a page-field slot at that offset.
import { describe, expect, test } from 'bun:test';
import type { AllowlistedPageField } from '../field-instruction.ts';
import {
  compilePageFormula,
  formatPageFormula,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_OPERANDS,
  MAX_FORMULA_TOKENS,
  type CompiledPageFormula,
} from '../field-formula.ts';

const KINDS: Record<string, AllowlistedPageField> = {
  P: 'PAGE',
  N: 'NUMPAGES',
  S: 'SECTIONPAGES',
};

/** Compile `instruction`, where `{P}`, `{N}` and `{S}` mark the operand fields. */
function compile(instruction: string): CompiledPageFormula | null {
  const slots: { offset: number; match: { kind: AllowlistedPageField } }[] = [];
  let text = '';
  for (let index = 0; index < instruction.length; index += 1) {
    const kind = instruction[index] === '{' ? KINDS[instruction[index + 1]!] : undefined;
    if (kind && instruction[index + 2] === '}') {
      slots.push({ offset: text.length, match: { kind } });
      index += 2;
    } else {
      text += instruction[index];
    }
  }
  return compilePageFormula(text, slots);
}

/** What the formula shows on pages 1, 2 and 3 of a three-page document, or null if inert. */
function shown(instruction: string, values = { numPages: 3, sectionPages: 3 }) {
  const compiled = compile(instruction);
  if (compiled === null || !('formula' in compiled)) return null;
  return [1, 2, 3].map((page) =>
    formatPageFormula(compiled.formula, { page, ...values }, compiled.switches)
  );
}

describe('arithmetic over page fields', () => {
  test('applies the operators', () => {
    expect(shown(' = {P} + 1 ')).toEqual(['2', '3', '4']);
    expect(shown(' = {P} - 1 ')).toEqual(['0', '1', '2']);
    expect(shown(' = {P} * 2 ')).toEqual(['2', '4', '6']);
    expect(shown(' = {P} / 2 ')).toEqual(['0.5', '1', '1.5']);
    expect(shown(' = {N} - {P} ')).toEqual(['2', '1', '0']);
    expect(shown(' = {P} ^ 2 ')).toEqual(['1', '4', '9']);
    expect(shown('={P}+1')).toEqual(['2', '3', '4']);
  });

  test('follows precedence, left association, and parentheses', () => {
    expect(shown(' = {P} + 1 * 2 ')).toEqual(['3', '4', '5']);
    expect(shown(' = ( {P} + 1 ) * 2 ')).toEqual(['4', '6', '8']);
    expect(shown(' = 12 / {P} * 2 ')).toEqual(['24', '12', '8']);
    expect(shown(' = {P} - 1 + 1 ')).toEqual(['1', '2', '3']);
    expect(shown(' = 2 * {P} + {N} * 10 ')).toEqual(['32', '34', '36']);
  });

  test('applies unary minus before a power', () => {
    expect(shown(' = -{P} ')).toEqual(['-1', '-2', '-3']);
    expect(shown(' = - - {P} ')).toEqual(['1', '2', '3']);
    expect(shown(' = -{P} ^ 2 ')).toEqual(['1', '4', '9']);
    expect(shown(' = {P} * -1 ')).toEqual(['-1', '-2', '-3']);
  });

  test('yields 1 or 0 for a comparison', () => {
    expect(shown(' = {P} = 1 ')).toEqual(['1', '0', '0']);
    expect(shown(' = {P} <> 2 ')).toEqual(['1', '0', '1']);
    expect(shown(' = {P} >= 2 ')).toEqual(['0', '1', '1']);
    expect(shown(' = {P} + 1 = 2 ')).toEqual(['1', '0', '0']);
    expect(shown(' = {P} < 2 = 1 ')).toEqual(['1', '0', '0']);
  });

  test('reads SECTIONPAGES from its own count', () => {
    expect(shown(' = {S} - {P} ', { numPages: 5, sectionPages: 2 })).toEqual(['1', '0', '-1']);
  });
});

describe('the default number display', () => {
  test('shows two decimal places after a division', () => {
    expect(shown(' = {P} / 3 ')).toEqual(['0.33', '0.67', '1']);
    expect(shown(' = 10 / {P} ')).toEqual(['10', '5', '3.33']);
    expect(shown(' = {P} / 8 ')).toEqual(['0.13', '0.25', '0.38']);
  });

  test('shows as many decimal places as the most precise input', () => {
    expect(shown(' = {P} * 1.23456 ')).toEqual(['1.23456', '2.46912', '3.70368']);
    expect(shown(' = {P} / 3 * 1.0001 ')).toEqual(['0.3334', '0.6667', '1.0001']);
    expect(shown(' = {P} / 3 + 0.001 ')).toEqual(['0.334', '0.668', '1.001']);
    expect(shown(' = 1.5 + {P} / 3 ')).toEqual(['1.83', '2.17', '2.5']);
    expect(shown(' = {P} * 1.5 * 1.5 ')).toEqual(['2.3', '4.5', '6.8']);
    expect(shown(' = 1.5 ^ {P} ')).toEqual(['1.5', '2.3', '3.4']);
    expect(shown(' = {P} ^ 0.5 ')).toEqual(['1', '1.4', '1.7']);
    expect(shown(' = {P} * 2.50 ')).toEqual(['2.5', '5', '7.5']);
    expect(shown(' = {P} + .5 ')).toEqual(['1.5', '2.5', '3.5']);
    expect(shown(' = {P} * 1. ')).toEqual(['1', '2', '3']);
  });

  test('rounds half away from zero in decimal steps', () => {
    expect(shown(' = {P} * 10.7 / 4 ')).toEqual(['2.68', '5.35', '8.03']);
    expect(shown(' = -{P} / 8 ')).toEqual(['-0.13', '-0.25', '-0.38']);
  });

  test('shows a nonzero value that rounds to zero as 0.0', () => {
    expect(shown(' = {P} / 1000 ')).toEqual(['0.0', '0.0', '0.0']);
    expect(shown(' = {P} * 0.001 / 3 ')).toEqual(['0.0', '0.001', '0.001']);
  });

  test('shows large whole numbers without grouping', () => {
    expect(shown(' = {P} * 1000000 * 1000000 ')).toEqual([
      '1000000000000',
      '2000000000000',
      '3000000000000',
    ]);
  });
});

describe('the formula switches', () => {
  test('renders a picture after rounding to a whole number', () => {
    expect(shown(' = {P} + 1 \\# "00" ')).toEqual(['02', '03', '04']);
    expect(shown(' = {P} / 4 \\# "0" ')).toEqual(['0', '1', '1']);
    expect(shown(' = {P} / 2 \\# "00" ')).toEqual(['01', '01', '02']);
    expect(shown(' = {P} * 1000 \\# "#,##0" ')).toEqual(['1,000', '2,000', '3,000']);
  });

  test('puts a minus sign before a picture of required digits', () => {
    expect(shown(' = {P} - 3 \\# "00" ')).toEqual(['-02', '-01', '00']);
    expect(shown(' = {P} - 2 \\# "0" ')).toEqual(['-1', '0', '1']);
  });

  test('renders a whole value through a number format', () => {
    expect(shown(' = {P} + 1 \\* roman ')).toEqual(['ii', 'iii', 'iv']);
    expect(shown(' = {P} - 1 \\* roman ')).toEqual([' ', 'i', 'ii']);
    expect(shown(' = {P} * 2 \\* ALPHABETIC ')).toEqual(['B', 'D', 'F']);
    expect(shown(' = {P} + 1 \\* Arabic \\* MERGEFORMAT ')).toEqual(['2', '3', '4']);
  });

  test('has no value for a result the switches cannot render', () => {
    expect(shown(' = {P} / 2 \\* roman ')).toEqual([null, 'i', null]);
    expect(shown(' = {P} - 2 \\* roman ')).toEqual([null, ' ', 'i']);
    expect(shown(' = {P} - 2 \\# "##0" ')).toEqual([null, '  0', '  1']);
  });

  test('refuses a picture it cannot render for every value', () => {
    expect(compile(' = {P} / 2 \\# "0.00" ')).toBeNull();
    expect(compile(' = {P} - 2 \\# "0;(0)" ')).toBeNull();
    expect(compile(" = {P} + 1 \\# 'p'0 ")).toBeNull();
  });
});

describe('values the formula does not have', () => {
  test('keeps the saved result for a division by zero', () => {
    expect(compile(' = {P} / 0 ')).toBeNull();
    expect(shown(' = {P} / ( 1 - 1 ) ')).toEqual([null, null, null]);
    expect(shown(' = 3 / ( {N} - {P} ) ')).toEqual(['1.5', '3', null]);
  });

  test('keeps the saved result for a negative exponent', () => {
    expect(shown(' = {P} ^ -1 ')).toEqual([null, null, null]);
  });

  test('keeps the saved result past the magnitude cap', () => {
    expect(shown(' = {P} * 99999999999 * 99999 ')).toEqual([null, null, null]);
    expect(shown(' = 10 ^ ( {P} * 20 ) ')).toEqual([null, null, null]);
  });

  test('keeps the saved result where a power has no real value', () => {
    expect(shown(' = ( -{P} ) ^ 0.5 ')).toEqual([null, null, null]);
  });
});

describe('formulas that stay inert', () => {
  const inert = [
    ['a missing operator', ' = {P} 1 '],
    ['a trailing operator', ' = {P} + '],
    ['an unclosed parenthesis', ' = ( {P} + 1 '],
    ['an extra parenthesis', ' = {P} + 1 ) '],
    ['a bookmark', ' = {P} + X '],
    ['a function', ' = ABS( -{P} ) '],
    ['a list separator', ' = {P} + 1,5 '],
    ['a percentage', ' = {P} * 50% '],
    ['an exponent in a constant', ' = {P} * 1E2 '],
    ['a unary plus', ' = + {P} '],
    ['a chained power', ' = 2 ^ 3 ^ {P} '],
    ['adjacent operands', ' = {P}{N} '],
    ['an operand before the `=`', '{P} = 1 '],
    ['an operand in a switch', ' = 1 \\# {P} '],
    ['an unsupported switch', ' = {P} + 1 \\* Ordinal '],
    ['an instruction that is not a formula', ' IF {P} = 1 "one" "other" '],
    ['a lone decimal point', ' = {P} + . '],
    ['too many decimal places', ' = {P} * 1.12345678901 '],
    ['a constant past the length cap', ` = {P} + ${'1'.repeat(30)} `],
  ] as const;
  for (const [name, instruction] of inert) {
    test(`for ${name}`, () => {
      expect(compile(instruction)).toBeNull();
    });
  }

  test('without a page-field operand', () => {
    expect(compilePageFormula(' = 2 + 3 ', [])).toBeNull();
  });

  test('past the token, depth, and operand caps', () => {
    const tokens = ` = {P}${' + 1'.repeat(MAX_FORMULA_TOKENS)} `;
    expect(compile(tokens)).toBeNull();
    const deep = ` = ${'('.repeat(MAX_FORMULA_DEPTH + 1)}{P}${')'.repeat(MAX_FORMULA_DEPTH + 1)} `;
    expect(compile(deep)).toBeNull();
    const negations = ` = ${'-'.repeat(MAX_FORMULA_DEPTH + 1)}{P} `;
    expect(compile(negations)).toBeNull();
    const operands = ` = {P}${' + {P}'.repeat(MAX_FORMULA_OPERANDS)} `;
    expect(compile(operands)).toBeNull();
    expect(
      compile(` = ${'('.repeat(MAX_FORMULA_DEPTH)}{P}${')'.repeat(MAX_FORMULA_DEPTH)} + 1 `)
    ).not.toBeNull();
  });

  test('refuses an operand with a picture or a non-decimal format', () => {
    const slot = (match: object) => [{ offset: 3, match: { kind: 'PAGE' as const, ...match } }];
    expect(compilePageFormula(' =  + 1 ', slot({ picture: '00' }))).toBeNull();
    expect(compilePageFormula(' =  + 1 ', slot({ numberFormat: 'lowerRoman' }))).toBeNull();
    expect(compilePageFormula(' =  + 1 ', slot({ numberFormat: 'decimal' }))).not.toBeNull();
  });
});

describe('a formula that is one operand', () => {
  test('reduces to the page field with the formula switches', () => {
    expect(compile(' = {P} ')).toEqual({ single: { kind: 'PAGE' }, switches: {} });
    expect(compile(' = {N} \\# "00" ')).toEqual({
      single: { kind: 'NUMPAGES' },
      switches: { picture: '00' },
    });
  });

  test('reduces in parentheses too', () => {
    expect(compile(' = ( {P} ) ')).toEqual({ single: { kind: 'PAGE' }, switches: {} });
  });
});
