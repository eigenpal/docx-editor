// DATE and TIME fields show the current date and time when the host supplies one.
//
// DATE (ECMA-376 Part 1, 17.16.5.13) and TIME (17.16.5.65) have the current date and time as
// their value, so the saved result is the date of the last update, not today. A host passes
// `fieldDate` to layout, and the field shows that moment through its `\@` picture (17.16.4.1).
// CREATEDATE, SAVEDATE, and PRINTDATE name a fixed moment and keep their saved results.
//
// The value is display-only: layout never writes it to the document, so collaboration
// participants and saved files keep the stored result. Without `fieldDate`, and while saved
// results are editable text (`fieldResults: 'editable'`), every field keeps its saved result.
//
// Field instructions are attacker-controlled. This is a bounded, one-pass scanner: no regex
// over the instruction, no backtracking, no recursion. It accepts exactly this grammar and
// returns null for anything else, which keeps the field on its saved result:
//
//   DATE|TIME \@ picture [\* MERGEFORMAT | \* CHARFORMAT]...
//
// A field without a picture keeps its saved result, because 17.16.4.1 leaves the default format
// to the implementation. So do `\l`, `\h`, `\s`, casing switches, and any picture letter outside
// the codes below. Month and day names follow the language of the run that holds the field
// instruction (`w:lang`, 17.3.2.20, `CT_Language`). A simple field (17.16.19) has no such run
// and takes the paragraph's run properties without direct formatting, else its result run's
// language. Only English names are built in, so a picture with a name keeps its saved result
// in a run of another language. Numeric codes and `AM/PM` do not depend on the language.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { currentFieldResultsMode } from '../store/package/field-result-mode.ts';
import { MAX_FIELD_INSTRUCTION_CHARS } from '../store/package/field-nodes.ts';
import { runTextLanguage } from './run-proofing.ts';

/** One picture item: a date or time code, or literal text. */
type DatePictureItem =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly code: DatePictureCode };

type DatePictureCode =
  | 'd'
  | 'dd'
  | 'ddd'
  | 'dddd'
  | 'M'
  | 'MM'
  | 'MMM'
  | 'MMMM'
  | 'y'
  | 'yy'
  | 'yyyy'
  | 'Y'
  | 'YY'
  | 'YYYY'
  | 'h'
  | 'hh'
  | 'H'
  | 'HH'
  | 'm'
  | 'mm'
  | 'ss'
  | 'AM/PM'
  | 'am/pm';

/** A recognized DATE or TIME field: the picture its value renders through. */
export interface DateFieldSpec {
  readonly picture: readonly DatePictureItem[];
  /** The picture shows a day or month name (`ddd`, `dddd`, `MMM`, `MMMM`). */
  readonly names: boolean;
}

const NAME_CODES: ReadonlySet<DatePictureCode> = new Set<DatePictureCode>([
  'ddd',
  'dddd',
  'MMM',
  'MMMM',
]);

const CODES: ReadonlySet<string> = new Set<DatePictureCode>([
  'd',
  'dd',
  'ddd',
  'dddd',
  'M',
  'MM',
  'MMM',
  'MMMM',
  'y',
  'yy',
  'yyyy',
  'Y',
  'YY',
  'YYYY',
  'h',
  'hh',
  'H',
  'HH',
  'm',
  'mm',
  'ss',
]);

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const isAsciiLetter = (char: string): boolean => /^[A-Za-z]$/.test(char);
/** The Thai picture item letters of 17.16.4.1: day (`ว`), weekday (`ด`), and year (`ป`). */
const THAI_PICTURE_LETTERS: ReadonlySet<string> = new Set(['\u0E27', '\u0E14', '\u0E1B']);
/**
 * A line break in a picture: CR LF, CR, or LF. A field result shows each one as one space,
 * so a CR LF pair is one space, not two.
 */
const LINE_BREAK = /\r\n|[\r\n]/g;
const isSpace = (char: string | undefined): boolean => char !== undefined && /^\s$/.test(char);

