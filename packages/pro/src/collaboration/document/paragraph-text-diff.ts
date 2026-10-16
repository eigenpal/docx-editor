/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The smallest change from a paragraph's shared text to the inline sequence a local edit
 * left: an edit script over tokens, one per character, embed or empty element.
 */
import type * as Y from 'yjs';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { linearizeParagraph } from './paragraph-linear.ts';
import type { DocumentLimits } from './limits.ts';
import {
  attributeSignature,
  embedContent,
  encodeAttributes,
  type InlineAttributes,
  type InlineEmbed,
} from './paragraph-text.ts';
import { revisionTrail, withoutRevisions } from './paragraph-text-revisions.ts';

/** One position of a paragraph's inline sequence, as shared text holds it. */
export interface Token {
  /** The content: a character's value, an embed's node, an anchor's attributes. */
  readonly key: string;
  /** The content and the text element it sits in: what makes two characters the same one. */
  readonly strong: string;
  readonly insert: string | InlineEmbed;
  readonly attributes: InlineAttributes;
  /** Where the token stands in its shared text, which can also hold positions it hides. */
  readonly position?: number;
  /** The revisions it belongs to (`revisionTrail`), or empty when read without a paragraph. */
  readonly trail?: string;
}

/** The paragraph and limits a shared text is read under. */
export interface TokenContext {
  readonly limits: DocumentLimits;
  readonly paragraphId: string;
}

/** The tokens of a shared text, without the positions `hidden` names. */
export function tokensOfText(
  text: Y.Text,
  hidden?: ReadonlySet<number>,
  context?: TokenContext
): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  for (const op of text.toDelta() as { insert: unknown; attributes?: Record<string, string> }[]) {
    const attributes = op.attributes ?? {};
    const trail = context ? revisionTrail(attributes, context.limits, context.paragraphId) : '';
    if (typeof op.insert === 'string') {
      const holder = textIdOf(attributes);
      for (let at = 0; at < op.insert.length; at += 1, position += 1) {
        if (hidden?.has(position)) continue;
        const key = `c${op.insert[at]}`;
        tokens.push({
          key,
          strong: `${key}\u0000${holder}`,
          insert: op.insert[at]!,
          attributes,
          position,
          trail,
        });
      }
    } else {
      position += 1;
      if (hidden?.has(position - 1)) continue;
      const embed = op.insert as { n?: string; r?: 1; a?: 1 };
      const key =
        typeof embed.n === 'string'
          ? `e${embed.r === 1 ? 'r' : ''}${embed.n}`
          : anchorKey(attributes, trail);
      tokens.push({
        key,
        strong: key,
        insert: embed as InlineEmbed,
        attributes,
        position: position - 1,
        trail,
      });
    }
  }
  return tokens;
}

export function tokensOfParagraph(after: OoxmlElement, limits: DocumentLimits): Token[] {
  const paragraphId = after.id;
  // Characters of one run share one attributes object, so each is encoded once.
  const encoded = new Map<object, { attributes: InlineAttributes; trail: string }>();
  return linearizeParagraph(after).items.map((item) => {
    let entry = encoded.get(item.attributes);
    if (!entry) {
      const attributes = encodeAttributes(item.attributes, paragraphId, limits);
      entry = { attributes, trail: revisionTrail(attributes, limits, paragraphId) };
      encoded.set(item.attributes, entry);
    }
    const { attributes, trail } = entry;
    if (item.kind === 'char') {
      const key = `c${item.value}`;
      const strong = `${key}\u0000${textIdOf(attributes)}`;
      return { key, strong, insert: item.value, attributes, trail };
    }
    if (item.kind === 'embed') {
      const insert = embedContent(item);
      // Moving into or out of a run changes the content, so the embed is written again.
      const key = `e${'r' in insert ? 'r' : ''}${item.node.id}`;
      return { key, strong: key, insert, attributes, trail };
    }
    const key = anchorKey(attributes, trail);
    return { key, strong: key, insert: { a: 1 }, attributes, trail };
  });
}

export type Step =
  | { readonly op: 'eq'; readonly before: number; readonly after: number }
  | { readonly op: 'del'; readonly before: number }
  | { readonly op: 'ins'; readonly after: number };

const MAX_DIFF_CELLS = 1 << 20;

