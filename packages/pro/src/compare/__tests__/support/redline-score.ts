/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Scores one redline normal form against a reference normal form.
 *
 * `changedF1` is the main number: tokens that carry a revision mark, weighted by length,
 * matched in order (same text, same mark). Unchanged text does not inflate it.
 */
import type {
  NormalParagraph,
  NormalStory,
  RedlineNormalForm,
  SegmentMark,
} from './redline-normal-form.ts';

export interface RedlineScore {
  /** F1 over revision-marked tokens (1 when neither side has any). */
  readonly changedF1: number;
  readonly precision: number;
  readonly recall: number;
  /** F1 over all tokens with marks (eq included). */
  readonly overallF1: number;
  /** Paragraph-mark revisions, in order, agree per story. */
  readonly paragraphMarksEqual: boolean;
  /** Table-row revisions agree per story. */
  readonly rowMarksEqual: boolean;
  /** Section, table, row, and cell property-change counts agree. */
  readonly propertyChangesEqual: boolean;
  /** Paragraphs with `w:pPrChange`, in order, agree. */
  readonly paragraphPropertiesEqual: boolean;
  /** Runs with `w:rPrChange`, by text, agree. */
  readonly formatChangesEqual: boolean;
}

interface Token {
  readonly key: string;
  readonly weight: number;
  readonly changed: boolean;
}

const TOKEN = /\s+|[\p{L}\p{M}\p{N}_]+|./gsu;

function tokensOf(stories: readonly NormalStory[]): Token[] {
  const out: Token[] = [];
  for (const story of stories) {
    out.push({ key: `<${story.kind}>`, weight: 0, changed: false });
    for (const paragraph of story.paragraphs) pushParagraph(paragraph, out);
  }
  return out;
}

function pushParagraph(paragraph: NormalParagraph, out: Token[]): void {
  for (const segment of paragraph.segments) {
    for (const match of segment.text.matchAll(TOKEN)) {
      out.push(token(match[0], segment.mark));
    }
  }
  out.push(token('¶', paragraph.mark ?? 'eq'));
}

const token = (text: string, mark: SegmentMark): Token => ({
  key: `${mark}:${text}`,
  weight: text.length,
  changed: mark !== 'eq',
});

const MAX_D = 4_000;

/** Weighted LCS of keys. Myers O((N+M)D); bag overlap when the edit distance is huge. */
function matchedWeight(a: readonly Token[], b: readonly Token[], onlyChanged: boolean): number {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    // Snapshot only the live diagonals (-d..d), so memory is O(D^2) rather than O(N*D).
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x]!.key === b[y]!.key) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return bagOverlap(a, b, onlyChanged);
  // Walk the trace back, summing the weights of diagonal (matched) moves.
  let x = n;
  let y = m;
  let total = 0;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const at = (diagonal: number) => prev[diagonal + d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      if (!onlyChanged || a[x]!.changed) total += a[x]!.weight;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    if (!onlyChanged || a[x]!.changed) total += a[x]!.weight;
  }
  return total;
}

function bagOverlap(a: readonly Token[], b: readonly Token[], onlyChanged: boolean): number {
  const counts = new Map<string, number>();
  for (const item of b) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
  let total = 0;
  for (const item of a) {
    const left = counts.get(item.key) ?? 0;
    if (left === 0) continue;
    counts.set(item.key, left - 1);
    if (!onlyChanged || item.changed) total += item.weight;
  }
  return total;
}

const f1 = (matched: number, ours: number, reference: number) =>
  ours + reference === 0 ? 1 : (2 * matched) / (ours + reference);

const sum = (tokens: readonly Token[], onlyChanged: boolean) =>
  tokens.reduce((total, item) => total + (!onlyChanged || item.changed ? item.weight : 0), 0);

const PROPERTY_CHANGES = [
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
];

