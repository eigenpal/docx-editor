// Seeded property test for dictionary word breaks (#1384).
//
// Random Thai and mixed-script paragraphs, split into random runs with random formatting and
// tracked insertions, laid out at random widths. Every case checks:
//
// 1. Lines concatenate back to the source text.
// 2. Every break is at a grapheme cluster boundary.
// 3. Every break is a dictionary word boundary or an ordinary legal break (space, dash, tab).
//    Any other break is an emergency chop, which is legal only inside a word wider than the
//    line.
// 4. The same text split into different runs, with equal widths, breaks at the same offsets.
// 5. The AutoFit minimum is at least the widest dictionary word and at most the minimum
//    without dictionary data, where the whole clause is one segment.
//
// A second oracle edits Thai paragraphs at random and compares incremental layout with a
// clean pass after every step.
//
// Determinism: fixed seeds and an inline mulberry32 PRNG. A failure names the seed and case.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { wordBoundaries } from '../cjk-line-break.ts';
import { dictionaryWordBreaks, setDictionaryWordSegmenter } from '../dictionary-word-breaks.ts';
import { segmentGraphemes } from '../grapheme.ts';
import { createLayoutSession, layoutSemanticDocument, type LayoutSession } from '../index.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { paragraphMinimumWidthPt } from '../table-autofit-widths.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per UTF-16 unit at 11pt. */
const UNIT = 6;
const measurer = createFixedMeasurer(UNIT, 14);

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THAI_WORDS = [
  'ฉัน',
  'อยาก',
  'กิน',
  'ข้าว',
  'วันนี้',
  'แม่น้ำ',
  'เจ้าพระยา',
  'โรงเรียน',
  'ภาษาไทย',
  'คอมพิวเตอร์',
  'สวัสดี',
  'ขอบคุณ',
  'ประเทศ',
  'น้ำ',
  'ที่',
  'และ',
  'ๆ',
  'กรุงเทพมหานคร',
];
const OTHER_WORDS = ['ພາສາລາວ', 'ភាសាខ្មែរ', 'မြန်မာ', 'ABC', 'word', '123', '๒๕๖๕', '2026'];
const SEPARATORS = [' ', ' ', '-', '  '];

function randomText(rand: () => number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const count = 2 + Math.floor(rand() * 14);
  let text = '';
  for (let i = 0; i < count; i++) {
    if (i > 0 && rand() < 0.12) text += pick(SEPARATORS);
    text += rand() < 0.8 ? pick(THAI_WORDS) : pick(OTHER_WORDS);
  }
  return text.trim() || 'ฉัน';
}

/**
 * Random seams. Anywhere, including inside a grapheme cluster (a tracked tone-mark edit), or,
 * when `clusterAligned`, only between clusters.
 */
function randomSplit(text: string, rand: () => number, clusterAligned = false): string[] {
  const seams = new Set<number>();
  const count = Math.floor(rand() * 5);
  const starts = segmentGraphemes(text).map((cluster) => cluster.utf16From);
  for (let i = 0; i < count; i++) {
    seams.add(
      clusterAligned
        ? starts[Math.floor(rand() * starts.length)]!
        : 1 + Math.floor(rand() * Math.max(1, text.length - 1))
    );
  }
  const sorted = Array.from(seams)
    .filter((at) => at > 0 && at < text.length)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  let from = 0;
  for (const at of sorted) {
    parts.push(text.slice(from, at));
    from = at;
  }
  parts.push(text.slice(from));
  return parts;
}

const FORMATS = ['', '<w:b/>', '<w:i/>', '<w:color w:val="C00000"/>', '<w:u w:val="single"/>'];

function runsXml(parts: readonly string[], rand: () => number): string {
  return parts
    .map((part, index) => {
      const props = FORMATS[Math.floor(rand() * FORMATS.length)]!;
      const r = `<w:r><w:rPr>${props}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${part}</w:t></w:r>`;
      return rand() < 0.2
        ? `<w:ins w:id="${index + 1}" w:author="A" w:date="2026-01-01T00:00:00Z">${r}</w:ins>`
        : r;
    })
    .join('');
}

