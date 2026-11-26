// A bounded evaluator for `=` formula fields over page-field operands (`{ = { PAGE } + 1 }`).
//
// ECMA-376 Part 1, 17.16.1 defines the `=` field (`"=", expression`), and 17.16.3 defines the
// expression: constants (17.16.3.1), the operators of 17.16.3.3, grouping parentheses, and
// fields that result in a single value as operands. This module accepts a SUBSET:
//
//   - operands: the page fields `PAGE` (17.16.5.44), `NUMPAGES` (17.16.5.42), and
//     `SECTIONPAGES` (17.16.5.55), nested through `w:fldChar` (17.16.18, `CT_FldChar`), and
//     constants written as digits with an optional decimal point (`12`, `1.5`, `1.`, `.5`);
//   - operators: unary minus, `^`, `*`, `/`, `+`, `-`, and the comparisons `=`, `<>`, `<`,
//     `<=`, `>`, `>=`, with grouping parentheses.
//
// Functions, bookmarks, table cell references, `%`, a chained `^`, and every other token keep
// the field inert, so its saved result shows. A formula needs at least one page-field operand:
// a formula of constants alone has the same value on every page, so its saved result is right.
//
// Field instructions are attacker-controlled. The tokenizer is one bounded pass with no regex
// backtracking, the parser has hard caps on tokens and nesting depth, and evaluation walks a
// postfix program whose length the token cap bounds. Nothing a file supplies sizes an
// allocation or a loop.

import type { AllowlistedPageField, AllowlistedPageFieldMatch } from './field-instruction.ts';
import { formatNumericPicture, MAX_NUMERIC_PICTURE_CHARS } from './field-numeric-picture.ts';
import {
  formatPageFieldNumber,
  parsePageFieldInstruction,
  type PageFieldSwitches,
} from './field-page-switches.ts';

/** Most tokens one expression may hold; a longer expression stays inert. */
export const MAX_FORMULA_TOKENS = 64;
/** Deepest nesting of parentheses and unary minus; a deeper expression stays inert. */
export const MAX_FORMULA_DEPTH = 8;
/** Most page-field operands one formula may hold; a formula with more stays inert. */
export const MAX_FORMULA_OPERANDS = 8;
/** Longest constant, in characters; a longer one stays inert. */
const MAX_CONSTANT_CHARS = 24;
/** Most digits after a constant's decimal point; a constant with more stays inert. */
const MAX_CONSTANT_DECIMALS = 10;
/** Largest magnitude a step may produce; a larger one keeps the saved result. */
const MAX_FORMULA_MAGNITUDE = 1e15;
/** Division shows at least this many decimal places. */
const DIVISION_DECIMALS = 2;

type Comparison = '=' | '<>' | '<' | '<=' | '>' | '>=';
type BinaryOperator = '+' | '-' | '*' | '/' | '^' | Comparison;

/** One step of a postfix formula program. */
export type FormulaStep =
  | { readonly op: 'constant'; readonly value: number; readonly decimals: number }
  | { readonly op: 'field'; readonly kind: AllowlistedPageField }
  | { readonly op: 'negate' }
  | { readonly op: 'binary'; readonly operator: BinaryOperator };

/**
 * A compiled formula: its postfix program and the page fields it reads.
 *
 * Plain data, so a body page-field marker can carry it to document finalize.
 */
export interface PageFormula {
  readonly program: readonly FormulaStep[];
  readonly kinds: readonly AllowlistedPageField[];
}

/** One page-field operand of a formula, at its offset in the formula's own instruction text. */
export interface FormulaOperandSlot {
  readonly offset: number;
  readonly match: AllowlistedPageFieldMatch;
}

type Token =
  | { readonly type: 'constant'; readonly value: number; readonly decimals: number }
  | { readonly type: 'field'; readonly match: AllowlistedPageFieldMatch }
  | { readonly type: 'operator'; readonly value: BinaryOperator | '(' | ')' };

