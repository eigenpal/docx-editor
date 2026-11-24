// Thai, Devanagari, Cyrillic, and Vietnamese `w:numFmt` values (`ST_NumberFormat`, ECMA-376
// Part 1, 17.18.59).
//
// Callers pass a value already clamped by `clampListValue` (0…999 999), so every string here
// is short. The standard names the letter sets and counting words. Where DOCX applications
// render other text, the comment at that format says so.

/**
 * Values past this start again from 1 in the roman and Thai digit formats. DOCX applications
 * render list numbers in these formats up to 32767.
 */
export const SHORT_LIST_PERIOD = 32767;

/** `value` in 1…`period`, starting again from 1 past it; 0 stays 0. */
export function wrapListValue(value: number, period: number): number {
  return value < 1 ? 0 : ((value - 1) % period) + 1;
}

/** Zero has no letter form; DOCX applications render a space. */
const NO_LETTER = ' ';

/**
 * One letter, repeated once for each pass through the set (`ก`, … `ฮ`, `กก`). Values past
 * `period` start again from 1, so a letter repeats at most `period / letters.length` times.
 */
function repeatedLetter(value: number, letters: readonly string[], period: number): string {
  const n = wrapListValue(value, period);
  if (n === 0) return NO_LETTER;
  return letters[(n - 1) % letters.length]!.repeat(Math.floor((n - 1) / letters.length) + 1);
}

// The 41 consonants the standard lists: ฃ and ฅ are left out.
const THAI_LETTERS = [...'กขคงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ'];
// The 29 letters the standard lists: ё, й, ъ, and ь are left out.
const RUSSIAN_LOWER = [...'абвгдежзиклмнопрстуфхцчшщыэюя'];
const RUSSIAN_UPPER = [...'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЫЭЮЯ'];
const DEVANAGARI_CONSONANTS = [...'कखगघङचछजझञटठडढणतथदधनऩपफबभमयरऱलळऴवशषसह'];
// `अं` and `अः` are two code points each, so the set is a list, not a string.
const DEVANAGARI_VOWELS = [...[...'अआइईउऊऋऌऍऎएऐऑऒओऔ'], 'अं', 'अः'];

/** A letter repeats at most 30 times in the Thai and Russian sets. */
const LETTER_REPEATS = 30;
/** The Devanagari letter sets start again after 304, whatever the set's length. */
const DEVANAGARI_PERIOD = 304;

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const THAI_WORDS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
/** Place names after the ones: ten, hundred, thousand, ten thousand, hundred thousand. */
const THAI_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/**
 * `thaiCounting`: Thai number words. Ten is `สิบ` with no `หนึ่ง`, twenty is `ยี่สิบ`, and a
 * final one after a higher place is `เอ็ด` (`สิบเอ็ด`, `หนึ่งร้อยเอ็ด`).
 */
function thaiCounting(value: number): string {
  if (value === 0) return THAI_WORDS[0]!;
  const digits = [...String(value)].map(Number);
  let out = '';
  digits.forEach((digit, index) => {
    const place = digits.length - 1 - index;
    if (digit === 0) return;
    if (place === 0) out += digit === 1 && value > 1 ? 'เอ็ด' : THAI_WORDS[digit]!;
    else if (place === 1)
      out += (digit === 1 ? '' : digit === 2 ? 'ยี่' : THAI_WORDS[digit]!) + 'สิบ';
    else out += THAI_WORDS[digit]! + THAI_PLACES[place]!;
  });
  return out;
}

// Each of 0–99 has its own word in Hindi; the words do not compose from tens and ones. `ड़` is
// the single code point U+095C, as DOCX applications write it.
const HINDI_WORDS = (
  'शून्य एक दो तीन चार पाँच छः सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह ' +
  'सत्रह अठ्ठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अठ्ठाईस ' +
  'उन्तीस तीस इक्तीस बत्तीस तैंतीस चौंतीस पैंतीस छतीस सैंतीस अड़तीस उन्तालीस ' +
  'चालीस इक्तालीस बयालीस तैतालीस चवालीस पैंतालीस छियालीस सत्तालीस अड़तालीस उन्चास ' +
  'पचास इकावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अठ्ठावन उनसठ साठ इकसठ बासठ ' +
  'तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर एकहत्तर बहत्तर तिहत्तर ' +
  'चौहत्तर पछत्तर छिहत्तर सतहत्तर अठहत्तर उन्नासी अस्सी इक्यासी बयासी तिरासी ' +
  'चौरासी पचासी छियासी सत्तासी अठ्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे ' +
  'चौरानवे पछानवे छ्यानवे सत्तानवे अठ्ठानवे निन्यानवे'
).split(' ');