/**
 * An empty element's content key: its attributes, with its revisions as the revisions it
 * belongs to. Shared text can hold a revision under another key or order than the editor's
 * tree encodes, or hold one the anchor does not belong to; the anchor is still the same.
 */
function anchorKey(attributes: InlineAttributes, trail: string): string {
  return `a${attributeSignature(withoutRevisions(attributes))}${trail}`;
}

/**
 * The text element a character's shared attributes name, as stored. Stored IDs are relative
 * to the paragraph and run, and both sides of a diff encode the same paragraph alike.
 */
function textIdOf(attributes: InlineAttributes): string {
  return attributes.t ?? '';
}

/**
 * An edit script from `before` to `after`.
 *
 * Characters are only text, so equal letters in different places look alike. The script
 * matches characters in the same text element first (strong), so deleting a word before
 * another word that starts with its letter keeps the right letter, and a peer's typing in
 * the deleted word does not land in the next one. Between two strong matches it then
 * matches by value alone (weak), but only at the ends of the gap: a run split or reformatted
 * wholesale gets new text elements and still keeps its letters, while new text never keeps
 * scattered letters of text it replaces, which a peer's concurrent insert would interleave.
 */
export function diffTokens(
  before: readonly Token[],
  after: readonly Token[],
  /** Whether typing at one place skips the full diff. Tests compare both answers. */
  shortcut = true
): Step[] {
  // A character outside the basic plane is two code units, and shared text replaces a half
  // that an edit cuts off with U+FFFD. So the script compares whole code points, and each
  // step on a pair covers both halves.
  const left = codePoints(before);
  const right = codePoints(after);
  if (left === null && right === null) return diffCodePoints(before, after, shortcut);
  const beforeAt = left?.starts ?? null;
  const afterAt = right?.starts ?? null;
  const unitsOf = (starts: readonly number[] | null, index: number, length: number): number[] => {
    if (starts === null) return [index];
    const start = starts[index]!;
    const end = index + 1 < starts.length ? starts[index + 1]! : length;
    return end - start === 2 ? [start, start + 1] : [start];
  };
  const steps: Step[] = [];
  for (const step of diffCodePoints(left?.tokens ?? before, right?.tokens ?? after, shortcut)) {
    if (step.op === 'del') {
      for (const unit of unitsOf(beforeAt, step.before, before.length))
        steps.push({ op: 'del', before: unit });
    } else if (step.op === 'ins') {
      for (const unit of unitsOf(afterAt, step.after, after.length))
        steps.push({ op: 'ins', after: unit });
    } else {
      // Equal code points have equal widths.
      const units = unitsOf(beforeAt, step.before, before.length);
      const afterUnits = unitsOf(afterAt, step.after, after.length);
      units.forEach((unit, at) => steps.push({ op: 'eq', before: unit, after: afterUnits[at]! }));
    }
  }
  return steps;
}

const isHigh = (token: Token | undefined): boolean => {
  if (token === undefined || typeof token.insert !== 'string') return false;
  const code = token.insert.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff;
};

const isLow = (token: Token | undefined): boolean => {
  if (token === undefined || typeof token.insert !== 'string') return false;
  const code = token.insert.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
};

/**
 * The tokens with each surrogate pair as one, and where each starts in `tokens`; null when no
 * pair is there. A pair's halves must be neighbors in the shared text too: a hidden position
 * between them keeps them apart.
 */
function codePoints(
  tokens: readonly Token[]
): { readonly tokens: Token[]; readonly starts: number[] } | null {
  let any = false;
  for (let at = 0; at + 1 < tokens.length && !any; at += 1) {
    any = isHigh(tokens[at]) && isLow(tokens[at + 1]);
  }
  if (!any) return null;
  const merged: Token[] = [];
  const starts: number[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at]!;
    const next = tokens[at + 1];
    starts.push(at);
    const adjacent =
      next !== undefined && (token.position === undefined || next.position === token.position + 1);
    if (isHigh(token) && isLow(next) && adjacent) {
      const value = `${token.insert as string}${next!.insert as string}`;
      const key = `c${value}`;
      merged.push({
        ...token,
        key,
        strong: `${key}\u0000${textIdOf(token.attributes)}`,
        insert: value,
      });
      at += 1;
    } else {
      merged.push(token);
    }
  }
  return { tokens: merged, starts };
}

