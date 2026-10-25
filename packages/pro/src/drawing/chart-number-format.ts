/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Spreadsheet number format codes, as charts use them for tick and data labels.
//
// The subset covers what charts carry in practice: `General`, digit placeholders with
// thousands separators, scaling commas and percent, literal text and currency tags, the
// positive;negative;zero sections, scientific notation, and date and time codes. Anything
// else formats as `General`. Format codes are file-derived, so parsing is a bounded single
// pass with no regular expressions over the whole code.

const MAX_CODE_UNITS = 256;
const MAX_DECIMALS = 30;
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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `General`: up to ten significant digits, scientific past eleven characters. */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e11 || magnitude < 1e-9) {
    const [mantissa, exponent] = value.toExponential(5).split('e');
    const trimmed = mantissa!.replace(/\.?0+$/, '');
    const power = Number(exponent);
    return `${trimmed}E${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`;
  }
  const digits = Math.max(0, 10 - Math.max(1, Math.floor(Math.log10(magnitude)) + 1));
  const fixed = value.toFixed(Math.min(digits, 20));
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Split a code into sections on `;` outside quotes, brackets and escapes. */
function sections(code: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  let bracket = false;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    if (char === '\\' && !quoted && index + 1 < code.length) {
      current += char + code[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '[') bracket = true;
    else if (!quoted && char === ']') bracket = false;
    if (char === ';' && !quoted && !bracket) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

interface Token {
  readonly kind: 'literal' | 'code';
  readonly text: string;
}

/** Literal runs and code characters of one section; `[...]` tags become their literal text. */
function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index]!;
    if (char === '"') {
      const end = section.indexOf('"', index + 1);
      const stop = end === -1 ? section.length : end;
      tokens.push({ kind: 'literal', text: section.slice(index + 1, stop) });
      index = stop;
    } else if (char === '\\' && index + 1 < section.length) {
      tokens.push({ kind: 'literal', text: section[index + 1]! });
      index += 1;
    } else if (char === '_' && index + 1 < section.length) {
      // `_x` leaves the width of `x` blank.
      tokens.push({ kind: 'literal', text: ' ' });
      index += 1;
    } else if (char === '*' && index + 1 < section.length) {
      // `*x` repeats `x` to fill the cell; a label has no cell width to fill.
      index += 1;
    } else if (char === '[') {
      const end = section.indexOf(']', index + 1);
      const stop = end === -1 ? section.length : end;
      const tag = section.slice(index + 1, stop);
      // `[h]`, `[mm]`, `[ss]`: elapsed time, counted past the day, hour or minute.
      if (/^(?:h+|m+|s+)$/i.test(tag)) tokens.push({ kind: 'code', text: `[${tag}]` });
      // `[$€-407]` shows its currency text; colours, conditions and locales show nothing.
      else if (tag.startsWith('$')) {
        const dash = tag.indexOf('-');
        tokens.push({ kind: 'literal', text: tag.slice(1, dash === -1 ? tag.length : dash) });
      }
      index = stop;
    } else if ("$-+/():!^&'~{}<>= ".includes(char)) {
      tokens.push({ kind: 'literal', text: char });
    } else {
      tokens.push({ kind: 'code', text: char });
    }
  }
  return tokens;
}

/** The date letter of a code token: `[h]` counts as `h`. */
function dateLetter(text: string): string {
  return (text[0] === '[' ? text[1]! : text[0]!).toLowerCase();
}

function isDateCode(tokens: readonly Token[]): boolean {
  let date = false;
  // `0` after `s.` is a fraction of a second, not a digit placeholder.
  let previous = '';
  let fraction = false;
  for (const token of tokens) {
    if (token.kind !== 'code') continue;
    const lower = dateLetter(token.text);
    if (lower === '.') fraction = previous === 's';
    else if (lower === '0' && fraction) continue;
    else if (lower === '0' || lower === '#' || lower === '?') return false;
    else fraction = false;
    if ('ymdhs'.includes(lower)) date = true;
    previous = lower;
  }
  return date;
}

function groupThousands(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits[index];
  }
  return out;
}