/**
 * `hindiCounting`: Hindi number words, `हजार` for thousands and `सौ` for hundreds. DOCX
 * applications write values up to 9999 and start again from 1 after it.
 */
function hindiCounting(value: number): string {
  if (value === 0) return HINDI_WORDS[0]!;
  const n = wrapListValue(value, 9999);
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor(n / 100) % 10;
  const rest = n % 100;
  if (thousands > 0) parts.push(`${HINDI_WORDS[thousands]!} हजार`);
  if (hundreds > 0) parts.push(`${HINDI_WORDS[hundreds]!} सौ`);
  if (rest > 0) parts.push(HINDI_WORDS[rest]!);
  return parts.join(' ');
}

// DOCX applications write the tone marks as combining characters (`ộ` is `ô` and U+0323), so
// these strings are not in NFC.
const VIETNAMESE_WORDS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Vietnamese words for 1–99. */
function vietnameseBelowHundred(n: number): string {
  if (n < 10) return VIETNAMESE_WORDS[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const head = tens === 1 ? 'mười' : `${VIETNAMESE_WORDS[tens]!} mươi`;
  if (ones === 0) return head;
  // A final five is `lăm` after a ten; a final one is `mốt` after twenty and up.
  const tail = ones === 5 ? 'lăm' : ones === 1 && tens > 1 ? 'mốt' : VIETNAMESE_WORDS[ones]!;
  return `${head} ${tail}`;
}

/**
 * `vietnameseCounting`: Vietnamese number words, with `lẻ` before a single digit after a
 * hundred (`một trăm lẻ một`). DOCX applications write values up to 1000 (`một ngàn`) and
 * start again from 1 after it.
 */
function vietnameseCounting(value: number): string {
  if (value === 0) return VIETNAMESE_WORDS[0]!;
  const n = wrapListValue(value, 1000);
  if (n === 1000) return 'một ngàn';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return vietnameseBelowHundred(rest);
  const head = `${VIETNAMESE_WORDS[hundreds]!} trăm`;
  if (rest === 0) return head;
  return `${head} ${rest < 10 ? 'lẻ ' : ''}${vietnameseBelowHundred(rest)}`;
}

/**
 * Format `value` (already clamped) in a Thai, Devanagari, Cyrillic, or Vietnamese format, or
 * return null when `numFmt` is not one of them.
 */
export function formatAlphabetNumFmt(numFmt: string, value: number): string | null {
  switch (numFmt) {
    case 'thaiNumbers':
      return String(wrapListValue(value, SHORT_LIST_PERIOD)).replace(
        /[0-9]/g,
        (digit) => THAI_DIGITS[Number(digit)]!
      );
    case 'thaiLetters':
      return repeatedLetter(value, THAI_LETTERS, THAI_LETTERS.length * LETTER_REPEATS);
    case 'thaiCounting':
      return thaiCounting(value);
    case 'russianLower':
      return repeatedLetter(value, RUSSIAN_LOWER, RUSSIAN_LOWER.length * LETTER_REPEATS);
    case 'russianUpper':
      return repeatedLetter(value, RUSSIAN_UPPER, RUSSIAN_UPPER.length * LETTER_REPEATS);
    // The names cross the sets in the standard itself: `hindiVowels` is U+0915–U+0939, the
    // consonants, and `hindiConsonants` is U+0905–U+0914 with `अं` and `अः`, the vowels.
    case 'hindiVowels':
      return repeatedLetter(value, DEVANAGARI_CONSONANTS, DEVANAGARI_PERIOD);
    case 'hindiConsonants':
      return repeatedLetter(value, DEVANAGARI_VOWELS, DEVANAGARI_PERIOD);
    case 'hindiCounting':
      return hindiCounting(value);
    case 'vietnameseCounting':
      return vietnameseCounting(value);
    default:
      return null;
  }
}
