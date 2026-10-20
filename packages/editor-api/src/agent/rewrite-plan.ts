/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The pure half of the rewrite helper: the placeholder legend, the checks on the model output,
// and the word diff that turns the output into the fewest edits. Nothing here touches a document.
//
// A paragraph is a list of UNITS. A text unit is a word with its trailing space or tab, or the
// text that touches an atom inside a word, such as the comma after a field. An ATOM unit is
// content that changes whole or not at all: a field, a picture, an equation, a note reference,
// or one content-locked control. The model sees each atom as a numbered placeholder, `⟦n⟧`, and
// the text around it as ordinary text, so `Subject to ⟦1⟧, the` reads naturally.

import { RewriteError } from './rewrite-error.ts';

/**
 * What a placeholder stands for.
 *
 * @public
 */
export type RewritePlaceholderKind =
  | 'field'
  | 'content-control'
  | 'picture'
  | 'equation'
  | 'note-reference'
  | 'line-break';

/**
 * One placeholder in the draft text, and what it stands for.
 *
 * @public
 */
export interface RewritePlaceholder {
  /** The placeholder as the model sees it, such as `⟦1⟧`. */
  readonly placeholder: string;
  /** What the placeholder stands for. */
  readonly kind: RewritePlaceholderKind;
  /**
   * The text the paragraph reads for it: a field result, a control's text, U+000B for a line
   * break, or U+FFFC for an equation, a picture, or a note reference.
   */
  readonly text: string;
  /**
   * A description for the model, such as `field REF _Ref1 \h, reads "Section 4.2"`,
   * `equation`, or `locked content control "party", reads "Acme Corp"`.
   */
  readonly description: string;
}

/** One word, text beside an atom, or an atom. */
export interface PlanUnit {
  /** The text the paragraph reads for this unit. A word keeps its trailing space or tab. */
  readonly text: string;
  /** The placeholder number of an atom, or null for text. */
  readonly atom: number | null;
}

/** A run of units to replace, delete, or insert before. */
export interface Hunk {
  /** The first unit the hunk replaces, or the unit the insertion goes before. */
  readonly from: number;
  /** One past the last unit the hunk replaces. Equal to `from` for an insertion. */
  to: number;
  text: string;
}

interface ModelToken {
  readonly text: string;
  readonly atom: number | null;
}

type Step =
  | { readonly kind: 'keep'; readonly unit: number; readonly token: ModelToken }
  | { readonly kind: 'delete'; readonly unit: number }
  | { readonly kind: 'insert'; readonly token: ModelToken };

const TRAILING_SPACING = /[ \t]+$/;

/** The brackets of a draft's placeholders. */
export interface PlaceholderSyntax {
  readonly open: string;
  readonly close: string;
}

/** Bracket pairs in order of preference. A draft takes the first its paragraph never uses. */
const SYNTAXES: readonly PlaceholderSyntax[] = [
  { open: '⟦', close: '⟧' },
  { open: '⟪', close: '⟫' },
  { open: '⦃', close: '⦄' },
  { open: '⟬', close: '⟭' },
];

