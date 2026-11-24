// Thai, Devanagari, Cyrillic, and Vietnamese `w:numFmt` sequences (ST_NumberFormat, ECMA-376
// Part 1, 17.18.59). Expected strings are the list text DOCX applications write.

import { describe, expect, test } from 'bun:test';
import { formatNumFmt } from '../numbering-format.ts';

function expectSequence(numFmt: string, cases: readonly (readonly [number, string])[]) {
  for (const [value, text] of cases)
    expect([value, formatNumFmt(numFmt, value)]).toEqual([value, text]);
}

describe('Thai formats', () => {
  test('thaiNumbers writes Thai digits', () => {
    expectSequence('thaiNumbers', [
      [0, '๐'],
      [7, '๗'],
      [2019, '๒๐๑๙'],
    ]);
  });

  test('thaiLetters repeats one of 41 letters and starts again after 1230', () => {
    expectSequence('thaiLetters', [
      [0, ' '],
      [1, 'ก'],
      [41, 'ฮ'],
      [42, 'กก'],
      [100, 'ตตต'],
      [1230, 'ฮ'.repeat(30)],
      [1231, 'ก'],
    ]);
  });

  test('thaiCounting writes Thai words with สิบ, ยี่สิบ, and a final เอ็ด', () => {
    expectSequence('thaiCounting', [
      [0, 'ศูนย์'],
      [1, 'หนึ่ง'],
      [10, 'สิบ'],
      [11, 'สิบเอ็ด'],
      [21, 'ยี่สิบเอ็ด'],
      [101, 'หนึ่งร้อยเอ็ด'],
      [12345, 'หนึ่งหมื่นสองพันสามร้อยสี่สิบห้า'],
    ]);
  });
});

describe('Devanagari formats', () => {
  test('hindiVowels uses the consonant set and hindiConsonants the vowel set', () => {
    expectSequence('hindiVowels', [
      [0, ' '],
      [1, 'क'],
      [37, 'ह'],
      [38, 'कक'],
    ]);
    expectSequence('hindiConsonants', [
      [1, 'अ'],
      [17, 'अं'],
      [18, 'अः'],
      [19, 'अअ'],
      [36, 'अःअः'],
    ]);
  });

  test('hindiCounting writes Hindi words up to 9999 and starts again after it', () => {
    expectSequence('hindiCounting', [
      [0, 'शून्य'],
      [21, 'इक्कीस'],
      [101, 'एक सौ एक'],
      [2019, 'दो हजार उन्नीस'],
      [10000, 'एक'],
    ]);
  });
});

describe('Cyrillic and Vietnamese formats', () => {
  test('russianLower and russianUpper repeat one of 29 letters', () => {
    expectSequence('russianLower', [
      [0, ' '],
      [1, 'а'],
      [29, 'я'],
      [30, 'аа'],
    ]);
    expectSequence('russianUpper', [[11, 'Л']]);
  });

  test('vietnameseCounting writes Vietnamese words up to 1000', () => {
    // NFC on both sides: the tone marks are combining characters in the list text.
    const words = (value: number) => formatNumFmt('vietnameseCounting', value).normalize('NFC');
    expect(words(0)).toBe('không');
    expect(words(15)).toBe('mười lăm');
    expect(words(21)).toBe('hai mươi mốt');
    expect(words(105)).toBe('một trăm lẻ năm');
    expect(words(1000)).toBe('một ngàn');
    expect(words(1001)).toBe('một');
  });
});