export function scoreRedline(ours: RedlineNormalForm, reference: RedlineNormalForm): RedlineScore {
  const a = tokensOf(ours.stories);
  const b = tokensOf(reference.stories);
  const changedMatched = matchedWeight(a, b, true);
  const oursChanged = sum(a, true);
  const referenceChanged = sum(b, true);
  const overallMatched = matchedWeight(a, b, false);
  // Empty stories (default parts one writer saves and another omits) carry no marks.
  const perStory = (form: RedlineNormalForm, pick: (p: NormalParagraph) => string) =>
    form.stories
      .filter((story) =>
        story.paragraphs.some((p) => p.mark || p.segments.some((s) => s.text.trim() !== ''))
      )
      .map((story) => `${story.kind}:${story.paragraphs.map(pick).join(',')}`)
      .join('|');
  const formatRuns = (form: RedlineNormalForm) =>
    form.stories
      .flatMap((story) =>
        story.paragraphs.flatMap((p) =>
          p.segments.filter((s) => s.formatChanged).map((s) => s.text.trim())
        )
      )
      .filter((text) => text !== '')
      .join('|');
  return {
    changedF1: f1(changedMatched, oursChanged, referenceChanged),
    precision: oursChanged === 0 ? (referenceChanged === 0 ? 1 : 0) : changedMatched / oursChanged,
    recall:
      referenceChanged === 0 ? (oursChanged === 0 ? 1 : 0) : changedMatched / referenceChanged,
    overallF1: f1(overallMatched, sum(a, false), sum(b, false)),
    paragraphMarksEqual:
      perStory(ours, (p) => p.mark ?? '-') === perStory(reference, (p) => p.mark ?? '-'),
    rowMarksEqual:
      perStory(ours, (p) => (p.tableDepth > 0 ? (p.row ?? '-') : '')) ===
      perStory(reference, (p) => (p.tableDepth > 0 ? (p.row ?? '-') : '')),
    propertyChangesEqual: PROPERTY_CHANGES.every(
      (name) => (ours.revisionCounts[name] ?? 0) > 0 === (reference.revisionCounts[name] ?? 0) > 0
    ),
    paragraphPropertiesEqual:
      perStory(ours, (p) => (p.propertiesChanged ? 'c' : '-')) ===
      perStory(reference, (p) => (p.propertiesChanged ? 'c' : '-')),
    formatChangesEqual: formatRuns(ours) === formatRuns(reference),
  };
}

/**
 * The accepted or rejected view as a comparable fingerprint: the text of each non-empty story,
 * sorted, without comments (comment parts are not compared content) or empty note paragraphs.
 */
export function viewFingerprint(form: RedlineNormalForm, view: 'accept' | 'reject'): string {
  return form.stories
    .filter((story) => story.kind !== 'comments')
    .map((story) => {
      const text = viewText({ ...form, stories: [story] }, view);
      // A note whose reference is gone goes with it, so empty note paragraphs carry nothing.
      const notes = story.kind === 'footnotes' || story.kind === 'endnotes';
      const kept = notes
        ? text
            .split('\n')
            .filter((line) => line.trim() !== '')
            .join('\n')
        : text;
      return `${story.kind}:${kept}`;
    })
    .filter((text) => !/^[a-z]+:\s*$/.test(text))
    .sort()
    .join('\n\n');
}

/** Text of the accepted (`'accept'`) or rejected (`'reject'`) view of a normal form. */
export function viewText(form: RedlineNormalForm, view: 'accept' | 'reject'): string {
  const drop: ReadonlySet<SegmentMark> = new Set(
    view === 'accept' ? ['del', 'moveFrom'] : ['ins', 'moveTo']
  );
  const droppedMark = view === 'accept' ? 'del' : 'ins';
  return form.stories
    .map((story) => {
      // A removed paragraph mark joins its paragraph to the next one.
      const lines: string[] = [];
      let current = '';
      for (const p of story.paragraphs) {
        if (view === 'accept' ? p.row === 'del' : p.row === 'ins') continue;
        current += p.segments
          .filter((s) => !drop.has(s.mark))
          .map((s) => s.text)
          .join('');
        if (p.mark === droppedMark) continue;
        lines.push(current);
        current = '';
      }
      if (current !== '') lines.push(current);
      return lines.join('\n');
    })
    .join('\n\n');
}