/** The tokens of an expression and the instruction text from its first switch on. */
interface Tokenized {
  readonly tokens: readonly Token[];
  readonly switches: string;
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\u00a0';
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/**
 * Read one constant at `start`: digits with at most one decimal point (17.16.3.1). Returns
 * null for a constant past the length or decimal caps.
 */
function readConstant(
  text: string,
  start: number
): { readonly token: Token; readonly end: number } | null {
  let end = start;
  let point = -1;
  while (end < text.length && end - start <= MAX_CONSTANT_CHARS) {
    const char = text[end]!;
    if (char === '.' && point < 0) point = end;
    else if (!isDigit(char)) break;
    end += 1;
  }
  const length = end - start;
  if (length > MAX_CONSTANT_CHARS || (point >= 0 && length === 1)) return null;
  const decimals = point < 0 ? 0 : end - point - 1;
  if (decimals > MAX_CONSTANT_DECIMALS) return null;
  const value = Number(text.slice(start, end));
  if (!Number.isFinite(value) || value > MAX_FORMULA_MAGNITUDE) return null;
  return { token: { type: 'constant', value, decimals }, end };
}

/**
 * Split `= expression [switches]` into tokens, with each operand slot placed at its offset.
 * Returns null for any character outside the grammar, a slot outside the expression, or more
 * than {@link MAX_FORMULA_TOKENS} tokens.
 */
function tokenize(instruction: string, slots: readonly FormulaOperandSlot[]): Tokenized | null {
  let index = 0;
  while (index < instruction.length && isSpace(instruction[index]!)) index += 1;
  if (instruction[index] !== '=') return null;
  // An operand before the `=` is not part of the expression.
  if (slots.length > 0 && slots[0]!.offset <= index) return null;
  index += 1;
  const tokens: Token[] = [];
  let slot = 0;
  const push = (token: Token): boolean => {
    tokens.push(token);
    return tokens.length <= MAX_FORMULA_TOKENS;
  };
  for (;;) {
    while (slot < slots.length && slots[slot]!.offset <= index) {
      if (!push({ type: 'field', match: slots[slot]!.match })) return null;
      slot += 1;
    }
    if (index >= instruction.length || instruction[index] === '\\') break;
    const char = instruction[index]!;
    if (isSpace(char)) {
      index += 1;
      continue;
    }
    if (isDigit(char) || char === '.') {
      const constant = readConstant(instruction, index);
      if (constant === null || !push(constant.token)) return null;
      index = constant.end;
      continue;
    }
    const next = instruction[index + 1];
    let operator: BinaryOperator | '(' | ')' | null = null;
    let width = 1;
    if (char === '<' && (next === '=' || next === '>')) {
      operator = next === '=' ? '<=' : '<>';
      width = 2;
    } else if (char === '>' && next === '=') {
      operator = '>=';
      width = 2;
    } else if ('+-*/^()=<>'.includes(char)) {
      operator = char as BinaryOperator | '(' | ')';
    }
    if (operator === null || !push({ type: 'operator', value: operator })) return null;
    index += width;
  }
  // Every operand must sit inside the expression, not in a switch argument.
  if (slot < slots.length) return null;
  return { tokens, switches: instruction.slice(index) };
}

const COMPARISONS: ReadonlySet<string> = new Set<Comparison>(['=', '<>', '<', '<=', '>', '>=']);

/**
 * Parse tokens into a postfix program by precedence (17.16.3.3): unary minus, then `^`, then
 * `*` and `/`, then `+` and `-`, then the comparisons. Operators of the same precedence
 * associate left to right. A chained `^` (`2 ^ 3 ^ 2`) is refused: its grouping is not settled.
 */
function parse(tokens: readonly Token[]): FormulaStep[] | null {
  const program: FormulaStep[] = [];
  let position = 0;
  let depth = 0;
  const peek = (): Token | undefined => tokens[position];
  const isOperator = (token: Token | undefined, value: string): boolean =>
    token?.type === 'operator' && token.value === value;

  const primary = (): boolean => {
    const token = peek();
    if (token === undefined) return false;
    position += 1;
    if (token.type === 'constant') {
      program.push({ op: 'constant', value: token.value, decimals: token.decimals });
      return true;
    }
    if (token.type === 'field') {
      program.push({ op: 'field', kind: token.match.kind });
      return true;
    }
    if (token.value !== '(') return false;
    depth += 1;
    if (depth > MAX_FORMULA_DEPTH || !comparison()) return false;
    depth -= 1;
    if (!isOperator(peek(), ')')) return false;
    position += 1;
    return true;
  };

  const unary = (): boolean => {
    if (!isOperator(peek(), '-')) return primary();
    position += 1;
    depth += 1;
    if (depth > MAX_FORMULA_DEPTH || !unary()) return false;
    depth -= 1;
    program.push({ op: 'negate' });
    return true;
  };

  const power = (): boolean => {
    if (!unary()) return false;
    if (!isOperator(peek(), '^')) return true;
    position += 1;
    if (!unary()) return false;
    program.push({ op: 'binary', operator: '^' });
    return !isOperator(peek(), '^');
  };

  const level = (operand: () => boolean, accepts: (value: string) => boolean) => (): boolean => {
    if (!operand()) return false;
    for (;;) {
      const token = peek();
      if (token?.type !== 'operator' || !accepts(token.value)) return true;
      position += 1;
      if (!operand()) return false;
      // A constant zero divisor never has a value, so the formula stays inert.
      const divisor = program.at(-1);
      if (token.value === '/' && divisor?.op === 'constant' && divisor.value === 0) return false;
      program.push({ op: 'binary', operator: token.value as BinaryOperator });
    }
  };
  const product = level(power, (value) => value === '*' || value === '/');
  const sum = level(product, (value) => value === '+' || value === '-');
  const comparison = level(sum, (value) => COMPARISONS.has(value));

  if (!comparison() || position !== tokens.length) return null;
  return program;
}

/** True when a `\#` picture is one {@link formatPageFormula} can render for any value. */
function formulaPictureSupported(picture: string): boolean {
  if (picture.length === 0 || picture.length > MAX_NUMERIC_PICTURE_CHARS) return false;
  return formatNumericPicture(0, picture) !== null;
}

/** A compiled `=` formula, or the single page field it reduces to (`= { PAGE }`). */
export type CompiledPageFormula =
  | { readonly single: AllowlistedPageFieldMatch; readonly switches: PageFieldSwitches }
  | { readonly formula: PageFormula; readonly switches: PageFieldSwitches };

/**
 * Compile an `=` formula instruction with its page-field operands, or null when any part falls
 * outside the subset this module evaluates.
 *
 * `instruction` is the formula's own instruction text without the nested operand fields, and
 * each slot's offset is where its operand field began in that text. The switches after the
 * expression go through the page-field switch grammar (`field-page-switches.ts`). Each operand
 * must render as a number: `\* Arabic` or no switch at all.
 */
export function compilePageFormula(
  instruction: string,
  slots: readonly FormulaOperandSlot[]
): CompiledPageFormula | null {
  if (slots.length === 0 || slots.length > MAX_FORMULA_OPERANDS) return null;
  for (const { match } of slots) {
    if (match.picture !== undefined || match.formula !== undefined) return null;
    if (match.numberFormat !== undefined && match.numberFormat !== 'decimal') return null;
  }
  const tokenized = tokenize(instruction, slots);
  if (tokenized === null) return null;
  const collapsed = tokenized.switches.replace(/\s+/g, ' ').trim();
  const parsed = parsePageFieldInstruction(collapsed.length > 0 ? `= ${collapsed}` : '=');
  if (parsed === null || parsed.keyword !== '=') return null;
  const switches: PageFieldSwitches = {
    ...(parsed.picture !== undefined ? { picture: parsed.picture } : {}),
    ...(parsed.numberFormat !== undefined ? { numberFormat: parsed.numberFormat } : {}),
  };
  const program = parse(tokenized.tokens);
  if (program === null) return null;
  const first = program[0];
  if (program.length === 1 && first?.op === 'field') {
    return { single: slots[0]!.match, switches };
  }
  if (switches.picture !== undefined && !formulaPictureSupported(switches.picture)) return null;
  const kinds: AllowlistedPageField[] = [];
  for (const { match } of slots) if (!kinds.includes(match.kind)) kinds.push(match.kind);
  return { formula: { program, kinds }, switches };
}

/** The page-field values one page evaluates a formula with. */
export interface PageFormulaValues {
  readonly page: number;
  readonly numPages: number;
  readonly sectionPages: number;
}

interface FormulaValue {
  readonly value: number;
  /** Decimal places the value shows: the most of its inputs, and two after a division. */
  readonly decimals: number;
}

function applyBinary(
  operator: BinaryOperator,
  left: FormulaValue,
  right: FormulaValue
): FormulaValue | null {
  const decimals = Math.max(left.decimals, right.decimals);
  const a = left.value;
  const b = right.value;
  switch (operator) {
    case '+':
      return { value: a + b, decimals };
    case '-':
      return { value: a - b, decimals };
    case '*':
      return { value: a * b, decimals };
    case '/':
      // Division by zero has no value: the field keeps its saved result.
      if (b === 0) return null;
      return { value: a / b, decimals: Math.max(decimals, DIVISION_DECIMALS) };
    case '^':
      // A negative exponent shows a different number of decimal places; keep it inert.
      if (b < 0) return null;
      return { value: a ** b, decimals };
    case '=':
      return { value: a === b ? 1 : 0, decimals: 0 };
    case '<>':
      return { value: a !== b ? 1 : 0, decimals: 0 };
    case '<':
      return { value: a < b ? 1 : 0, decimals: 0 };
    case '<=':
      return { value: a <= b ? 1 : 0, decimals: 0 };
    case '>':
      return { value: a > b ? 1 : 0, decimals: 0 };
    case '>=':
      return { value: a >= b ? 1 : 0, decimals: 0 };
  }
}

function fieldValue(kind: AllowlistedPageField, values: PageFormulaValues): number {
  return kind === 'PAGE'
    ? values.page
    : kind === 'NUMPAGES'
      ? values.numPages
      : values.sectionPages;
}

/** Run a postfix program, or null when a step has no finite value within the magnitude cap. */
function runProgram(
  program: readonly FormulaStep[],
  values: PageFormulaValues
): FormulaValue | null {
  const stack: FormulaValue[] = [];
  for (const step of program) {
    let next: FormulaValue | null;
    if (step.op === 'constant') next = { value: step.value, decimals: step.decimals };
    else if (step.op === 'field') next = { value: fieldValue(step.kind, values), decimals: 0 };
    else if (step.op === 'negate') {
      const operand = stack.pop();
      next = operand ? { value: -operand.value, decimals: operand.decimals } : null;
    } else {
      const right = stack.pop();
      const left = stack.pop();
      next = left && right ? applyBinary(step.operator, left, right) : null;
    }
    if (next === null || !Number.isFinite(next.value)) return null;
    if (Math.abs(next.value) > MAX_FORMULA_MAGNITUDE) return null;
    stack.push(next);
  }
  return stack.length === 1 ? stack[0]! : null;
}

/**
 * Round half away from zero to `decimals` places, in decimal rather than binary steps. The
 * value is first taken to 15 significant digits, so binary noise does not move a half: `10.7 *
 * 3 / 4` is 8.025, not 8.024999999999999.
 */
function roundDecimal(value: number, decimals: number): number {
  const magnitude = Number(Math.abs(value).toPrecision(15));
  const text = String(magnitude);
  const scaled = text.includes('e') ? magnitude * 10 ** decimals : Number(`${text}e${decimals}`);
  // Past exact integer range, rounding cannot change the digits a double holds.
  if (!Number.isSafeInteger(Math.ceil(scaled))) return value;
  const rounded = Math.round(scaled) / 10 ** decimals;
  return value < 0 ? -rounded : rounded;
}

/** The default display: rounded to the value's decimal places, without trailing zeros. */
function formatDefault(result: FormulaValue): string {
  const rounded = roundDecimal(result.value, result.decimals);
  // A nonzero value that rounds to zero shows one decimal place.
  if (rounded === 0) return result.value === 0 ? '0' : '0.0';
  let text = rounded.toFixed(result.decimals);
  if (text.includes('.')) {
    let end = text.length;
    while (text[end - 1] === '0') end -= 1;
    if (text[end - 1] === '.') end -= 1;
    text = text.slice(0, end);
  }
  return text;
}

/** True when every character of a picture is a `0` digit position. */
function onlyRequiredDigits(picture: string): boolean {
  for (const char of picture) if (char !== '0') return false;
  return true;
}

/**
 * The text a compiled formula shows for one page, or null when it has no value there: a
 * division by zero, a step past the magnitude cap, or a result its switches cannot render.
 * The caller then keeps the field's saved result.
 *
 * Without switches the value shows its decimal places, rounded half away from zero, with
 * trailing zeros removed. A `\#` picture rounds to a whole number first; a negative value
 * renders only through a picture of `0` positions, with a leading minus sign. A `\*` number
 * format renders only a whole, non-negative value.
 */
export function formatPageFormula(
  formula: PageFormula,
  values: PageFormulaValues,
  switches: PageFieldSwitches
): string | null {
  const result = runProgram(formula.program, values);
  if (result === null) return null;
  if (switches.numberFormat !== undefined) {
    const whole = roundDecimal(result.value, MAX_CONSTANT_DECIMALS);
    if (!Number.isInteger(whole) || whole < 0) return null;
    return formatPageFieldNumber(whole, switches.numberFormat);
  }
  if (switches.picture !== undefined) {
    const whole = roundDecimal(result.value, 0);
    if (whole >= 0) return formatNumericPicture(whole, switches.picture);
    if (!onlyRequiredDigits(switches.picture)) return null;
    const digits = formatNumericPicture(-whole, switches.picture);
    return digits === null ? null : `-${digits}`;
  }
  return formatDefault(result);
}
