/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The pure half of the rewrite helper: the prompt, the checks on the model output, and the word
// diff that turns the output into the fewest edits. Nothing here touches a document.
//
// A paragraph is a list of UNITS: one word with its trailing space or tab, as
// `getTextRanges([' ', '\t'])` splits it, or one ATOM that must change whole or not at all (a
// field, a picture, an equation, a note reference, or the words of one content-locked control).
// The model sees each atom as a numbered placeholder, `⟦n⟧`.

import { RewriteError } from './rewrite-error.ts';

/**
 * What a placeholder stands for. An equation and a note reference both read as U+FFFC, so they
 * share one kind.
 *
 * @public
 */
export type RewritePlaceholderKind = 'field' | 'content-control' | 'picture' | 'equation-or-note';

/**
 * One placeholder in the draft text, and the text it stands for.
 *
 * @public
 */
export interface RewritePlaceholder {
  /** The placeholder as the model sees it, such as `⟦1⟧`. */
  readonly placeholder: string;
  /** What the placeholder stands for. */
  readonly kind: RewritePlaceholderKind;
  /** The text the paragraph reads for it, with any punctuation attached to it. */
  readonly text: string;
}

/** One word or atom, by its text and its placeholder number. */
export interface PlanUnit {
  /** The text the paragraph reads for this unit, with its trailing space or tab. */
  readonly text: string;
  /** The placeholder number of an atom, or null for a word. */
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

const KIND_LABEL: Record<RewritePlaceholderKind, string> = {
  field: 'field',
  'content-control': 'locked content control',
  picture: 'picture',
  'equation-or-note': 'equation or note reference',
};
const TRAILING_SPACING = /[ \t]+$/;
const PLACEHOLDER = /⟦\d+⟧/g;
const PUNCTUATION = /^\p{P}$/u;
const SPACING = new Set(['', ' ', '\t']);
/** The largest word diff table, in cells: 16 MB. A paragraph comes from the file. */
const MAX_DIFF_CELLS = 4_000_000;
const PARAGRAPH_BREAK = /[\r\n\u2028\u2029]/;

export const coreOf = (text: string): string => text.replace(TRAILING_SPACING, '');
export const spacingOf = (text: string): string => TRAILING_SPACING.exec(text)?.[0] ?? '';
export const placeholderOf = (atom: number): string => `⟦${atom}⟧`;

/** The paragraph text for the model, with each atom shown as its placeholder. */
export function draftText(units: readonly PlanUnit[]): string {
  return units
    .map((unit) =>
      unit.atom === null ? unit.text : `${placeholderOf(unit.atom)}${spacingOf(unit.text)}`
    )
    .join('');
}

/** The prompt: the caller's instruction, the placeholder rules, the legend, and the text. */
export function promptOf(
  text: string,
  placeholders: readonly RewritePlaceholder[],
  instruction: string | undefined
): string {
  const legend = placeholders
    .map(
      (entry) => `${entry.placeholder} (${KIND_LABEL[entry.kind]}) = ${JSON.stringify(entry.text)}`
    )
    .join('\n');
  const rules =
    'Return only the rewritten paragraph, as one paragraph of plain text.' +
    (placeholders.length === 0
      ? ''
      : ' Keep each placeholder, such as ⟦1⟧, exactly as written, with a space or the ' +
        'paragraph edge on each side, or leave it out to delete what it stands for. Do not ' +
        'move a placeholder before or after another placeholder, and do not repeat one. Each ' +
        'placeholder already contains the text listed for it, including its punctuation. Do ' +
        'not repeat that text or attach other text to it.');
  return [
    instruction?.trim() ?? '',
    rules,
    legend === '' ? '' : `Placeholders:\n${legend}`,
    `Paragraph:\n${text}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/**
 * Refuse model output that cannot be applied, before anything is written: a paragraph break, an
 * empty result, an unknown, repeated, or (with `keepPlaceholders`) missing placeholder, repeated
 * punctuation, and text attached to a placeholder.
 */
export function checkOutput(
  output: string,
  placeholders: readonly RewritePlaceholder[],
  keepPlaceholders: boolean
): void {
  if (output === '') {
    throw new RewriteError('invalid-output', 'The model output is empty. Return the paragraph.');
  }
  if (PARAGRAPH_BREAK.test(output)) {
    throw new RewriteError(
      'invalid-output',
      'The model output contains a line break. Return one paragraph on one line.'
    );
  }
  const known = new Map(placeholders.map((entry) => [entry.placeholder, entry.text]));
  const seen = new Set<string>();
  for (const match of output.matchAll(PLACEHOLDER)) {
    const placeholder = match[0];
    const text = known.get(placeholder);
    if (text === undefined) {
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
    const start = match.index;
    const end = start + placeholder.length;
    // The punctuation check looks past spaces, so `⟦1⟧ ,` repeats a comma too.
    const nextMark = output.slice(end).trimStart()[0] ?? '';
    const previousMark = output.slice(0, start).trimEnd().slice(-1);
    const first = text[0] ?? '';
    const last = text[text.length - 1] ?? '';
    if (PUNCTUATION.test(last) && nextMark === last) {
      throw new RewriteError(
        'punctuation-repeated',
        `The model output repeats "${last}" after ${placeholder}, which already ends with it.`
      );
    }
    if (PUNCTUATION.test(first) && previousMark === first) {
      throw new RewriteError(
        'punctuation-repeated',
        `The model output repeats "${first}" before ${placeholder}, which already starts with it.`
      );
    }
    if (!SPACING.has(output[start - 1] ?? '') || !SPACING.has(output[end] ?? '')) {
      throw new RewriteError(
        'text-attached',
        `The model output attaches text to ${placeholder}. Put a space on each side of it.`
      );
    }
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
  placeholders: readonly RewritePlaceholder[]
): string {
  const known = new Map(placeholders.map((entry) => [entry.placeholder, entry.text]));
  return output.replace(PLACEHOLDER, (placeholder) => known.get(placeholder) ?? placeholder);
}

/** Split the model output the way `getTextRanges([' ', '\t'])` splits text. */
function tokensOf(output: string): ModelToken[] {
  const tokens: ModelToken[] = [];
  for (const piece of output.match(/[^ \t]*[ \t]|[^ \t]+$/g) ?? []) {
    const placeholder = /^⟦(\d+)⟧[ \t]?$/.exec(piece);
    tokens.push({ text: piece, atom: placeholder ? Number(placeholder[1]) : null });
  }
  return tokens;
}

/** The steps from the original units to the model tokens, by longest common subsequence. */
function diff(units: readonly PlanUnit[], tokens: readonly ModelToken[]): Step[] {
  const same = (u: number, t: number): boolean => {
    const unit = units[u]!;
    const token = tokens[t]!;
    if (unit.atom !== null || token.atom !== null) return unit.atom === token.atom;
    if (unit.text === token.text) return true;
    // At either end, a word matches without its trailing spacing.
    const atEnd = u === units.length - 1 || t === tokens.length - 1;
    return atEnd && coreOf(unit.text) === coreOf(token.text);
  };
  const cols = tokens.length + 1;
  if ((units.length + 1) * cols > MAX_DIFF_CELLS) {
    throw new RewriteError(
      'too-long',
      'The paragraph and the model output are too long to compare. Rewrite a shorter paragraph.'
    );
  }
  const length = new Uint32Array((units.length + 1) * cols);
  for (let u = units.length - 1; u >= 0; u -= 1) {
    for (let t = tokens.length - 1; t >= 0; t -= 1) {
      length[u * cols + t] = same(u, t)
        ? length[(u + 1) * cols + t + 1]! + 1
        : Math.max(length[(u + 1) * cols + t]!, length[u * cols + t + 1]!);
    }
  }
  const steps: Step[] = [];
  let u = 0;
  let t = 0;
  while (u < units.length || t < tokens.length) {
    if (u < units.length && t < tokens.length && same(u, t)) {
      steps.push({ kind: 'keep', unit: u, token: tokens[t]! });
      u += 1;
      t += 1;
    } else if (
      u < units.length &&
      (t === tokens.length || length[(u + 1) * cols + t]! >= length[u * cols + t + 1]!)
    ) {
      steps.push({ kind: 'delete', unit: u });
      u += 1;
    } else {
      steps.push({ kind: 'insert', token: tokens[t]! });
      t += 1;
    }
  }
  return steps;
}

/**
 * The hunks that turn the original units into the model output, in document order. Refuses a
 * moved placeholder: the diff can only keep it in place or delete it.
 */
export function hunksOf(units: readonly PlanUnit[], output: string): Hunk[] {
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let carry = '';
  let next = 0;
  for (const step of diff(units, tokensOf(output))) {
    if (step.kind === 'keep') {
      open = null;
      const unit = units[step.unit]!;
      // Text after the last word needs the space the model wrote after it.
      if (spacingOf(unit.text) === '' && unit.atom === null) carry = spacingOf(step.token.text);
      next = step.unit + 1;
      continue;
    }
    if (step.kind === 'insert' && step.token.atom !== null) {
      throw new RewriteError(
        'placeholder-moved',
        `The model output moves ${placeholderOf(step.token.atom)}. Keep each placeholder in ` +
          'its order among the other placeholders.'
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