function diffCodePoints(
  before: readonly Token[],
  after: readonly Token[],
  shortcut: boolean
): Step[] {
  const inserted = shortcut ? pureInsertion(before, after) : null;
  if (inserted) return inserted;
  // Equal strong alignments can differ in what their gaps keep: runs merged by a join give the
  // same letters a new text element, and an early tie can pair letters of one word with those
  // of the next. Of the two tie-breaks, keep the one that keeps more, and of two that keep as
  // much, the one with fewer separate changes: typing "lore" before "on" is one insert, not
  // an "l", the existing "o", and then "re" with a new "o".
  const first = scriptOf(before, after, strongMatches(before, after, false));
  const second = scriptOf(before, after, strongMatches(before, after, true));
  const [firstKept, secondKept] = [equalCount(first), equalCount(second)];
  const chosen =
    secondKept !== firstKept
      ? secondKept > firstKept
        ? second
        : first
      : changeCount(second) < changeCount(first)
        ? second
        : first;
  return dropScatteredLetters(joinInserts(chosen, after), before);
}

/**
 * The script of an edit that only inserts one stretch, where no other script keeps as much:
 * typing at one place. Null for any other edit, which the full diff decides.
 *
 * The full diff runs two alignments over the whole paragraph, and typing is most of what a
 * paragraph's text sees. Where the stretch could stand is decided as the full diff decides
 * it, and a test compares the two answers.
 */
function pureInsertion(before: readonly Token[], after: readonly Token[]): Step[] | null {
  const added = after.length - before.length;
  if (added <= 0) return null;
  let prefix = 0;
  while (prefix < before.length && before[prefix]!.strong === after[prefix]!.strong) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    before[before.length - 1 - suffix]!.strong === after[after.length - 1 - suffix]!.strong
  ) {
    suffix += 1;
  }
  if (prefix + suffix !== before.length) return null;
  const first = after[prefix]!;
  const last = after[prefix + added - 1]!;
  // The same character before the stretch could stand at its end instead: the full diff
  // keeps the earlier one, which the longest prefix does too. A letter equal only by value
  // pairs by other rules, so the full diff decides that place.
  const previous = prefix > 0 ? before[prefix - 1]! : null;
  if (previous && previous.key === last.key && previous.strong !== last.strong) return null;
  if (prefix < before.length && before[prefix]!.key === first.key) return null;
  const steps: Step[] = [];
  for (let at = 0; at < prefix; at += 1) steps.push({ op: 'eq', before: at, after: at });
  for (let at = prefix; at < prefix + added; at += 1) steps.push({ op: 'ins', after: at });
  for (let at = prefix; at < before.length; at += 1) {
    steps.push({ op: 'eq', before: at, after: at + added });
  }
  return steps;
}

/**
 * A letter typing can write again: one character of the basic plane, and no control
 * character. The model holds some elements as control characters (a non-breaking hyphen as
 * U+001E), which only their original carries. A surrogate pair written again goes in as two
 * inserts, and a peer's concurrent insert can land between its halves.
 */
function isPlainLetter(token: Token): boolean {
  if (!isLetter(token) || typeof token.insert !== 'string' || token.insert.length !== 1) {
    return false;
  }
  const code = token.insert.charCodeAt(0);
  return code >= 0x20 && (code < 0xd800 || code > 0xdfff);
}

/** Passes of `dropScatteredLetters`; each one only merges changes, so a few settle it. */
const MAX_CLEANUP_PASSES = 16;

/**
 * In a replacement, replace kept letters that are no longer than the changes on both sides.
 *
 * Text that replaces a word can share a few letters with it ("new" and "changed" share "n"
 * and "e"). Keeping them scatters the old word's letters through the new one, and a peer's
 * concurrent deletion of the old word then leaves only the new letters between them
 * ("chagd"). Replaced whole, the new word survives whole. Only letters beside a deletion
 * qualify: an edit that only inserts scatters nothing, and every kept letter keeps the
 * position peers anchored to it. Text kept at the ends of a change, as typing inside a
 * word keeps, is longer than the change or has no change on one side, so it stays. Only
 * plain letters are replaced: an embed, a surrogate pair, or an element the model holds as
 * a control character keeps its identity.
 */
