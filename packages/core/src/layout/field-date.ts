// DATE and TIME fields (§17.16.4.1) show the current date and time when the host supplies one.
//
// Word recalculates these two fields whenever it opens a document, so the saved result is the
// date of the last save, not today. A host passes `fieldDate` to layout, and the field shows
// that moment through its `\@` picture. CREATEDATE, SAVEDATE, and PRINTDATE name a fixed moment
// and keep their saved results.
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
// A field without a picture keeps its saved result, because Word's default format depends on
// the system locale. So do `\l`, `\h`, `\s`, casing switches, and any picture letter outside
// the codes below. Month and day names are English.

import { currentFieldResultsMode } from '../store/package/field-result-mode.ts';
import { MAX_FIELD_INSTRUCTION_CHARS } from '../store/package/field-nodes.ts';

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
  | 'yy'
  | 'yyyy'
  | 'h'
  | 'hh'
  | 'H'
  | 'HH'
  | 'm'
  | 'mm'
  | 'AM/PM'
  | 'am/pm';

/** A recognized DATE or TIME field: the picture its value renders through. */
export interface DateFieldSpec {
  readonly picture: readonly DatePictureItem[];
}

const CODES: ReadonlySet<string> = new Set<DatePictureCode>([
  'd',
  'dd',
  'ddd',
  'dddd',
  'M',
  'MM',
  'MMM',
  'MMMM',
  'yy',
  'yyyy',
  'h',
  'hh',
  'H',
  'HH',
  'm',
  'mm',
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

/**
 * Split a `\@` picture into items, or null when it holds a letter outside the codes.
 *
 * A run of one code letter is one code (`dd`, `MMMM`). Text in single quotes is literal, and
 * every other character that is not a letter is literal too.
 */
function parseDatePicture(picture: string): DatePictureItem[] | null {
  const items: DatePictureItem[] = [];
  let index = 0;
  while (index < picture.length) {
    const char = picture[index]!;
    if (char === "'") {
      const close = picture.indexOf("'", index + 1);
      if (close < 0) return null;
      items.push({ kind: 'text', text: picture.slice(index + 1, close) });
      index = close + 1;
      continue;
    }
    const meridiem = picture.slice(index, index + 5);
    if (meridiem === 'AM/PM' || meridiem === 'am/pm') {
      items.push({ kind: 'code', code: meridiem });
      index += 5;
      continue;
    }
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
    const close = text.indexOf('"', start + 1);
    if (close < 0) return null;
    return { value: text.slice(start + 1, close), end: close + 1 };
  }
  let end = start;
  while (end < text.length && text[end] !== ' ' && text[end] !== '\\') {
    if (text[end] === '"') return null;
    end += 1;
  }
  return { value: text.slice(start, end), end };
}

/** Recognize a DATE or TIME instruction with a `\@` picture, or null (saved result shows). */
export function parseDateFieldInstruction(raw: string): DateFieldSpec | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const instruction = raw.replace(/\s+/g, ' ').trim();
  let index = 0;
  while (index < instruction.length && instruction[index] !== ' ') index += 1;
  const keyword = instruction.slice(0, index).toUpperCase();
  if (keyword !== 'DATE' && keyword !== 'TIME') return null;

  let picture: DatePictureItem[] | null = null;
  while (index < instruction.length) {
    if (instruction[index] === ' ') {
      index += 1;
      continue;
    }
    if (instruction[index] !== '\\') return null;
    const kind = instruction[index + 1];
    index += 2;
    while (instruction[index] === ' ') index += 1;
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
  return picture === null ? null : { picture };
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
    case 'yy':
      return padded(date.getFullYear() % 100);
    case 'yyyy':
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
    case 'AM/PM':
      return date.getHours() < 12 ? 'AM' : 'PM';
    case 'am/pm':
      return date.getHours() < 12 ? 'am' : 'pm';
  }
}

/** The text a recognized field shows for `date`, in the date's local time. */
export function formatDateField(spec: DateFieldSpec, date: Date): string {
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
 * also when `run` throws. `undefined` and an invalid date keep the outer value.
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
