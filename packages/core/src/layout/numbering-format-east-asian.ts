// Chinese, Korean, and enclosed-digit `w:numFmt` sequences (§17.18.59).
//
// Callers pass a value already clamped by `clampListValue` (0…999 999), so every string here
// is short. The glyph sets are the standard's; where its algorithm text and its own examples
// disagree, the examples and the format strings in [MS-DOCX] 2.4 win (`十`, not `一十`, for 10).

/** Place values written after a digit: ten, hundred, thousand. */
type PlaceUnits = readonly [string, string, string];

interface PlaceValueNumerals {
  /** Glyphs for 0–9. */
  readonly digits: string;
  readonly units: PlaceUnits;
  /** The ten-thousand glyph. */
  readonly myriad: string;
  /** Written once for each run of zero places between written digits; null writes nothing. */
  readonly gap: string | null;
  /**
   * When a 1 before a place value is left out: `teens` only in 10–19 (`十一`), `always` in
   * every group (`百一`), `never` (`壹拾`).
   */
  readonly bareOne: 'teens' | 'always' | 'never';
  /** Whether the 1 before the ten-thousand glyph is left out (`만`, not `일만`). */
  readonly bareMyriad: boolean;
}

const CHINESE_COUNTING_THOUSAND: PlaceValueNumerals = {
  digits: '零一二三四五六七八九',
  units: ['十', '百', '千'],
  myriad: '万',
  gap: '零',
  bareOne: 'teens',
  bareMyriad: false,
};

const TAIWANESE_COUNTING_THOUSAND: PlaceValueNumerals = {
  ...CHINESE_COUNTING_THOUSAND,
  myriad: '萬',
};

const CHINESE_LEGAL_SIMPLIFIED: PlaceValueNumerals = {
  digits: '零壹贰叁肆伍陆柒捌玖',
  units: ['拾', '佰', '仟'],
  myriad: '万',
  gap: '零',
  bareOne: 'never',
  bareMyriad: false,
};

const IDEOGRAPH_LEGAL_TRADITIONAL: PlaceValueNumerals = {
  digits: '零壹貳參肆伍陸柒捌玖',
  units: ['拾', '佰', '仟'],
  myriad: '萬',
  gap: '零',
  bareOne: 'never',
  bareMyriad: false,
};

const JAPANESE_COUNTING: PlaceValueNumerals = {
  digits: '〇一二三四五六七八九',
  units: ['十', '百', '千'],
  myriad: '万',
  gap: null,
  bareOne: 'always',
  bareMyriad: false,
};

const KOREAN_COUNTING: PlaceValueNumerals = {
  digits: '영일이삼사오육칠팔구',
  units: ['십', '백', '천'],
  myriad: '만',
  gap: null,
  bareOne: 'always',
  bareMyriad: true,
};

/** One group below ten thousand (1…9999), most significant place first. */
function placeValueGroup(group: number, numerals: PlaceValueNumerals, teens: boolean): string {
  const bareOne = numerals.bareOne === 'always' || (numerals.bareOne === 'teens' && teens);
  let out = '';
  let gap = false;
  for (const [place, unit] of [
    [1000, numerals.units[2]],
    [100, numerals.units[1]],
    [10, numerals.units[0]],
    [1, ''],
  ] as const) {
    const digit = Math.floor(group / place) % 10;
    if (digit === 0) {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap && numerals.gap !== null) out += numerals.gap;
    gap = false;
    out += (digit === 1 && unit !== '' && bareOne ? '' : numerals.digits[digit]!) + unit;
  }
  return out;
}

function placeValue(value: number, numerals: PlaceValueNumerals): string {
  if (value === 0) return numerals.digits[0]!;
  const high = Math.floor(value / 10000);
  const low = value % 10000;
  if (high === 0) return placeValueGroup(low, numerals, value >= 10 && value <= 19);
  const head = high === 1 && numerals.bareMyriad ? '' : placeValueGroup(high, numerals, false);
  let out = head + numerals.myriad;
  if (low === 0) return out;
  if (low < 1000 && numerals.gap !== null) out += numerals.gap;
  return out + placeValueGroup(low, numerals, false);
}

