/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The code of docs/site/content/recipes/propose-rewrite.mdx. The recipe test checks that the
// page shows this file exactly, below this header, with the package name in place of the
// relative import: the package resolves its own name to its build, not to these sources.

import {
  DocxEditor,
  isDocxEditorError,
  type Paragraph,
  type Range,
  type RequestContext,
} from '../../../index.ts';

/** One word, or one atom that the model must keep whole. */
export interface RewriteUnit {
  readonly first: Range;
  readonly last: Range;
  /** The text the paragraph reads for this unit, with its trailing space or tab. */
  readonly text: string;
  /** The placeholder number of an atom, or null for a word. */
  readonly atom: number | null;
}

/** What an atom is. An equation and a note reference both read as U+FFFC. */
export type AtomKind = 'field' | 'content control' | 'picture' | 'equation or note reference';

/** What one placeholder stands for: the exact text, with any punctuation attached to it. */
export interface LegendEntry {
  readonly placeholder: string;
  readonly kind: AtomKind;
  readonly text: string;
}

export interface PreparedRewrite {
  readonly paragraph: Paragraph;
  /** The paragraph's own identity, to find it again after another participant's edit. */
  readonly paragraphId: string;
  /** The runtime's author: the author of every change that apply() writes. */
  readonly author: string;
  readonly units: readonly RewriteUnit[];
  /** The paragraph text for the model, with each atom shown as ⟦n⟧. */
  readonly promptText: string;
  /** Each placeholder in `promptText`, and the text it stands for. */
  readonly legend: readonly LegendEntry[];
}

interface ModelToken {
  readonly text: string;
  readonly atom: number | null;
}

type Step =
  | { readonly kind: 'keep'; readonly unit: number; readonly token: ModelToken }
  | { readonly kind: 'delete'; readonly unit: number }
  | { readonly kind: 'insert'; readonly token: ModelToken };

interface Hunk {
  /** The first unit the hunk replaces, or the unit the insertion goes before. */
  readonly from: number;
  /** One past the last unit the hunk replaces. Equal to `from` for an insertion. */
  to: number;
  text: string;
}

const TRAILING_SPACING = /[ \t]+$/;
const coreOf = (text: string) => text.replace(TRAILING_SPACING, '');
const spacingOf = (text: string) => TRAILING_SPACING.exec(text)?.[0] ?? '';
const PUNCTUATION = /^\p{P}$/u;
const SPACING = new Set(['', ' ', '\t']);

/**
 * Split a paragraph into words and atoms, and build the text for the model. Pass the `author`
 * that the runtime was created with: a rollback rejects only that author's changes.
 */
export async function prepare(
  context: RequestContext,
  paragraph: Paragraph,
  author: string
): Promise<PreparedRewrite> {
  const words = paragraph.getTextRanges([' ', '\t']);
  const revisions = paragraph.getRange('Whole').revisions;
  words.load('items/text');
  revisions.load('items/type,items/author');
  paragraph.load('uniqueLocalId');
  context.document.load('changeTrackingMode');
  await context.sync();
  if (context.document.changeTrackingMode !== 'TrackMineOnly') {
    throw new Error("Set changeTrackingMode to 'TrackMineOnly' before you rewrite a paragraph.");
  }
  // apply() rolls back by rejecting its own changes, so the paragraph must start with none.
  if (revisions.items.length > 0) {
    throw new Error('Decide the tracked changes in this paragraph before you rewrite it.');
  }

  // One sync reads the fields, pictures, and content controls of every word.
  const reads = words.items.map((word) => {
    const fields = word.fields;
    const pictures = word.inlinePictures;
    const controls = word.contentControls;
    fields.load('items');
    pictures.load('items');
    controls.load('items/tag,items/cannotEdit,items/text');
    return { word, fields, pictures, controls };
  });
  await context.sync();

  const units: RewriteUnit[] = [];
  const kinds = new Map<number, AtomKind>();
  let lockedKey: string | null = null;
  for (const { word, fields, pictures, controls } of reads) {
    const locked = controls.items.find((control) => control.cannotEdit);
    const key = locked ? `${locked.tag}\u0000${locked.text}` : null;
    const previous = units[units.length - 1];
    if (key !== null && key === lockedKey && previous) {
      // The words of one locked control form one atom.
      units[units.length - 1] = { ...previous, last: word, text: previous.text + word.text };
      continue;
    }
    lockedKey = key;
    const kind: AtomKind | null =
      key !== null
        ? 'content control'
        : fields.items.length > 0
          ? 'field'
          : pictures.items.length > 0
            ? 'picture'
            : word.text.includes('￼')
              ? 'equation or note reference'
              : null;
    const atom = kind === null ? null : kinds.size + 1;
    if (atom !== null && kind !== null) kinds.set(atom, kind);
    units.push({ first: word, last: word, text: word.text, atom });
  }
  const promptText = units
    .map((unit) => (unit.atom === null ? unit.text : `⟦${unit.atom}⟧${spacingOf(unit.text)}`))
    .join('');
  const legend = units.flatMap((unit) =>
    unit.atom === null
      ? []
      : [{ placeholder: `⟦${unit.atom}⟧`, kind: kinds.get(unit.atom)!, text: coreOf(unit.text) }]
  );
  const paragraphId = paragraph.uniqueLocalId;
  return { paragraph, paragraphId, author, units, promptText, legend };
}

