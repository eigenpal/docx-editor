// Chinese, Korean, and enclosed-digit `w:numFmt` sequences (ST_NumberFormat, §17.18.59).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { formatNumFmt } from '../numbering-format.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createListCounterState } from '../list-counters.ts';
import { formatPageNumber } from '../field-page-furniture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function singleLevelList(numFmt: string, lvlText: string) {
  const result = readOoxmlPart(
    `<w:numbering xmlns:w="${W}">
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/>
          <w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    </w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return createListCounterState(buildNumberingIndex(result.part.root));
}

function markers(numFmt: string, lvlText: string, count: number): string[] {
  const state = singleLevelList(numFmt, lvlText);
  return Array.from({ length: count }, () => state.advance('1', 0)?.markerText ?? '');
}

function expectSequence(numFmt: string, cases: readonly (readonly [number, string])[]) {
  for (const [value, text] of cases)
    expect([value, formatNumFmt(numFmt, value)]).toEqual([value, text]);
}

describe('list markers in East Asian formats', () => {
  test('a Chinese thesis heading list numbers its chapters 第一章 … 第十二章', () => {
    expect(markers('chineseCountingThousand', '第%1章', 12)).toEqual([
      '第一章',
      '第二章',
      '第三章',
      '第四章',
      '第五章',
      '第六章',
      '第七章',
      '第八章',
      '第九章',
      '第十章',
      '第十一章',
      '第十二章',
    ]);
  });

  test('a Korean list numbers its items 가. 나. 다.', () => {
    expect(markers('ganada', '%1.', 3)).toEqual(['가.', '나.', '다.']);
  });

  test('a section page number in a Chinese format', () => {
    expect(formatPageNumber(4, 'chineseCountingThousand')).toBe('四');
    expect(formatPageNumber(12, 'koreanCounting')).toBe('십이');
  });
});

describe('Chinese counting formats', () => {
  test('`chineseCounting` writes 十 for the tens below 100 and digits from 100', () => {
    expectSequence('chineseCounting', [
      [0, '○'],
      [1, '一'],
      [9, '九'],
      [10, '十'],
      [11, '十一'],
      [19, '十九'],
      [20, '二十'],
      [21, '二十一'],
      [99, '九十九'],
      [100, '一○○'],
      [101, '一○一'],
      [110, '一一○'],
      [1005, '一○○五'],
    ]);
  });

  test('`taiwaneseCounting` follows the same rules', () => {
    expectSequence('taiwaneseCounting', [
      [10, '十'],
      [21, '二十一'],
      [100, '一○○'],
    ]);
  });

  test('`chineseCountingThousand` writes place values, one 〇 per gap', () => {
    expectSequence('chineseCountingThousand', [
      [0, '〇'],
      [1, '一'],
      [10, '十'],
      [11, '十一'],
      [19, '十九'],
      [20, '二十'],
      [21, '二十一'],
      [99, '九十九'],
      [100, '一百'],
      [101, '一百〇一'],
      [110, '一百一十'],
      [111, '一百一十一'],
      [999, '九百九十九'],
      [1000, '一千'],
      [1005, '一千〇五'],
      [1010, '一千〇一十'],
      [1050, '一千〇五十'],
      [1100, '一千一百'],
      [10000, '一万'],
      [10005, '一万〇五'],
      [10010, '一万〇一十'],
      [12345, '一万二千三百四十五'],
      [100000, '一十万'],
      [100001, '一十万〇一'],
    ]);
  });

  test('`taiwaneseCountingThousand` writes 萬 and 零', () => {
    expectSequence('taiwaneseCountingThousand', [
      [0, '零'],
      [10, '十'],
      [101, '一百零一'],
      [10000, '一萬'],
    ]);
  });

  test('`chineseLegalSimplified` and `ideographLegalTraditional` keep the leading one', () => {
    expectSequence('chineseLegalSimplified', [
      [1, '壹'],
      [6, '陆'],
      [10, '壹拾'],
      [11, '壹拾壹'],
      [20, '贰拾'],
      [101, '壹佰零壹'],
      [1005, '壹仟零伍'],
      [10000, '壹萬'],
      [10001, '壹萬零壹'],
    ]);
    expectSequence('ideographLegalTraditional', [
      [2, '貳'],
      [10, '壹拾'],
      [12, '壹拾貳'],
      [101, '壹佰零壹'],
      [10000, '壹萬'],
    ]);
  });

  test('`japaneseCounting` drops the one before 十, 百, and 千 and writes no zero', () => {
    expectSequence('japaneseCounting', [
      [1, '一'],
      [10, '十'],
      [11, '十一'],
      [20, '二十'],
      [100, '百'],
      [101, '百一'],
      [110, '百十'],
      [1000, '千'],
      [1005, '千五'],
      [10000, '一万'],
      [10100, '一万百'],
      [11000, '一万一千'],
      [12345, '一万二千三百四十五'],
    ]);
  });

  test('`taiwaneseDigital` writes each digit', () => {
    expectSequence('taiwaneseDigital', [
      [1, '一'],
      [10, '一○'],
      [100, '一○○'],
      [12, '一二'],
    ]);
  });

  test('the sexagenary and zodiac cycles fall back to decimal past their set', () => {
    expectSequence('ideographTraditional', [
      [1, '甲'],
      [2, '乙'],
      [10, '癸'],
      [11, '11'],
    ]);
    expectSequence('ideographZodiac', [
      [1, '子'],
      [10, '酉'],
      [11, '戍'],
      [12, '亥'],
      [13, '13'],
    ]);
  });
});

describe('Korean formats', () => {
  test('`koreanCounting` drops the leading 일 before every place value', () => {
    expectSequence('koreanCounting', [
      [0, '영'],
      [1, '일'],
      [10, '십'],
      [11, '십일'],
      [20, '이십'],
      [99, '구십구'],
      [100, '백'],
      [101, '백일'],
      [1000, '천'],
      [10000, '만'],
      [10100, '만백'],
      [11000, '만일천'],
      [12345, '만이천삼백사십오'],
      [110000, '십일만'],
    ]);
  });

  test('`koreanDigital` and `koreanDigital2` write each digit', () => {
    expectSequence('koreanDigital', [
      [1, '일'],
      [10, '일영'],
      [11, '일일'],
      [100, '일영영'],
      [12345, '일이삼사오'],
    ]);
    expectSequence('koreanDigital2', [
      [0, '\uf9b2'],
      [1, '一'],
      [10, '一零'],
      [100, '一零零'],
    ]);
  });

  test('`koreanLegal` counts in native Korean words to 99', () => {
    expectSequence('koreanLegal', [
      [0, '0'],
      [1, '하나'],
      [2, '둘'],
      [5, '다섯'],
      [9, '아홉'],
      [10, '열'],
      [11, '열하나'],
      [20, '스물'],
      [21, '스물하나'],
      [55, '쉰다섯'],
      [99, '아흔아홉'],
      [100, '백'],
      [101, '백일'],
    ]);
  });

  test('`ganada` and `chosung` start again from the first letter after 14', () => {
    expectSequence('ganada', [
      [0, '0'],
      [1, '가'],
      [2, '나'],
      [14, '하'],
      [15, '가'],
      [28, '하'],
      [29, '가'],
      [999_999, '사'],
    ]);
    expectSequence('chosung', [
      [1, 'ㄱ'],
      [14, 'ㅎ'],
      [15, 'ㄱ'],
      [393, 'ㄱ'],
    ]);
  });
});

describe('Japanese and sexagenary formats', () => {
  test('Japanese legal and digit formats', () => {
    expectSequence('japaneseLegal', [
      [0, '〇'],
      [1, '壱'],
      [10, '壱拾'],
      [101, '壱百壱'],
      [12345, '壱萬弐阡参百四拾伍'],
      [100000, '壱拾萬'],
    ]);
    expectSequence('ideographDigital', [
      [0, '〇'],
      [10, '一〇'],
      [123456, '一二三四五六'],
    ]);
    expectSequence('japaneseDigitalTenThousand', [
      [9999, '九九九九'],
      [10000, ''],
    ]);
  });

  test('kana formats cycle one letter', () => {
    expectSequence('aiueo', [
      [0, '0'],
      [1, 'ｱ'],
      [46, 'ﾝ'],
      [47, 'ｱ'],
    ]);
    expectSequence('aiueoFullWidth', [
      [44, 'ワ'],
      [45, 'ヲ'],
    ]);
    expectSequence('iroha', [
      [25, 'ヰ'],
      [48, 'ﾝ'],
      [49, 'ｲ'],
    ]);
    expectSequence('irohaFullWidth', [[3, 'ハ']]);
  });

  test('ideographZodiacTraditional counts the 60-year cycle', () => {
    expectSequence('ideographZodiacTraditional', [
      [0, '0'],
      [1, '甲子'],
      [11, '甲戍'],
      [60, '癸亥'],
      [61, '甲子'],
    ]);
  });
});

describe('enclosed and full-width digits', () => {
  test('enclosed digits cover 1–20, the Chinese variant 1–10, then decimal', () => {
    expectSequence('decimalEnclosedCircle', [
      [1, '①'],
      [20, '⑳'],
      [21, '21'],
    ]);
    expectSequence('decimalEnclosedCircleChinese', [
      [1, '①'],
      [10, '⑩'],
      [11, '11'],
    ]);
    expectSequence('decimalEnclosedFullstop', [
      [1, '⒈'],
      [20, '⒛'],
      [21, '21'],
    ]);
    expectSequence('decimalEnclosedParen', [
      [1, '⑴'],
      [20, '⒇'],
      [21, '21'],
    ]);
  });

  test('enclosed ideographs cover 1–10', () => {
    expectSequence('ideographEnclosedCircle', [
      [1, '㈠'],
      [10, '㈩'],
      [11, '11'],
    ]);
  });

  test('full-width and half-width digits', () => {
    expectSequence('decimalFullWidth', [
      [1, '１'],
      [10, '１０'],
      [123, '１２３'],
    ]);
    expectSequence('decimalFullWidth2', [[45, '４５']]);
    expectSequence('decimalHalfWidth', [[45, '45']]);
  });
});