/** The placeholder brackets for a paragraph: a pair that its text does not contain. */
export function syntaxFor(text: string): PlaceholderSyntax {
  const syntax = SYNTAXES.find(({ open, close }) => !text.includes(open) && !text.includes(close));
  if (!syntax) {
    throw new RewriteError(
      'unsupported-text',
      'The paragraph contains every bracket pair the placeholders can use, so a placeholder ' +
        'could not be told apart from its text.'
    );
  }
  return syntax;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternOf = ({ open, close }: PlaceholderSyntax, flags: string, anchor = '') =>
  new RegExp(`${anchor}${escape(open)}(\\d+)${escape(close)}`, flags);
const PARAGRAPH_BREAK = /[\r\n]/;
const SEPARATORS = /[\u2028\u2029]/g;
/** The most units a paragraph or an answer may have. A paragraph comes from the file. */
const MAX_UNITS = 20_000;
/** The most edits one answer may make: the diff keeps about this many squared numbers. */
const MAX_EDITS = 2_000;

export const coreOf = (text: string): string => text.replace(TRAILING_SPACING, '');
export const spacingOf = (text: string): string => TRAILING_SPACING.exec(text)?.[0] ?? '';
export const placeholderOf = (atom: number, syntax: PlaceholderSyntax): string =>
  `${syntax.open}${atom}${syntax.close}`;

/** The paragraph text for the model, with each atom shown as its placeholder. */
export function draftText(units: readonly PlanUnit[], syntax: PlaceholderSyntax): string {
  return units
    .map((unit) => (unit.atom === null ? unit.text : placeholderOf(unit.atom, syntax)))
    .join('');
}

/**
 * The placeholder contract as plain text: what a placeholder is, the rules for keeping and
 * leaving one out, and one line per placeholder. Empty when the paragraph has no placeholder.
 * Each description is one line, so a line of the legend is always one placeholder.
 */
export function legendOf(
  placeholders: readonly RewritePlaceholder[],
  keepPlaceholders: boolean,
  syntax: PlaceholderSyntax
): string {
  if (placeholders.length === 0) return '';
  const example = placeholderOf(1, syntax);
  const rules = [
    `The text contains placeholders, such as ${example}. Each one stands for content that you ` +
      'cannot edit, such as a field or an equation.',
    keepPlaceholders
      ? 'Keep every placeholder, and copy each one exactly as written.'
      : 'Copy each placeholder that you keep exactly as written. Leave a placeholder out to ' +
        'delete what it stands for.',
    'Write the text around a placeholder as usual. Do not change the order of the ' +
      'placeholders, and do not repeat one.',
  ].join(' ');
  const lines = placeholders.map((entry) => `${entry.placeholder} = ${entry.description}`);
  return `${rules}\n\nPlaceholders:\n${lines.join('\n')}`;
}

/**
 * Refuse model output that cannot be applied, before anything is written: an empty result, a
 * line break, an unknown or repeated placeholder, and, with `keepPlaceholders`, a missing one.
 */
export function checkOutput(
  output: string,
  placeholders: readonly RewritePlaceholder[],
  keepPlaceholders: boolean,
  syntax: PlaceholderSyntax,
  original: string
): void {
  if (output === '') {
    throw new RewriteError('invalid-output', 'The model output is empty. Return the paragraph.');
  }
  // U+2028 and U+2029 are text when the paragraph already has them; otherwise they break it.
  const separators = new Set(original.match(SEPARATORS) ?? []);
  const foreign = [...(output.match(SEPARATORS) ?? [])].some((char) => !separators.has(char));
  if (PARAGRAPH_BREAK.test(output) || foreign) {
    throw new RewriteError(
      'invalid-output',
      'The model output contains a line break. Return one paragraph on one line.'
    );
  }
  const known = new Set(placeholders.map((entry) => entry.placeholder));
  const seen = new Set<string>();
  for (const [placeholder] of output.matchAll(patternOf(syntax, 'g'))) {
    if (!known.has(placeholder)) {
      throw new RewriteError(
        'placeholder-unknown',
        `The model output contains ${placeholder}, which is not in the paragraph. ` +
          'Use only the listed placeholders.'
      );
    }
    if (seen.has(placeholder)) {
      throw new RewriteError(
        'placeholder-repeated',
        `The model output contains ${placeholder} more than once. Keep each placeholder once.`
      );
    }
    seen.add(placeholder);
  }
  if (keepPlaceholders) {
    const missing = placeholders.find((entry) => !seen.has(entry.placeholder));
    if (missing) {
      throw new RewriteError(
        'placeholder-missing',
        `The model output leaves out ${missing.placeholder}. Keep every placeholder.`
      );
    }
  }
}

/** The text the model wrote, with each placeholder read as the text it stands for. */
export function expandedOutput(
  output: string,
  placeholders: readonly RewritePlaceholder[],
  syntax: PlaceholderSyntax
): string {
  const known = new Map(placeholders.map((entry) => [entry.placeholder, entry.text]));
  return output.replace(
    patternOf(syntax, 'g'),
    (placeholder) => known.get(placeholder) ?? placeholder
  );
}

/**
 * Split text the way the units split a paragraph: each placeholder alone, and other text into
 * pieces that end after a space or a tab, or where a placeholder starts.
 */
export function tokensOf(text: string, syntax: PlaceholderSyntax): ModelToken[] {
  const at = patternOf(syntax, '', '^');
  const tokens: ModelToken[] = [];
  let piece = '';
  const flush = () => {
    if (piece !== '') tokens.push({ text: piece, atom: null });
    piece = '';
  };
  for (let index = 0; index < text.length; ) {
    const placeholder = text.startsWith(syntax.open, index) ? at.exec(text.slice(index)) : null;
    if (placeholder) {
      flush();
      tokens.push({ text: placeholder[0], atom: Number(placeholder[1]) });
      index += placeholder[0].length;
      continue;
    }
    const char = text[index]!;
    piece += char;
    index += 1;
    if (char === ' ' || char === '\t') flush();
  }
  flush();
  return tokens;
}

/**
 * The steps from the original units to the model tokens: a shortest edit script (Myers). Time
 * and memory grow with the number of edits, not with the square of the paragraph, so a long
 * paragraph with a few changes stays fast.
 */
function diff(units: readonly PlanUnit[], tokens: readonly ModelToken[]): Step[] {
  const n = units.length;
  const m = tokens.length;
  const same = (u: number, t: number): boolean => {
    const unit = units[u]!;
    const token = tokens[t]!;
    if (unit.atom !== null || token.atom !== null) return unit.atom === token.atom;
    if (unit.text === token.text) return true;
    // At either end, a word matches without its trailing spacing.
    const atEnd = u === n - 1 || t === m - 1;
    return atEnd && coreOf(unit.text) === coreOf(token.text);
  };
  if (n > MAX_UNITS || m > MAX_UNITS) throw tooLong();
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && same(x, y)) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) throw tooLong();

  // Walk the trace back from the end. Each step is a keep run, then one edit.
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const saved = trace[d]!;
    const at = (k: number) => saved[k + d + 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      steps.push({ kind: 'keep', unit: x, token: tokens[y]! });
    }
    if (down) {
      y -= 1;
      steps.push({ kind: 'insert', token: tokens[y]! });
    } else {
      x -= 1;
      steps.push({ kind: 'delete', unit: x });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    steps.push({ kind: 'keep', unit: x, token: tokens[y]! });
  }
  return steps.reverse();
}

