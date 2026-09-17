// The date-picker model: locale-first weekday order, a fixed 42-cell grid, and local dates.

import { describe, expect, test } from 'bun:test';
import {
  calendarMonth,
  calendarWeekdays,
  firstDayOfWeek,
  isoDateOf,
  parseIsoDate,
  shiftMonth,
} from '../content-control-calendar.ts';

describe('content-control calendar model', () => {
  test('a month grid always has 42 cells and starts on the locale first weekday', () => {
    const us = calendarMonth(2026, 8, { locale: 'en-US', today: new Date(2026, 8, 17) });
    expect(us.days).toHaveLength(42);
    // September 1, 2026 is a Tuesday; a Sunday-first grid pads two cells before it.
    expect(us.days.slice(0, 3).map((day) => day.iso)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
    expect(us.days[0]!.otherMonth).toBe(true);
    expect(us.days[2]!.otherMonth).toBe(false);
    expect(us.days.find((day) => day.today)?.iso).toBe('2026-09-17');
    expect(us.title).toBe('September 2026');

    const de = calendarMonth(2026, 8, { locale: 'de-DE', today: new Date(2026, 8, 17) });
    expect(de.days[0]!.iso).toBe('2026-08-31');
    expect(de.weekdays[0]).toBe('M');
  });

  test('the selected ISO value marks its cell as a local date', () => {
    const month = calendarMonth(2026, 8, {
      locale: 'en-US',
      selected: '2026-09-04T00:00:00Z',
      today: new Date(2026, 0, 1),
    });
    const selected = month.days.filter((day) => day.selected);
    expect(selected.map((day) => day.iso)).toEqual(['2026-09-04']);
    expect(selected[0]!.label).toBe('Friday, September 4, 2026');
  });

  test('first weekday falls back per region and defaults to Monday', () => {
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('fr-FR')).toBe(1);
    expect(firstDayOfWeek('not a locale')).toBe(0);
    expect(calendarWeekdays('en-US')).toHaveLength(7);
  });

  test('ISO helpers round-trip local dates and refuse impossible ones', () => {
    expect(isoDateOf(new Date(2026, 1, 3))).toBe('2026-02-03');
    expect(parseIsoDate('2026-02-03T00:00:00Z')?.getDate()).toBe(3);
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('nonsense')).toBeNull();
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});