/** Each decimal digit replaced by its glyph in `digits` (0–9). */
function digitByDigit(value: number, digits: string): string {
  return String(value).replace(/[0-9]/g, (digit) => digits[Number(digit)]!);
}

/** `chineseCounting` / `taiwaneseCounting`: 十 forms below 100, then one glyph per digit. */
function chineseCounting(value: number): string {
  const digits = '○一二三四五六七八九';
  if (value < 10) return digits[value]!;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return (tens === 1 ? '' : digits[tens]!) + '十' + (ones === 0 ? '' : digits[ones]!);
  }
  return digitByDigit(value, digits);
}

const KOREAN_NATIVE_ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
const KOREAN_NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

/**
 * `koreanLegal`: native Korean words for 1–99. The standard defines nothing past 99; larger
 * values use `koreanCounting`.
 */
function koreanLegal(value: number): string {
  if (value < 1 || value > 99) return placeValue(value, KOREAN_COUNTING);
  return KOREAN_NATIVE_TENS[Math.floor(value / 10)]! + KOREAN_NATIVE_ONES[value % 10]!;
}

/**
 * `ganada` / `chosung`: a 14-letter set, the letter written once more on each pass through
 * it (`가`, …, `하`, `가가`). The copy count is capped so a hostile counter stays short.
 */
function repeatedLetter(value: number, letters: string, maxLength: number): string {
  if (value < 1) return String(value);
  const copies = Math.min(Math.floor((value - 1) / letters.length) + 1, maxLength);
  return letters[(value - 1) % letters.length]!.repeat(copies);
}

/** A glyph for each value 1…`glyphs.length`, decimal beyond. */
function fromSet(value: number, glyphs: string): string {
  const set = [...glyphs];
  return value >= 1 && value <= set.length ? set[value - 1]! : String(value);
}

const ENCLOSED_CIRCLE = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/**
 * Format `value` (already clamped) in an East Asian or enclosed-digit format, or return null
 * when `numFmt` is not one of them.
 */
export function formatEastAsianNumFmt(
  numFmt: string,
  value: number,
  maxLength: number
): string | null {
  switch (numFmt) {
    case 'chineseCounting':
    case 'taiwaneseCounting':
      return chineseCounting(value);
    case 'chineseCountingThousand':
      return placeValue(value, CHINESE_COUNTING_THOUSAND);
    case 'taiwaneseCountingThousand':
      return placeValue(value, TAIWANESE_COUNTING_THOUSAND);
    case 'chineseLegalSimplified':
      return placeValue(value, CHINESE_LEGAL_SIMPLIFIED);
    case 'ideographLegalTraditional':
      return placeValue(value, IDEOGRAPH_LEGAL_TRADITIONAL);
    case 'japaneseCounting':
      return placeValue(value, JAPANESE_COUNTING);
    case 'taiwaneseDigital':
      return digitByDigit(value, '○一二三四五六七八九');
    case 'ideographTraditional':
      return fromSet(value, '甲乙丙丁戊己庚辛壬癸');
    case 'ideographZodiac':
      return fromSet(value, '子丑寅卯辰巳午未申酉戌亥');
    case 'ideographEnclosedCircle':
      return fromSet(value, '㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩');
    case 'koreanCounting':
      return placeValue(value, KOREAN_COUNTING);
    case 'koreanDigital':
      return digitByDigit(value, '영일이삼사오육칠팔구');
    case 'koreanDigital2':
      return digitByDigit(value, '零一二三四五六七八九');
    case 'koreanLegal':
      return koreanLegal(value);
    case 'ganada':
      return repeatedLetter(value, '가나다라마바사아자차카타파하', maxLength);
    case 'chosung':
      return repeatedLetter(value, 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ', maxLength);
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese':
      return fromSet(value, ENCLOSED_CIRCLE);
    case 'decimalEnclosedFullstop':
      return fromSet(value, '⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛');
    case 'decimalEnclosedParen':
      return fromSet(value, '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇');
    case 'decimalFullWidth':
    case 'decimalFullWidth2':
      return digitByDigit(value, '０１２３４５６７８９');
    case 'decimalHalfWidth':
      return String(value);
    default:
      return null;
  }
}