/**
 * Split a `\@` picture into items, or null when it holds a letter outside the codes.
 *
 * A run of one code letter is one code (`dd`, `MMMM`). Text in single quotes is literal
 * (17.16.4.1, `'text'`), and so is every other character that is not a letter, a Thai picture
 * letter, or a backquote: punctuation, spaces, and other scripts show as they are. Empty
 * quotes add no text, so a picture of only `''` shows an empty result. A line break shows as
 * one space.
 */
function parseDatePicture(picture: string): DatePictureItem[] | null {
  const items: DatePictureItem[] = [];
  let index = 0;
  while (index < picture.length) {
    const char = picture[index]!;
    if (char === "'") {
      const close = picture.indexOf("'", index + 1);
      if (close < 0) return null;
      items.push({ kind: 'text', text: picture.slice(index + 1, close).replace(LINE_BREAK, ' ') });
      index = close + 1;
      continue;
    }
    const meridiem = picture.slice(index, index + 5);
    if (meridiem === 'AM/PM' || meridiem === 'am/pm') {
      items.push({ kind: 'code', code: meridiem });
      index += 5;
      continue;
    }
    if (char === '\r' || char === '\n') {
      items.push({ kind: 'text', text: ' ' });
      index += char === '\r' && picture[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    // A Thai picture item (`ว`, `ด`, `ป`) formats in Thai numerals or the Thai Buddhist Era,
    // and a backquoted item names a SEQ number (17.16.4.1). Neither is built in.
    if (THAI_PICTURE_LETTERS.has(char) || char === '`') return null;
    if (!isAsciiLetter(char)) {
      items.push({ kind: 'text', text: char });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (picture[end] === char) end += 1;
    const code = picture.slice(index, end);
    if (!CODES.has(code)) return null;
    items.push({ kind: 'code', code: code as DatePictureCode });
    index = end;
  }
  return items;
}

/**
 * Read one switch argument at `start`: quoted up to the closing quote, or bare up to the next
 * space or backslash. Null for an unterminated quote or a quote inside a bare argument.
 */
function readArgument(text: string, start: number): { value: string; end: number } | null {
  if (text[start] === '"') {
    // 17.16.1: inside quotes, `\"` is a double quote and `\\` is one backslash. A backslash
    // before any other character is dropped and the character is read as it is.
    let value = '';
    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index]!;
      if (char === '"') return { value, end: index + 1 };
      if (char === '\\') {
        const next = text[index + 1];
        if (next === undefined) return null;
        value += next;
        index += 1;
        continue;
      }
      value += char;
    }
    return null;
  }
  let end = start;
  while (end < text.length && !isSpace(text[end]) && text[end] !== '\\') {
    if (text[end] === '"') return null;
    end += 1;
  }
  return { value: text.slice(start, end), end };
}

/** Recognize a DATE or TIME instruction with a `\@` picture, or null (saved result shows). */
export function parseDateFieldInstruction(raw: string): DateFieldSpec | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  // Whitespace is not collapsed: a quoted picture keeps its spaces and tabs as literal text.
  const instruction = raw.trim();
  let index = 0;
  while (index < instruction.length && !isSpace(instruction[index])) index += 1;
  const keyword = instruction.slice(0, index).toUpperCase();
  if (keyword !== 'DATE' && keyword !== 'TIME') return null;

  let picture: DatePictureItem[] | null = null;
  while (index < instruction.length) {
    if (isSpace(instruction[index])) {
      index += 1;
      continue;
    }
    if (instruction[index] !== '\\') return null;
    const kind = instruction[index + 1];
    index += 2;
    while (isSpace(instruction[index])) index += 1;
    const argument = readArgument(instruction, index);
    if (argument === null || argument.value.length === 0) return null;
    index = argument.end;
    if (kind === '@') {
      if (picture !== null) return null;
      picture = parseDatePicture(argument.value);
      if (picture === null) return null;
      continue;
    }
    if (kind !== '*') return null;
    const format = argument.value.toUpperCase();
    if (format !== 'MERGEFORMAT' && format !== 'CHARFORMAT') return null;
  }
  if (picture === null) return null;
  const names = picture.some((item) => item.kind === 'code' && NAME_CODES.has(item.code));
  return { picture, names };
}

const padded = (value: number): string => String(value).padStart(2, '0');

