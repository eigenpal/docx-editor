import { textFormFixedDecimal } from './text-form-number-format.ts';
import type { TextFormFieldRange } from './text-form-fields.ts';

/** Editable legacy text input types. Other authored types remain inert. */
export type TextFormFieldType = 'regular' | 'number' | 'date';
/** Options stored in the legacy field definition. Zero means unlimited length. */
export interface TextFormFieldOptions {
  readonly type: TextFormFieldType;
  readonly maxLength: number;
  readonly format: string;
  readonly enabled: boolean;
}

export const TEXT_FORM_FORMATS = {
  regular: ['', 'Uppercase', 'Lowercase', 'First capital', 'Title case'],
  number: ['', '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%'],
  date: [
    '',
    'M/d/yyyy',
    'MM/dd/yyyy',
    'd/M/yyyy',
    'dd/MM/yyyy',
    'yyyy-MM-dd',
    'd MMMM yyyy',
    'MMMM d, yyyy',
  ],
} as const;

export function validTextFormOptions(options: TextFormFieldOptions): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    typeof options.type === 'string' &&
    Object.hasOwn(TEXT_FORM_FORMATS, options.type) &&
    Number.isInteger(options.maxLength) &&
    options.maxLength >= 0 &&
    options.maxLength <= 32767 &&
    typeof options.enabled === 'boolean' &&
    typeof options.format === 'string' &&
    (TEXT_FORM_FORMATS[options.type] as readonly string[]).includes(options.format)
  );
}

const months = [
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
function parseDate(
  text: string,
  format: string
): { year: number; month: number; day: number } | null {
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const named = /^(?:(\d{1,2}) ([A-Za-z]+)|([A-Za-z]+) (\d{1,2}),) (\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (numeric) {
    year = Number(numeric[3]);
    [month, day] = format.startsWith('d')
      ? [Number(numeric[2]), Number(numeric[1])]
      : [Number(numeric[1]), Number(numeric[2])];
  } else if (named) {
    year = Number(named[5]);
    day = Number(named[1] ?? named[4]);
    month =
      months.findIndex((name) => name.toLowerCase() === (named[2] ?? named[3])!.toLowerCase()) + 1;
  } else return null;
  if (year < 100 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/** Bounded, deterministic formatting. Null refuses unsupported options or invalid complete input. */
export function formatTextFormValue(
  text: string,
  options: Pick<TextFormFieldRange, 'type' | 'format'>
): string | null {
  if (!Object.hasOwn(TEXT_FORM_FORMATS, options.type)) return null;
  if (
    !(TEXT_FORM_FORMATS[options.type as TextFormFieldType] as readonly string[]).includes(
      options.format
    )
  )
    return null;
  if (text === '') return '';
  if (options.type === 'regular') {
    if (options.format === 'Uppercase') return text.toUpperCase();
    if (options.format === 'Lowercase') return text.toLowerCase();
    if (options.format === 'First capital')
      return text.toLowerCase().replace(/\p{L}/u, (letter) => letter.toUpperCase());
    if (options.format === 'Title case')
      return text.replace(
        /\p{L}[\p{L}\p{M}]*/gu,
        (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()
      );
    return text;
  }
  if (options.type === 'number') {
    const input = text.trim();
    if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)%?$/.test(input)) return null;
    let number = Number(input.replaceAll(',', '').replace('%', ''));
    if (input.endsWith('%')) number /= 100;
    if (!Number.isFinite(number)) return null;
    if (!options.format) return text;
    const percent = options.format.endsWith('%');
    if (percent) number *= 100;
    if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return null;
    const decimals = options.format.includes('.00') ? 2 : 0;
    let result = textFormFixedDecimal(input, decimals, percent);
    if (result === null) return null;
    if (options.format.includes(',')) {
      const [integer, fraction] = result.split('.');
      let grouped = '';
      for (let i = 0; i < integer!.length; i++) {
        if (i > 0 && integer![i - 1] !== '-' && (integer!.length - i) % 3 === 0) grouped += ',';
        grouped += integer![i];
      }
      result = grouped + (fraction === undefined ? '' : `.${fraction}`);
    }
    return result + (percent ? '%' : '');
  }
  const date = parseDate(text.trim(), options.format);
  if (!date) return null;
  if (!options.format) return text;
  return options.format.replace(
    /yyyy|MMMM|MM|dd|M|d/g,
    (token) =>
      ({
        yyyy: String(date.year),
        MMMM: months[date.month - 1]!,
        MM: String(date.month).padStart(2, '0'),
        dd: String(date.day).padStart(2, '0'),
        M: String(date.month),
        d: String(date.day),
      })[token]!
  );
}

/** Preserved computed types and unimplemented format pictures are not filling targets. */
export function supportsTextFormField(field: Pick<TextFormFieldRange, 'type' | 'format'>): boolean {
  return (
    Object.hasOwn(TEXT_FORM_FORMATS, field.type) &&
    (TEXT_FORM_FORMATS[field.type as TextFormFieldType] as readonly string[]).includes(field.format)
  );
}

/** Grouping punctuation in a numeric picture does not consume the input limit. */
export function textFormInputLength(
  text: string,
  field: Pick<TextFormFieldRange, 'type' | 'format'>,
  previous = ''
): number {
  let input = text;
  if (field.type === 'number' && field.format) {
    const removeExisting = (char: string): void => {
      let remaining = 0;
      for (const c of previous) if (c === char) remaining++;
      let result = '';
      for (const c of input) {
        if (c === char && remaining > 0) remaining--;
        else result += c;
      }
      input = result;
    };
    if (field.format.includes(',')) removeExisting(',');
    if (field.format.endsWith('%')) removeExisting('%');
    // Discount only padding already present in the displayed picture. Extra typed
    // zeros still consume the limit, even when they do not change the numeric value.
    if (field.format.includes('.00') && previous.includes('.')) {
      const prior = previous.endsWith('%') ? previous.slice(0, -1) : previous;
      const point = input.lastIndexOf('.');
      const priorPoint = prior.lastIndexOf('.');
      let padding = 0;
      for (let i = prior.length - 1; i > priorPoint && prior[i] === '0' && padding < 2; i--)
        padding++;
      if (point >= 0) {
        let end = input.length;
        while (padding > 0 && end > point + 1 && input[end - 1] === '0') {
          end--;
          padding--;
        }
        if (end === point + 1) end--;
        input = input.slice(0, end);
      }
    }
  }
  if (field.type === 'date' && /[A-Za-z]/.test(previous)) {
    const date = parseDate(text.trim(), field.format);
    if (date) input = `${date.month}/${date.day}/${date.year}`;
  }
  return [...input].length;
}