function dropScatteredLetters(steps: Step[], before: readonly Token[]): Step[] {
  for (let pass = 0; pass < MAX_CLEANUP_PASSES; pass += 1) {
    const groups: Step[][] = [];
    for (const step of steps) {
      const last = groups[groups.length - 1];
      if (last && (last[0]!.op === 'eq') === (step.op === 'eq')) last.push(step);
      else groups.push([step]);
    }
    const size = (group: Step[] | undefined): number => {
      if (!group || group[0]!.op === 'eq') return 0;
      let inserted = 0;
      for (const step of group) if (step.op === 'ins') inserted += 1;
      return Math.max(inserted, group.length - inserted);
    };
    // A replacement removes letters of the text it types over, in the revisions the kept
    // letters are in. Letters that go from other revisions, or struck letters, go by a decision,
    // as an accept or reject of a change makes: the letters between them stay where they are.
    const deletes = (group: Step[] | undefined, kept: ReadonlySet<string>): boolean =>
      group !== undefined &&
      group.some((step) => {
        if (step.op !== 'del') return false;
        const token = before[step.before]!;
        return !isStruck(token) && kept.has(token.trail ?? '');
      });
    let changed = false;
    const out: Step[] = [];
    groups.forEach((group, index) => {
      const kept = new Set(
        group.map((step) => (step.op === 'eq' ? (before[step.before]!.trail ?? '') : ''))
      );
      const scattered =
        group[0]!.op === 'eq' &&
        group.length <= size(groups[index - 1]) &&
        group.length <= size(groups[index + 1]) &&
        // Only a replacement scatters letters: text typed in between deletes nothing.
        (deletes(groups[index - 1], kept) || deletes(groups[index + 1], kept)) &&
        group.every((step) => step.op === 'eq' && isPlainLetter(before[step.before]!));
      if (!scattered) {
        for (const step of group) out.push(step);
        return;
      }
      changed = true;
      for (const step of group) if (step.op === 'eq') out.push({ op: 'del', before: step.before });
      for (const step of group) if (step.op === 'eq') out.push({ op: 'ins', after: step.after });
    });
    steps = out;
    if (!changed) break;
  }
  return steps;
}

/**
 * Join inserts that a kept character splits, when the second insert ends with that same
 * letter: keep the later copy instead, and the inserted text is one piece, as it was typed.
 * Both scripts keep as many characters; only which of two equal letters stays differs.
 */
function joinInserts(steps: Step[], after: readonly Token[]): Step[] {
  for (let at = 1; at < steps.length; at += 1) {
    const kept = steps[at]!;
    if (kept.op !== 'eq' || steps[at - 1]!.op !== 'ins') continue;
    let end = at + 1;
    while (end < steps.length && steps[end]!.op === 'ins') end += 1;
    const last = steps[end - 1]!;
    if (end === at + 1 || last.op !== 'ins') continue;
    if (after[last.after]!.key !== after[kept.after]!.key) continue;
    steps.splice(at, end - at, { op: 'ins', after: kept.after }, ...steps.slice(at + 1, end - 1), {
      op: 'eq',
      before: kept.before,
      after: last.after,
    });
  }
  return steps;
}

/** How many separate places a script changes: runs of steps that are not equal. */
function changeCount(steps: readonly Step[]): number {
  let count = 0;
  let changing = false;
  for (const step of steps) {
    if (step.op !== 'eq' && !changing) count += 1;
    changing = step.op !== 'eq';
  }
  return count;
}

function isLetter(token: Token): boolean {
  return token.key.startsWith('c');
}

/** Whether two ranges hold the same letters in the same order, and at least one. */
function sameLetters(
  before: readonly Token[],
  beforeStart: number,
  beforeEnd: number,
  after: readonly Token[],
  afterStart: number,
  afterEnd: number
): boolean {
  let i = beforeStart;
  let j = afterStart;
  let letters = 0;
  for (;;) {
    while (i < beforeEnd && !isLetter(before[i]!)) i += 1;
    while (j < afterEnd && !isLetter(after[j]!)) j += 1;
    if (i === beforeEnd || j === afterEnd) return i === beforeEnd && j === afterEnd && letters > 0;
    if (before[i]!.key !== after[j]!.key) return false;
    letters += 1;
    i += 1;
    j += 1;
  }
}

const STRUCK_TEXT = /"l":"del(Text|InstrText)"/;
const STRUCK_REVISION = /\\"l\\":\\"(del|moveFrom)\\"/;