const tooLong = () =>
  new RewriteError(
    'too-long',
    'The paragraph and the model output are too long to compare. Rewrite a shorter paragraph.'
  );

/** Refuse a paragraph too long to compare with any answer, before the model is asked. */
export function checkLength(units: readonly unknown[]): void {
  if (units.length > MAX_UNITS) throw tooLong();
}

/**
 * The hunks that turn the original units into the model output, in document order. Refuses a
 * moved placeholder: the diff can only keep it in place or delete it.
 */
export function hunksOf(
  units: readonly PlanUnit[],
  output: string,
  syntax: PlaceholderSyntax
): Hunk[] {
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let carry = '';
  let next = 0;
  for (const step of diff(units, tokensOf(output, syntax))) {
    if (step.kind === 'keep') {
      open = null;
      const unit = units[step.unit]!;
      // Text after the last word needs the space the model wrote after it.
      if (step.unit === units.length - 1 && unit.atom === null && spacingOf(unit.text) === '')
        carry = spacingOf(step.token.text);
      next = step.unit + 1;
      continue;
    }
    if (step.kind === 'insert' && step.token.atom !== null) {
      throw new RewriteError(
        'placeholder-moved',
        `The model output moves ${placeholderOf(step.token.atom, syntax)}. Keep the placeholders in ` +
          'their order.'
      );
    }
    if (!open) {
      open = { from: next, to: next, text: carry };
      carry = '';
      hunks.push(open);
    }
    if (step.kind === 'delete') {
      open.to = step.unit + 1;
      next = step.unit + 1;
    } else {
      open.text += step.token.text;
    }
  }
  return hunks;
}