/** A section of digit placeholders, with its literals in place. */
function formatNumberSection(value: number, tokens: readonly Token[]): string {
  const codes = tokens.map((token) => (token.kind === 'code' ? token.text : ''));
  const exponentAt = codes.findIndex((code) => code === 'E' || code === 'e');
  const placeholders = (code: string) => code === '0' || code === '#' || code === '?';
  let percent = 0;
  let decimalAt = -1;
  let lastDigit = -1;
  let firstDigit = -1;
  for (let index = 0; index < codes.length; index += 1) {
    if (exponentAt !== -1 && index >= exponentAt) break;
    const code = codes[index]!;
    if (code === '%') percent += 1;
    if (code === '.' && decimalAt === -1) decimalAt = index;
    if (placeholders(code)) {
      if (firstDigit === -1) firstDigit = index;
      lastDigit = index;
    }
  }
  if (firstDigit === -1) {
    // No digits: the section is literal text only.
    return tokens.map((token) => (token.kind === 'literal' ? token.text : '')).join('');
  }
  let scaled = value * 100 ** Math.min(percent, 3);
  // Commas right after the last digit placeholder scale by a thousand each.
  let scale = lastDigit + 1;
  while (scale < codes.length && codes[scale] === ',') {
    scaled /= 1000;
    scale += 1;
  }
  const integerEnd = decimalAt === -1 ? lastDigit + 1 : decimalAt;
  let thousands = false;
  let minInteger = 0;
  for (let index = firstDigit; index < integerEnd; index += 1) {
    if (codes[index] === ',') thousands = true;
    if (codes[index] === '0') minInteger += 1;
  }
  let minDecimals = 0;
  let maxDecimals = 0;
  if (decimalAt !== -1) {
    for (let index = decimalAt + 1; index <= lastDigit; index += 1) {
      if (!placeholders(codes[index]!)) continue;
      maxDecimals += 1;
      if (codes[index] === '0') minDecimals = maxDecimals;
    }
  }
  // Spreadsheets cap a format at 30 decimal places; `toFixed` throws past 100.
  maxDecimals = Math.min(maxDecimals, MAX_DECIMALS);
  minDecimals = Math.min(minDecimals, maxDecimals);
  let body: string;
  if (exponentAt !== -1) {
    const mantissaDigits = maxDecimals;
    const [mantissa, exponent] = Math.abs(scaled).toExponential(mantissaDigits).split('e');
    const power = Number(exponent);
    const signed = tokens[exponentAt + 1]?.text === '+' || tokens[exponentAt + 1]?.text === '-';
    const sign = power < 0 ? '-' : tokens[exponentAt + 1]?.text === '+' ? '+' : '';
    let zeros = 0;
    for (let index = exponentAt + (signed ? 2 : 1); index < codes.length; index += 1) {
      if (!placeholders(codes[index]!)) break;
      zeros += 1;
    }
    body = `${mantissa}E${sign}${String(Math.abs(power)).padStart(Math.max(1, zeros), '0')}`;
  } else {
    const fixed = Math.abs(scaled).toFixed(maxDecimals);
    let [integer, fraction = ''] = fixed.split('.');
    while (fraction.length > minDecimals && fraction.endsWith('0'))
      fraction = fraction.slice(0, -1);
    if (integer === '0' && minInteger === 0) integer = '';
    integer = integer!.padStart(minInteger, '0');
    if (thousands) integer = groupThousands(integer);
    // A decimal point always shows, even with no digit after it (`0.#` formats 5 as `5.`).
    body = decimalAt === -1 ? integer : `${integer}.${fraction}`;
  }
  let prefix = '';
  let suffix = '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const text = token.kind === 'literal' ? token.text : token.text === '%' ? '%' : '';
    if (index < firstDigit) prefix += text;
    else if (index > (exponentAt !== -1 ? codes.length : lastDigit) && token.text !== ',')
      suffix += text;
  }
  return prefix + body + suffix;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** A serial date as its calendar parts, in the 1900 or the 1904 system. */
function serialDate(serial: number, date1904: boolean): Date | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  // The 1900 system counts a 29 February 1900 that never was; serials past it shift by one.
  const days = date1904 ? serial + 1462 : serial < 61 ? serial + 1 : serial;
  const ms = Math.round((days - 25_569) * 86_400_000);
  return new Date(ms);
}