/**
 * Whether a character is struck: it sits in deleted text, a `w:delText` or `w:delInstrText`
 * element, or belongs to a deletion. A peer's concurrent strike can leave either one alone.
 */
function isStruck(token: Token): boolean {
  const text = token.attributes.t;
  if (typeof text === 'string' && STRUCK_TEXT.test(text)) return true;
  return token.trail !== undefined && STRUCK_REVISION.test(token.trail);
}

function equalCount(steps: readonly Step[]): number {
  let count = 0;
  for (const step of steps) if (step.op === 'eq') count += 1;
  return count;
}

/** The edit script of one strong alignment: weak matches at its gaps' ends, the rest replaced. */
function scriptOf(
  before: readonly Token[],
  after: readonly Token[],
  strong: readonly (readonly [number, number])[]
): Step[] {
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  for (const [nextBefore, nextAfter] of [...strong, [before.length, after.length] as const]) {
    // The gap before this strong match: weak ends, then the rest deleted and inserted. Where
    // the gap's head and tail can each keep a letter, as a letter typed beside an equal one,
    // the order that keeps more letters in their revisions decides: a kept letter that
    // changes revision writes a decision over it, which another author's concurrent decision
    // on that revision would not see.
    let ends = weakEnds(before, after, i, nextBefore, j, nextAfter, false);
    const kept = inRevision(ends, before, after);
    // Only an order that moves a letter out of its revision can lose to the other one.
    if (kept.inRevision < kept.equal) {
      const tailFirst = weakEnds(before, after, i, nextBefore, j, nextAfter, true);
      const other = inRevision(tailFirst, before, after);
      // Never at the cost of a letter: a letter the gap does not keep loses its identity.
      if (other.equal >= kept.equal && other.inRevision > kept.inRevision) ends = tailFirst;
    }
    // One at a time: a gap can hold more steps than a call takes arguments.
    for (const step of ends.head) steps.push(step);
    const tail = ends.tail;
    ({ i, j } = ends);
    const { bEnd, aEnd } = ends;
    if (sameLetters(before, i, bEnd, after, j, aEnd)) {
      // Only embeds differ, as when a comment's range markers go in around its text: every
      // letter stays, so the text keeps its identity for a peer who moves it meanwhile.
      while (i < bEnd || j < aEnd) {
        if (i < bEnd && j < aEnd && isLetter(before[i]!) && isLetter(after[j]!)) {
          steps.push({ op: 'eq', before: i, after: j });
          i += 1;
          j += 1;
        } else if (i < bEnd && !isLetter(before[i]!)) {
          steps.push({ op: 'del', before: i });
          i += 1;
        } else {
          steps.push({ op: 'ins', after: j });
          j += 1;
        }
      }
    }
    for (; i < bEnd; i += 1) steps.push({ op: 'del', before: i });
    for (; j < aEnd; j += 1) steps.push({ op: 'ins', after: j });
    for (const step of tail) steps.push(step);
    i = nextBefore;
    j = nextAfter;
    if (i < before.length && j < after.length) {
      steps.push({ op: 'eq', before: i, after: j });
      i += 1;
      j += 1;
    }
  }
  return steps;
}

/** The weak matches at the ends of one gap, and the gap they leave. */
interface WeakEnds {
  readonly head: Step[];
  readonly tail: Step[];
  readonly i: number;
  readonly j: number;
  readonly bEnd: number;
  readonly aEnd: number;
}

/**
 * Match letters by value at a gap's start, then at its end, or with `tailFirst` the other way
 * round. An embed only one side has at a gap's end, as a removed field mark or comment
 * marker, does not end the letters that match there.
 */
