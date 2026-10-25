/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  categoryLabel,
  formatChartNumber,
  formatGeneral,
  isDateFormatCode,
} from '../chart-number-format.ts';

describe('chart number formats', () => {
  test('General keeps ten significant digits and switches to scientific when long', () => {
    expect(formatGeneral(0)).toBe('0');
    expect(formatGeneral(4.3)).toBe('4.3');
    expect(formatGeneral(0.1 + 0.2)).toBe('0.3');
    expect(formatGeneral(-12500)).toBe('-12500');
    expect(formatGeneral(123456789012)).toBe('1.23457E+11');
    expect(formatChartNumber(2.5, 'General')).toBe('2.5');
  });

  test('digit placeholders, thousands, scaling and percent', () => {
    expect(formatChartNumber(48200, '#,##0')).toBe('48,200');
    expect(formatChartNumber(1234.5, '#,##0.00')).toBe('1,234.50');
    expect(formatChartNumber(0.125, '0.0%')).toBe('12.5%');
    expect(formatChartNumber(0.58, '0%')).toBe('58%');
    expect(formatChartNumber(3, '0.0')).toBe('3.0');
    expect(formatChartNumber(5, '0.##')).toBe('5.');
    expect(formatChartNumber(2500000, '#,##0,,"M"')).toBe('3M');
    expect(formatChartNumber(-7, '0')).toBe('-7');
    expect(formatChartNumber(-7, '0;(0)')).toBe('(7)');
    expect(formatChartNumber(0, '0;-0;"none"')).toBe('none');
    expect(formatChartNumber(12.5, '[$€-407]#,##0.00')).toBe('€12.50');
    expect(formatChartNumber(1200, '"$"#,##0_);[Red]\\("$"#,##0\\)')).toBe('$1,200 ');
    expect(formatChartNumber(-1200, '"$"#,##0_);[Red]\\("$"#,##0\\)')).toBe('($1,200)');
    expect(formatChartNumber(12345, '0.00E+00')).toBe('1.23E+04');
  });

  test('dates from serials in both date systems', () => {
    expect(formatChartNumber(45292, 'm/d/yyyy')).toBe('1/1/2024');
    expect(formatChartNumber(45323, 'mmm-yy')).toBe('Feb-24');
    expect(formatChartNumber(45323, 'd-mmm')).toBe('1-Feb');
    expect(formatChartNumber(45323, 'mmmm yyyy')).toBe('February 2024');
    expect(formatChartNumber(45292.75, 'h:mm AM/PM')).toBe('6:00 PM');
    expect(formatChartNumber(0, 'm/d/yyyy', true)).toBe('1/1/1904');
    expect(isDateFormatCode('m/d/yyyy')).toBe(true);
    expect(isDateFormatCode('#,##0')).toBe(false);
    expect(isDateFormatCode('General')).toBe(false);
  });

  test('more decimals than a number can show cap at thirty instead of throwing', () => {
    const long = '0.' + '0'.repeat(101);
    expect(formatChartNumber(1.5, long)).toBe('1.5' + '0'.repeat(29));
    expect(formatChartNumber(1234.5, long + 'E+00')).toBe('1.2345' + '0'.repeat(26) + 'E+03');
  });

  test('elapsed time and fractions of a second', () => {
    expect(isDateFormatCode('mm:ss.0')).toBe(true);
    expect(isDateFormatCode('[h]:mm')).toBe(true);
    expect(formatChartNumber(1234.5, 'mm:ss.0')).toBe('00:00.0');
    expect(formatChartNumber(1234.5, '[h]:mm')).toBe('29628:00');
    expect(formatChartNumber(1.25, '[h]:mm:ss')).toBe('30:00:00');
    expect(formatChartNumber(0.5 + 1.25 / 86_400, 'hh:mm:ss.00')).toBe('12:00:01.25');
  });

  test('a category shows its cached number in the category format', () => {
    const series = { categories: ['44927'], categoryNumbers: [44927], categoryFormat: 'mmm-yy' };
    expect(categoryLabel(series, 0, false)).toBe('Jan-23');
    expect(categoryLabel({ ...series, categoryNumbers: null }, 0, false)).toBe('44927');
  });
});
