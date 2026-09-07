/** Slash-date input order, independent of the field's output picture. */
export type DateInputOrder = 'mdy' | 'dmy';
export function validDateInputOrder(value: unknown): boolean {
  return value === undefined || value === 'mdy' || value === 'dmy';
}
export const textFormMonths = [
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
export function parseTextFormDate(
  text: string,
  order: DateInputOrder = 'mdy'
): { year: number; month: number; day: number } | null {
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  const named = /^(?:(\d{1,2}) ([A-Za-z]+)|([A-Za-z]+) (\d{1,2}),) (\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (numeric) {
    year = Number(numeric[3]);
    if (numeric[3]!.length === 2) year += year <= 29 ? 2000 : 1900;
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const preferred = order === 'dmy' ? [second, first] : [first, second];
    [month, day] = preferred as [number, number];
    if (!validDate(year, month, day)) [month, day] = [day, month];
  } else if (named) {
    year = Number(named[5]);
    day = Number(named[1] ?? named[4]);
    month =
      textFormMonths.findIndex(
        (name) => name.toLowerCase() === (named[2] ?? named[3])!.toLowerCase()
      ) + 1;
  } else return null;
  return validDate(year, month, day) ? { year, month, day } : null;
}
function validDate(year: number, month: number, day: number): boolean {
  if (year < 100 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