function weakEnds(
  before: readonly Token[],
  after: readonly Token[],
  i: number,
  bEnd: number,
  j: number,
  aEnd: number,
  tailFirst: boolean
): WeakEnds {
  const head: Step[] = [];
  const tail: Step[] = [];
  const fromHead = (): void => {
    for (;;) {
      if (i < bEnd && j < aEnd && before[i]!.key === after[j]!.key) {
        head.push({ op: 'eq', before: i, after: j });
        i += 1;
        j += 1;
      } else if (i < bEnd && j < aEnd && !isLetter(before[i]!) && isLetter(after[j]!)) {
        head.push({ op: 'del', before: i });
        i += 1;
      } else if (i < bEnd && j < aEnd && isLetter(before[i]!) && !isLetter(after[j]!)) {
        head.push({ op: 'ins', after: j });
        j += 1;
      } else break;
    }
  };
  const fromTail = (): void => {
    for (;;) {
      if (bEnd > i && aEnd > j && before[bEnd - 1]!.key === after[aEnd - 1]!.key) {
        bEnd -= 1;
        aEnd -= 1;
        tail.unshift({ op: 'eq', before: bEnd, after: aEnd });
      } else if (
        bEnd > i &&
        aEnd > j &&
        !isLetter(before[bEnd - 1]!) &&
        isLetter(after[aEnd - 1]!)
      ) {
        bEnd -= 1;
        tail.unshift({ op: 'del', before: bEnd });
      } else if (
        bEnd > i &&
        aEnd > j &&
        isLetter(before[bEnd - 1]!) &&
        !isLetter(after[aEnd - 1]!)
      ) {
        aEnd -= 1;
        tail.unshift({ op: 'ins', after: aEnd });
      } else break;
    }
  };
  if (tailFirst) {
    fromTail();
    fromHead();
  } else {
    fromHead();
    fromTail();
  }
  return { head, tail, i, j, bEnd, aEnd };
}

/** How many letters weak matches keep, and how many of those stay in the revisions they were in. */
function inRevision(
  ends: WeakEnds,
  before: readonly Token[],
  after: readonly Token[]
): { readonly equal: number; readonly inRevision: number } {
  let equal = 0;
  let kept = 0;
  for (const steps of [ends.head, ends.tail]) {
    for (const step of steps) {
      if (step.op !== 'eq') continue;
      equal += 1;
      if ((before[step.before]!.trail ?? '') === (after[step.after]!.trail ?? '')) kept += 1;
    }
  }
  return { equal, inRevision: kept };
}

/**
 * The strong matches of a longest common subsequence, as index pairs in order. On a tie the
 * walk skips a character of `before` first, or of `after` first when `skipAfter` is set.
 */
function strongMatches(
  before: readonly Token[],
  after: readonly Token[],
  skipAfter: boolean
): [number, number][] {
  const pairs: [number, number][] = [];
  let low = 0;
  while (low < before.length && low < after.length && before[low]!.strong === after[low]!.strong) {
    pairs.push([low, low]);
    low += 1;
  }
  let beforeEnd = before.length;
  let afterEnd = after.length;
  const tail: [number, number][] = [];
  while (
    beforeEnd > low &&
    afterEnd > low &&
    before[beforeEnd - 1]!.strong === after[afterEnd - 1]!.strong
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
    tail.unshift([beforeEnd, afterEnd]);
  }
  const rows = beforeEnd - low;
  const columns = afterEnd - low;
  // Too large to align: the middle is replaced whole, which stays correct.
  if (rows > 0 && columns > 0 && rows * columns <= MAX_DIFF_CELLS) {
    const width = columns + 1;
    const score = new Uint32Array((rows + 1) * width);
    const same = (r: number, c: number): boolean =>
      before[low + r]!.strong === after[low + c]!.strong;
    for (let r = rows - 1; r >= 0; r -= 1) {
      for (let c = columns - 1; c >= 0; c -= 1) {
        score[r * width + c] = same(r, c)
          ? score[(r + 1) * width + c + 1]! + 1
          : Math.max(score[(r + 1) * width + c]!, score[r * width + c + 1]!);
      }
    }
    let r = 0;
    let c = 0;
    while (r < rows && c < columns) {
      if (same(r, c)) {
        pairs.push([low + r, low + c]);
        r += 1;
        c += 1;
      } else {
        const down = score[(r + 1) * width + c]!;
        const right = score[r * width + c + 1]!;
        if (down > right || (down === right && !skipAfter)) r += 1;
        else c += 1;
      }
    }
  }
  for (const pair of tail) pairs.push(pair);
  return pairs;
}

/** The attribute changes that turn `from` into `to`; removed keys become null. */
export function attributeChanges(
  from: InlineAttributes,
  to: InlineAttributes
): Record<string, string | null> | null {
  let changes: Record<string, string | null> | null = null;
  for (const key of Object.keys(from)) {
    if (!(key in to)) {
      (changes ??= {})[key] = null;
    }
  }
  for (const key of Object.keys(to)) {
    if (from[key] !== to[key]) (changes ??= {})[key] = to[key]!;
  }
  return changes;
}