function formatDateSection(serial: number, tokens: readonly Token[], date1904: boolean): string {
  const date = serialDate(Math.abs(serial), date1904);
  if (!date) return formatGeneral(serial);
  const runs: { kind: 'literal' | 'code'; text: string }[] = [];
  for (const token of tokens) {
    const last = runs[runs.length - 1];
    if (
      last &&
      last.kind === 'code' &&
      token.kind === 'code' &&
      last.text[0] !== '[' &&
      token.text[0] !== '[' &&
      last.text[0]!.toLowerCase() === token.text.toLowerCase()
    )
      last.text += token.text;
    else runs.push({ kind: token.kind, text: token.text });
  }
  const twelveHour = tokens.some(
    (token) => token.kind === 'code' && token.text.toLowerCase() === 'a'
  );
  let out = '';
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    if (run.kind === 'literal') {
      out += run.text;
      continue;
    }
    const lower = run.text.toLowerCase();
    const letter = dateLetter(run.text);
    const length = run.text.length;
    if (lower[0] === '[') {
      // Elapsed whole hours, minutes or seconds since serial zero.
      const per = letter === 'h' ? 24 : letter === 'm' ? 1440 : 86_400;
      out += pad(Math.floor(Math.abs(serial) * per + 1e-9), length - 2);
    } else if (letter === '0' && runs[index - 1]?.text === '.') {
      // Fractional seconds, truncated to the shown digits.
      const ms = date.getUTCMilliseconds();
      out += pad(Math.floor(ms / 10 ** (3 - Math.min(length, 3))), Math.min(length, 3)).padEnd(
        length,
        '0'
      );
    } else if (letter === 'y')
      out += length <= 2 ? pad(date.getUTCFullYear() % 100, 2) : String(date.getUTCFullYear());
    else if (letter === 'd') {
      if (length >= 4) out += DAYS[date.getUTCDay()];
      else if (length === 3) out += DAYS[date.getUTCDay()]!.slice(0, 3);
      else out += length === 2 ? pad(date.getUTCDate(), 2) : String(date.getUTCDate());
    } else if (letter === 'm') {
      const previous = runs
        .slice(0, index)
        .reverse()
        .find((r) => r.kind === 'code');
      const next = runs.slice(index + 1).find((r) => r.kind === 'code');
      const minute =
        length <= 2 &&
        ((previous && dateLetter(previous.text) === 'h') ||
          (next && dateLetter(next.text) === 's'));
      if (minute) out += length === 2 ? pad(date.getUTCMinutes(), 2) : String(date.getUTCMinutes());
      else if (length >= 5) out += MONTHS[date.getUTCMonth()]![0];
      else if (length === 4) out += MONTHS[date.getUTCMonth()];
      else if (length === 3) out += MONTHS[date.getUTCMonth()]!.slice(0, 3);
      else out += length === 2 ? pad(date.getUTCMonth() + 1, 2) : String(date.getUTCMonth() + 1);
    } else if (letter === 'h') {
      let hours = date.getUTCHours();
      if (twelveHour) hours = hours % 12 === 0 ? 12 : hours % 12;
      out += length >= 2 ? pad(hours, 2) : String(hours);
    } else if (letter === 's') {
      out += length >= 2 ? pad(date.getUTCSeconds(), 2) : String(date.getUTCSeconds());
    } else if (letter === 'a') {
      // `AM/PM` or `A/P`: the letters arrive split by the `/` literal.
      const pm = date.getUTCHours() >= 12;
      const short = runs[index + 2]?.text.toLowerCase() === 'p';
      out += short ? (pm ? 'P' : 'A') : pm ? 'PM' : 'AM';
      // Skip the rest of the marker: `M`, `/`, `P`, `M` or `/`, `P`.
      while (index + 1 < runs.length && /^[mp/]/i.test(runs[index + 1]!.text)) index += 1;
    } else if (letter === 'e') out += String(date.getUTCFullYear());
    else if (letter === 'g' || letter === 'b') continue;
    else out += run.text;
  }
  return out;
}

/** Format `value` by a spreadsheet format code; `General` for codes outside the subset. */
export function formatChartNumber(value: number, code: string | null, date1904 = false): string {
  if (!Number.isFinite(value)) return '';
  if (!code || code.length > MAX_CODE_UNITS || /^general$/i.test(code.trim())) {
    return formatGeneral(value);
  }
  const parts = sections(code);
  let section = parts[0]!;
  let magnitude = value;
  if (value < 0 && parts.length >= 2) {
    section = parts[1]!;
    magnitude = -value;
  } else if (value === 0 && parts.length >= 3) {
    section = parts[2]!;
  }
  if (/^general$/i.test(section.trim())) return formatGeneral(magnitude);
  const tokens = tokenize(section);
  if (isDateCode(tokens)) return formatDateSection(value, tokens, date1904);
  const formatted = formatNumberSection(magnitude, tokens);
  // A single section signs its own negatives; an explicit negative section does not.
  const zeroish = /^[^1-9]*$/.test(formatted);
  return magnitude < 0 && !zeroish ? `-${formatted}` : formatted;
}

/** Whether a format code shows dates, so a category axis of serials is a date axis. */
export function isDateFormatCode(code: string | null): boolean {
  if (!code || code.length > MAX_CODE_UNITS || /^general$/i.test(code.trim())) return false;
  return isDateCode(tokenize(sections(code)[0]!));
}

/** The categories of one series, as cached: text, and numbers with their format. */
interface CategoryCache {
  readonly categories: readonly (string | null)[] | null;
  readonly categoryNumbers: readonly (number | null)[] | null;
  readonly categoryFormat: string | null;
}

/** Category `index` of a series: a cached number in its format, else the cached text. */
export function categoryLabel(
  series: CategoryCache,
  index: number,
  date1904: boolean
): string | null {
  const number = series.categoryNumbers?.[index];
  if (number !== undefined && number !== null && series.categoryFormat) {
    return formatChartNumber(number, series.categoryFormat, date1904);
  }
  return series.categories?.[index] ?? null;
}