function codeText(code: DatePictureCode, date: Date): string {
  switch (code) {
    case 'd':
      return String(date.getDate());
    case 'dd':
      return padded(date.getDate());
    case 'ddd':
      return WEEKDAYS[date.getDay()]!.slice(0, 3);
    case 'dddd':
      return WEEKDAYS[date.getDay()]!;
    case 'M':
      return String(date.getMonth() + 1);
    case 'MM':
      return padded(date.getMonth() + 1);
    case 'MMM':
      return MONTHS[date.getMonth()]!.slice(0, 3);
    case 'MMMM':
      return MONTHS[date.getMonth()]!;
    case 'y':
    case 'yy':
    case 'Y':
    case 'YY':
      return padded(date.getFullYear() % 100);
    case 'yyyy':
    case 'YYYY':
      return String(date.getFullYear());
    case 'h':
      return String(date.getHours() % 12 || 12);
    case 'hh':
      return padded(date.getHours() % 12 || 12);
    case 'H':
      return String(date.getHours());
    case 'HH':
      return padded(date.getHours());
    case 'm':
      return String(date.getMinutes());
    case 'mm':
      return padded(date.getMinutes());
    case 'ss':
      // 17.16.4.1 shows `h:mm:ss am/pm` as `5:28:34 PM`.
      return padded(date.getSeconds());
    case 'AM/PM':
    case 'am/pm':
      // 17.16.4.1: `h:mm am/pm` shows `5:28 PM`. Both spellings show upper case.
      return date.getHours() < 12 ? 'AM' : 'PM';
  }
}

/** True for a language whose day and month names are the built-in English ones. */
function hasEnglishNames(language: string | null): boolean {
  if (language === null) return true;
  const primary = language.split('-')[0]!.toLowerCase();
  return primary === 'en';
}

/**
 * The text a recognized field shows for `date`, in the date's local time, or null when the
 * picture shows a day or month name and `props` (the cascaded properties of the run that holds
 * the field instruction) select a language other than English. The field then keeps its saved
 * result.
 */
export function formatDateField(
  spec: DateFieldSpec,
  date: Date,
  props: readonly OoxmlProperty[] = []
): string | null {
  if (spec.names && !hasEnglishNames(runTextLanguage(props))) return null;
  return spec.picture
    .map((item) => (item.kind === 'text' ? item.text : codeText(item.code, date)))
    .join('');
}

let current: Date | undefined;

/**
 * The moment DATE and TIME fields show in the layout call in progress, or undefined when they
 * keep their saved results: outside a scoped call, without `fieldDate`, or while saved results
 * are editable text.
 */
export function currentFieldDate(): Date | undefined {
  return currentFieldResultsMode() === 'atomic' ? current : undefined;
}

/**
 * Run `run` with `date` installed for every field it lays out, then restore the outer value,
 * also when `run` throws. `undefined` and an invalid date keep the outer value, as
 * `withFieldResultsMode` keeps the outer mode: the document view installs the date once and
 * lays out its body through a nested semantic layout call whose options carry no date. Cache
 * keys read the installed value ({@link currentFieldDate}), not the options, so a nested call
 * never stores a dated layout under an undated key.
 */
export function withFieldDate<T>(date: Date | undefined, run: () => T): T {
  if (date === undefined || Number.isNaN(date.getTime()) || date === current) return run();
  const outer = current;
  current = date;
  try {
    return run();
  } finally {
    current = outer;
  }
}

/** The refusal for a `fieldDate` that is not a valid `Date`, in the editor and in export. */
const INVALID_FIELD_DATE_REFUSAL = 'Invalid fieldDate: use a valid Date';

/**
 * A copy of `value` in this realm, or undefined without one. A `TypeError` refuses any value that
 * is not a valid `Date`, also one from another window (no `instanceof`). The copy keeps a caller
 * that mutates its own `Date` later from changing a layout that keys its caches on the date.
 */
export function copyValidFieldDate(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  let time = Number.NaN;
  try {
    time = Date.prototype.getTime.call(value);
  } catch {
    // Not a Date: refused below.
  }
  if (Number.isNaN(time)) throw new TypeError(INVALID_FIELD_DATE_REFUSAL);
  return new Date(time);
}