function paragraph(body: string): OoxmlNode {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

function lineTexts(xml: string, width: number): string[] {
  return breakParagraph(
    paragraph(`<w:p>${xml}</w:p>`),
    'p',
    0,
    width,
    measurer,
    undefined,
    null
  ).map((line) => line.spans.map((span) => span.text).join(''));
}

function breakOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines.slice(0, -1)) {
    at += line.length;
    offsets.push(at);
  }
  return offsets;
}

const minimumOf = (xml: string): number =>
  paragraphMinimumWidthPt(paragraph(`<w:p>${xml}</w:p>`) as OoxmlElement, {
    context: { measurer },
    view: {
      styleCascade: undefined,
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });

/** Legal breaks without a chop: dictionary cuts, the space/dash/tab rules, and spaces. */
function legalBreaks(text: string): Set<number> {
  const legal = new Set<number>([...wordBoundaries(text, false), ...dictionaryWordBreaks(text)]);
  for (let i = 0; i < text.length; i++) if (/\s/u.test(text[i]!)) legal.add(i);
  return legal;
}

/** Width of the ink of the widest word between legal breaks. */
function widestWordPt(text: string, legal: ReadonlySet<number>): number {
  const sorted = Array.from(legal)
    .filter((at) => at > 0 && at < text.length)
    .sort((a, b) => a - b);
  sorted.push(text.length);
  let from = 0;
  let widest = 0;
  for (const to of sorted) {
    const ink = text.slice(from, to).replace(/\s+/gu, '');
    widest = Math.max(widest, ink.length * UNIT);
    from = to;
  }
  return widest;
}

const SEEDS = [0x1384, 0xc0ffee, 42, 20261016, 7, 99991, 314159, 271828];
const CASES = 80;

afterEach(() => setDictionaryWordSegmenter(undefined));

describe('dictionary word breaks hold their invariants on random input', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: ${CASES} random paragraphs`, () => {
      const rand = mulberry32(seed);
      let dictionaryBreaksSeen = 0;
      for (let index = 0; index < CASES; index++) {
        const text = randomText(rand);
        const width = UNIT * (3 + Math.floor(rand() * 18)) + (rand() < 0.3 ? 2.5 : 0);
        const where = `seed ${seed}, case ${index}, width ${width}, text ${JSON.stringify(text)}`;
        const split = randomSplit(text, rand);
        const runs = runsXml(split, rand);
        const lines = lineTexts(runs, width);
        // 1. Lossless.
        expect(lines.join(''), where).toBe(text);
        const offsets = breakOffsets(lines);
        const clusterStarts = new Set(segmentGraphemes(text).map((cluster) => cluster.utf16From));
        const legal = legalBreaks(text);
        const dictionary = new Set(dictionaryWordBreaks(text));
        const sortedLegal = Array.from(legal).sort((a, b) => a - b);
        for (const offset of offsets) {
          // 2. Grapheme safe.
          expect(clusterStarts.has(offset), `${where}: break ${offset} inside a cluster`).toBe(
            true
          );
          if (dictionary.has(offset)) dictionaryBreaksSeen += 1;
          if (legal.has(offset)) continue;
          // 3. A chop: the word around it must be wider than the line.
          const before = sortedLegal.filter((at) => at < offset).at(-1) ?? 0;
          const after = sortedLegal.find((at) => at > offset) ?? text.length;
          const word = text.slice(before, after).replace(/\s+/gu, '');
          expect(
            word.length * UNIT,
            `${where}: chop at ${offset} in a word that fits`
          ).toBeGreaterThan(width);
        }
        // 4. Run-split stability: seams between clusters, with any formatting, break where
        // one plain run does. (A seam inside a cluster keeps the cluster whole, but inside an
        // oversized word the chop then overflows by the cluster tail instead of moving it.)
        const plain = lineTexts(
          `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`,
          width
        );
        const alignedRuns = runsXml(randomSplit(text, rand, true), rand);
        expect(
          breakOffsets(lineTexts(alignedRuns, width)),
          `${where}: run split changed the breaks: ${alignedRuns}`
        ).toEqual(breakOffsets(plain));
        // 5. AutoFit minimum bounds.
        const xml = runs;
        const minimum = minimumOf(xml);
        expect(minimum + 1e-6, `${where}: minimum below the widest word`).toBeGreaterThanOrEqual(
          widestWordPt(text, legal)
        );
        setDictionaryWordSegmenter(null);
        const unbroken = minimumOf(xml);
        setDictionaryWordSegmenter(undefined);
        expect(minimum, `${where}: minimum above the unbreakable width`).toBeLessThanOrEqual(
          unbroken + 1e-6
        );
      }
      // Anti-vacuity: the generator must reach dictionary breaks.
      expect(dictionaryBreaksSeen).toBeGreaterThan(CASES / 2);
    });
  }
});

// ── Incremental layout oracle ─────────────────────────────────────────────────

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const PAGE =
  `<w:pgSz w:w="3000" w:h="2400"/>` +
  `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>`;

interface Para {
  parts: string[];
  bold: boolean[];
}

function renderDoc(paras: readonly Para[]): string {
  const body = paras
    .map(
      (para) =>
        `<w:p>${para.parts
          .map(
            (part, index) =>
              `<w:r><w:rPr>${para.bold[index] ? '<w:b/>' : ''}<w:sz w:val="22"/></w:rPr>` +
              `<w:t xml:space="preserve">${part}</w:t></w:r>`
          )
          .join('')}</w:p>`
    )
    .join('');
  return `${body}<w:sectPr>${PAGE}</w:sectPr>`;
}

function randomEdit(paras: Para[], rand: () => number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const para = pick(paras);
  const text = para.parts.join('');
  const clusters = segmentGraphemes(text).map((cluster) => cluster.utf16From);
  clusters.push(text.length);
  const at = pick(clusters);
  const kind = pick(['insert', 'delete', 'resplit', 'bold'] as const);
  let next = text;
  if (kind === 'insert') next = text.slice(0, at) + pick(THAI_WORDS) + text.slice(at);
  if (kind === 'delete') {
    const to = pick(clusters.filter((end) => end >= at));
    next = text.slice(0, at) + text.slice(to) || 'ฉัน';
  }
  if (kind === 'bold') {
    const index = Math.floor(rand() * para.bold.length);
    para.bold[index] = !para.bold[index];
    return `${kind} ${index}`;
  }
  para.parts = randomSplit(next, rand);
  para.bold = para.parts.map(() => rand() < 0.3);
  return `${kind} ${at}`;
}

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession) =>
  layoutSemanticDocument(part, revision, { measurer, ...(session ? { session } : {}) });

const EDIT_SEEDS = [0x1384, 11, 2026];
const STEPS = 20;

describe('incremental layout of Thai paragraphs equals a clean pass', () => {
  for (const seed of EDIT_SEEDS) {
    test(`seed ${seed}: ${STEPS} random edits`, () => {
      const rand = mulberry32(seed);
      const paras: Para[] = Array.from({ length: 8 }, () => {
        const parts = randomSplit(randomText(rand) + randomText(rand), rand);
        return { parts, bold: parts.map(() => rand() < 0.3) };
      });
      const session = createLayoutSession();
      expect(lay(load(renderDoc(paras)), 1, session).pages.length).toBeGreaterThan(1);
      const log: string[] = [];
      let partialSteps = 0;
      for (let step = 0; step < STEPS; step++) {
        log.push(randomEdit(paras, rand));
        const part = load(renderDoc(paras));
        const incremental = JSON.stringify(lay(part, step + 2, session).pages);
        if (session.stats.placed < session.stats.total) partialSteps += 1;
        const fresh = JSON.stringify(lay(part, step + 2).pages);
        if (incremental !== fresh) {
          throw new Error(`seed ${seed}, step ${step}: diverged after ${JSON.stringify(log)}`);
        }
      }
      // Anti-vacuity: some passes must place only part of the document.
      expect(partialSteps).toBeGreaterThan(0);
    });
  }
});