/** A prompt that shows the model what each placeholder already contains. */
export function promptFor(prepared: PreparedRewrite, instruction: string): string {
  const legend = prepared.legend
    .map((entry) => `${entry.placeholder} (${entry.kind}) = ${JSON.stringify(entry.text)}`)
    .join('\n');
  return [
    instruction,
    'Return only the rewritten paragraph. Keep each placeholder, such as ⟦1⟧, exactly as ' +
      'written, with a space or the paragraph edge on each side, or leave it out to delete ' +
      'what it stands for. Each placeholder already contains the text listed for it, ' +
      'including its punctuation. Do not repeat that text or attach other text to it.',
    legend === '' ? '' : `Placeholders:\n${legend}`,
    `Paragraph:\n${prepared.promptText}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** Refuse unknown placeholders, repeated punctuation, and text attached to a placeholder. */
function checkPlaceholders(output: string, legend: readonly LegendEntry[]): void {
  const known = new Map(legend.map((entry) => [entry.placeholder, entry.text]));
  for (const match of output.matchAll(/⟦\d+⟧/g)) {
    const placeholder = match[0];
    const text = known.get(placeholder);
    if (text === undefined) {
      throw new Error(`The model output contains ${placeholder}, which prepare() did not create.`);
    }
    const start = match.index;
    const end = start + placeholder.length;
    const before = output[start - 1] ?? '';
    const after = output[end] ?? '';
    // The punctuation check looks past spaces, so `⟦1⟧ ,` repeats a comma too.
    const nextMark = output.slice(end).trimStart()[0] ?? '';
    const previousMark = output.slice(0, start).trimEnd().slice(-1);
    const first = text[0] ?? '';
    const last = text[text.length - 1] ?? '';
    if (PUNCTUATION.test(last) && nextMark === last) {
      throw new Error(
        `The model output repeats "${last}" after ${placeholder}, which ends with it.`
      );
    }
    if (PUNCTUATION.test(first) && previousMark === first) {
      throw new Error(
        `The model output repeats "${first}" before ${placeholder}, which starts with it.`
      );
    }
    if (!SPACING.has(before) || !SPACING.has(after)) {
      throw new Error(
        `The model output attaches text to ${placeholder}. Separate each placeholder with a space.`
      );
    }
  }
}

/** The text the model wrote, with each placeholder read as the text it stands for. */
function expandedOutput(output: string, legend: readonly LegendEntry[]): string {
  const known = new Map(legend.map((entry) => [entry.placeholder, entry.text]));
  return output.replace(/⟦\d+⟧/g, (placeholder) => known.get(placeholder) ?? placeholder);
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
function diff(units: readonly RewriteUnit[], tokens: readonly ModelToken[]): Step[] {
  const same = (u: number, t: number): boolean => {
    const unit = units[u]!;
    const token = tokens[t]!;
    if (unit.atom !== null || token.atom !== null) return unit.atom === token.atom;
    if (unit.text === token.text) return true;
    // At either end, a word matches without its trailing spacing.
    const atEnd = u === units.length - 1 || t === tokens.length - 1;
    return atEnd && coreOf(unit.text) === coreOf(token.text);
  };
  const rows = units.length + 1;
  const cols = tokens.length + 1;
  const length = new Uint32Array(rows * cols);
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

/** The hunks that turn the original units into the model tokens. */
function hunksOf(units: readonly RewriteUnit[], tokens: readonly ModelToken[]): Hunk[] {
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let carry = '';
  let next = 0;
  for (const step of diff(units, tokens)) {
    if (step.kind === 'keep') {
      open = null;
      const unit = units[step.unit]!;
      // Text after the last word needs the space the model wrote after it.
      if (spacingOf(unit.text) === '' && unit.atom === null) carry = spacingOf(step.token.text);
      next = step.unit + 1;
      continue;
    }
    if (step.kind === 'insert' && step.token.atom !== null) {
      throw new Error(`The model moved or repeated ⟦${step.token.atom}⟧.`);
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

/** Propose the model's rewrite as tracked changes, and return the proposed paragraph text. */
export async function apply(
  context: RequestContext,
  prepared: PreparedRewrite,
  modelOutput: string
): Promise<string> {
  const { paragraph, units } = prepared;
  const output = modelOutput.trim();
  checkPlaceholders(output, prepared.legend);
  const hunks = hunksOf(units, tokensOf(output));
  let wrote = false;
  try {
    // Apply from the last hunk to the first, so the ranges before each edit stay valid.
    for (const hunk of [...hunks].reverse()) {
      if (hunk.to > hunk.from) {
        const first = units[hunk.from]!.first;
        const last = units[hunk.to - 1]!.last;
        const target = first === last ? first : first.expandTo(last);
        if (hunk.text === '') target.delete();
        else target.insertText(hunk.text, 'Replace');
      } else if (units.length === 0) {
        paragraph.insertText(hunk.text, 'Start');
      } else if (hunk.from === 0) {
        units[0]!.first.insertText(hunk.text, 'Before');
      } else {
        units[hunk.from - 1]!.last.insertText(hunk.text, 'After');
      }
      await context.sync();
      wrote = true;
    }

    const proposed = paragraph.getReviewedText('Current');
    await context.sync();
    const wanted = expandedOutput(output, prepared.legend);
    if (proposed.value.trim() !== wanted) {
      throw new Error('The proposed paragraph differs from the model output.');
    }
    return proposed.value;
  } catch (error) {
    if (wrote) {
      try {
        await rollback(context, prepared);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'The rewrite failed, and so did its rollback.'
        );
      }
    }
    throw error;
  }
}

/**
 * Reject the tracked changes this author made in the paragraph. The paragraph had none when
 * prepare() read it, so they are the ones apply() wrote; other participants' changes stay.
 */
async function rollback(context: RequestContext, prepared: PreparedRewrite): Promise<void> {
  const { paragraphId, author } = prepared;
  for (let attempt = 1; ; attempt += 1) {
    // A read-only sync never fails on another participant's edit, and it brings this context
    // up to date, so the writes that follow it start from the current document.
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/uniqueLocalId');
    await context.sync();
    const paragraph = paragraphs.items.find((item) => item.uniqueLocalId === paragraphId);
    if (!paragraph) return;
    const revisions = paragraph.getRange('Whole').revisions;
    revisions.load('items/author');
    await context.sync();
    const own = revisions.items.filter((revision) => revision.author === author);
    if (own.length === 0) {
      if (revisions.items.length === 0) return;
      throw new Error(`The paragraph has no changes by ${author}. Pass the runtime's author.`);
    }
    for (const revision of own) revision.reject();
    try {
      await context.sync();
      return;
    } catch (error) {
      // Another participant edited again between the read and the reject. Read again.
      if (attempt === 3 || !isDocxEditorError(error) || error.code !== 'StaleDocument') {
        throw error;
      }
    }
  }
}

/** Rewrite the first paragraph of a document as tracked changes, and save the result. */
export async function proposeRewrite(
  bytes: Uint8Array,
  instruction: string,
  rewriteText: (prompt: string) => Promise<string>
): Promise<{ readonly proposed: string; readonly saved: Uint8Array }> {
  const author = 'Rewrite agent';
  const runtime = await DocxEditor.createServer(bytes, { author });
  try {
    const proposed = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = context.document.body.paragraphs.getFirst();
      const prepared = await prepare(context, paragraph, author);
      // Send only plain text to the model. The ranges stay in this run.
      return apply(context, prepared, await rewriteText(promptFor(prepared, instruction)));
    });
    return { proposed, saved: await runtime.save() };
  } finally {
    runtime.dispose();
  }
}
