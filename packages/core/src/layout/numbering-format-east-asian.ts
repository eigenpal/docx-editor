// Chinese, Japanese, Korean, and enclosed-digit `w:numFmt` values (`ST_NumberFormat`,
// ECMA-376 Part 1, 17.18.59).
//
// Callers pass a value already clamped by `clampListValue` (0…999 999), so every string here
// is short. The glyph sets are the standard's, except where DOCX applications render other
// glyphs. The comments below name each exception: the `〇` gap in `chineseCountingThousand`,
// `萬` in `chineseLegalSimplified`, `戍` for zodiac 11, and the 14-letter cycle in `ganada`.

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

// The standard lists `零` (U+96F6) for zero; DOCX applications render `〇` (U+3007) for zero and
// each gap (`一百〇一`). The Taiwanese format keeps `零`.
const CHINESE_COUNTING_THOUSAND: PlaceValueNumerals = {
  digits: '〇一二三四五六七八九',
  units: ['十', '百', '千'],
  myriad: '万',
  gap: '〇',
  bareOne: 'teens',
  bareMyriad: false,
};

const TAIWANESE_COUNTING_THOUSAND: PlaceValueNumerals = {
  ...CHINESE_COUNTING_THOUSAND,
  digits: '零一二三四五六七八九',
  myriad: '萬',
  gap: '零',
};

// The ten-thousand glyph is the traditional `萬`, not the standard's `万`.
const CHINESE_LEGAL_SIMPLIFIED: PlaceValueNumerals = {
  digits: '零壹贰叁肆伍陆柒捌玖',
  units: ['拾', '佰', '仟'],
  myriad: '萬',
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

// `四`, `六`, `七`, `八`, and `九` have no legal form; `阡` is the legal thousand.
const JAPANESE_LEGAL: PlaceValueNumerals = {
  digits: '〇壱弐参四伍六七八九',
  units: ['拾', '百', '阡'],
  myriad: '萬',
  gap: null,
  bareOne: 'never',
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

/**
 * One group below ten thousand (1…9999), most significant place first. `afterMyriad` marks the
 * group after a ten-thousand glyph, where a 1 before the thousand glyph is always written
 * (`一万一千`, `만일천`), so the 1 is not read as part of the myriad count.
 */
function placeValueGroup(
  group: number,
  numerals: PlaceValueNumerals,
  teens: boolean,
  afterMyriad = false
): string {
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
    const bare = bareOne && !(afterMyriad && place === 1000);
    out += (digit === 1 && unit !== '' && bare ? '' : numerals.digits[digit]!) + unit;
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
  return out + placeValueGroup(low, numerals, false, true);
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
 * values use `koreanCounting`, and zero stays a decimal `0`.
 */
function koreanLegal(value: number): string {
  if (value < 1) return String(value);
  if (value > 99) return placeValue(value, KOREAN_COUNTING);
  return KOREAN_NATIVE_TENS[Math.floor(value / 10)]! + KOREAN_NATIVE_ONES[value % 10]!;
}

/**
 * `ganada`, `chosung`, and the kana formats: a letter set that starts again after the last
 * letter (`하`, then `가`). The standard repeats the letter instead (`가가` for 15); DOCX
 * applications render one letter.
 */
function cycledLetter(value: number, letters: string): string {
  if (value < 1) return String(value);
  const set = [...letters];
  return set[(value - 1) % set.length]!;
}

// The 46 kana in a-i-u-e-o order. Both sets leave out `ヰ` and `ヱ`, which have no half-width
// form.
const AIUEO_HALF_WIDTH = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ';
const AIUEO_FULL_WIDTH =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
// The 48 kana in iroha order. The half-width set keeps the full-width `ヰ` and `ヱ`.
const IROHA_HALF_WIDTH = 'ｲﾛﾊﾆﾎﾍﾄﾁﾘﾇﾙｦﾜｶﾖﾀﾚｿﾂﾈﾅﾗﾑｳヰﾉｵｸﾔﾏｹﾌｺｴﾃｱｻｷﾕﾒﾐｼヱﾋﾓｾｽﾝ';
const IROHA_FULL_WIDTH =
  'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン';

const HEAVENLY_STEMS = '甲乙丙丁戊己庚辛壬癸';
// The eleventh branch is `戍` (U+620D), as in `ideographZodiac`.
const EARTHLY_BRANCHES = '子丑寅卯辰巳午未申酉戍亥';

/**
 * `ideographZodiacTraditional`: the 60-year cycle, a stem and a branch for each value
 * (`甲子`, `乙丑`, … `癸亥`), starting again after 60.
 */
function sexagenary(value: number): string {
  if (value < 1) return String(value);
  const n = value - 1;
  return HEAVENLY_STEMS[n % 10]! + EARTHLY_BRANCHES[n % 12]!;
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
export function formatEastAsianNumFmt(numFmt: string, value: number): string | null {
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
    case 'japaneseLegal':
      return placeValue(value, JAPANESE_LEGAL);
    case 'ideographDigital':
      return digitByDigit(value, '〇一二三四五六七八九');
    case 'japaneseDigitalTenThousand':
      // DOCX applications write nothing from 10 000 up.
      return value < 10000 ? digitByDigit(value, '〇一二三四五六七八九') : '';
    case 'ideographZodiacTraditional':
      return sexagenary(value);
    case 'aiueo':
      return cycledLetter(value, AIUEO_HALF_WIDTH);
    case 'aiueoFullWidth':
      return cycledLetter(value, AIUEO_FULL_WIDTH);
    case 'iroha':
      return cycledLetter(value, IROHA_HALF_WIDTH);
    case 'irohaFullWidth':
      return cycledLetter(value, IROHA_FULL_WIDTH);
    case 'ideographTraditional':
      return fromSet(value, '甲乙丙丁戊己庚辛壬癸');
    case 'ideographZodiac':
      // 11 is `戍` (U+620D). The standard lists `戌` (U+620C); DOCX applications render `戍`.
      return fromSet(value, '子丑寅卯辰巳午未申酉戍亥');
    case 'ideographEnclosedCircle':
      return fromSet(value, '㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩');
    case 'koreanCounting':
      return placeValue(value, KOREAN_COUNTING);
    case 'koreanDigital':
      return digitByDigit(value, '영일이삼사오육칠팔구');
    case 'koreanDigital2':
      // Zero alone is the compatibility ideograph U+F9B2; a zero digit inside a number is
      // U+96F6. The two look the same, but text search and comparison tell them apart.
      return value === 0 ? '\uf9b2' : digitByDigit(value, '零一二三四五六七八九');
    case 'koreanLegal':
      return koreanLegal(value);
    case 'ganada':
      return cycledLetter(value, '가나다라마바사아자차카타파하');
    case 'chosung':
      return cycledLetter(value, 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ');
    case 'decimalEnclosedCircle':
      return fromSet(value, ENCLOSED_CIRCLE);
    case 'decimalEnclosedCircleChinese':
      // The standard calls it identical to `decimalEnclosedCircle`. DOCX applications circle
      // only 1–10.
      return fromSet(value, ENCLOSED_CIRCLE.slice(0, 10));
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
