/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The code of docs/site/content/recipes/propose-rewrite.mdx. The recipe test checks that the
// page shows this file exactly, below this header, with the package name in place of the
// relative import: the package resolves its own name to its build, not to these sources.

import { DocxEditor, type Paragraph, type Range, type RequestContext } from '../../../index.ts';

/** One word, or one atom that the model must keep whole. */
export interface RewriteUnit {
  readonly first: Range;
  readonly last: Range;
  /** The text the paragraph reads for this unit, with its trailing space or tab. */
  readonly text: string;
  /** The placeholder number of an atom, or null for a word. */
  readonly atom: number | null;
}

/** What one placeholder stands for: the exact text, with any punctuation attached to it. */
export interface LegendEntry {
  readonly placeholder: string;
  readonly text: string;
}

export interface PreparedRewrite {
  readonly paragraph: Paragraph;
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

/** Split a paragraph into words and atoms, and build the text for the model. */
export async function prepare(
  context: RequestContext,
  paragraph: Paragraph
): Promise<PreparedRewrite> {
  const words = paragraph.getTextRanges([' ', '\t']);
  const revisions = paragraph.getRange('Whole').revisions;
  words.load('items/text');
  revisions.load('items/type,items/author');
  await context.sync();
  // apply() rolls back by rejecting every change in the paragraph, so it must start with none.
  if (revisions.items.length > 0) {
    throw new Error('Decide the tracked changes in this paragraph before you rewrite it.');
  }

  // One sync reads the fields and content controls of every word.
  const reads = words.items.map((word) => {
    const fields = word.fields;
    const controls = word.contentControls;
    fields.load('items');
    controls.load('items/tag,items/cannotEdit,items/text');
    return { word, fields, controls };
  });
  await context.sync();

  const units: RewriteUnit[] = [];
  let atoms = 0;
  let lockedKey: string | null = null;
  for (const { word, fields, controls } of reads) {
    const locked = controls.items.find((control) => control.cannotEdit);
    const key = locked ? `${locked.tag}\u0000${locked.text}` : null;
    const previous = units[units.length - 1];
    if (key !== null && key === lockedKey && previous) {
      // The words of one locked control form one atom.
      units[units.length - 1] = { ...previous, last: word, text: previous.text + word.text };
      continue;
    }
    lockedKey = key;
    const atom = key !== null || fields.items.length > 0 || word.text.includes('￼');
    units.push({ first: word, last: word, text: word.text, atom: atom ? ++atoms : null });
  }
  const promptText = units
    .map((unit) => (unit.atom === null ? unit.text : `⟦${unit.atom}⟧${spacingOf(unit.text)}`))
    .join('');
  const legend = units.flatMap((unit) =>
    unit.atom === null ? [] : [{ placeholder: `⟦${unit.atom}⟧`, text: coreOf(unit.text) }]
  );
  return { paragraph, units, promptText, legend };
}

/** A prompt that shows the model what each placeholder already contains. */
export function promptFor(prepared: PreparedRewrite, instruction: string): string {
  const legend = prepared.legend
    .map((entry) => `${entry.placeholder} = ${JSON.stringify(entry.text)}`)
    .join('\n');
  return [
    instruction,
    'Return only the rewritten paragraph. Keep each placeholder, such as ⟦1⟧, exactly as ' +
      'written, or leave it out to delete what it stands for. Each placeholder already ' +
      'contains the text listed for it, including its punctuation. Do not repeat that text.',
    legend === '' ? '' : `Placeholders:\n${legend}`,
    `Paragraph:\n${prepared.promptText}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** Refuse placeholders that prepare() did not create, and punctuation the atom already has. */
function checkPlaceholders(output: string, legend: readonly LegendEntry[]): void {
  const known = new Map(legend.map((entry) => [entry.placeholder, entry.text]));
  for (const match of output.matchAll(/⟦\d+⟧/g)) {
    const placeholder = match[0];
    const text = known.get(placeholder);
    if (text === undefined) {
      throw new Error(`The model output contains ${placeholder}, which prepare() did not create.`);
    }
    const before = output[match.index - 1] ?? '';
    const after = output[match.index + placeholder.length] ?? '';
    const first = text[0] ?? '';
    const last = text[text.length - 1] ?? '';
    if (PUNCTUATION.test(last) && after === last) {
      throw new Error(
        `The model output repeats "${last}" after ${placeholder}, which ends with it.`
      );
    }
    if (PUNCTUATION.test(first) && before === first) {
      throw new Error(
        `The model output repeats "${first}" before ${placeholder}, which starts with it.`
      );
    }
  }
}

/** Split the model output the way `getTextRanges([' ', '\t'])` splits text. */
function tokensOf(output: string): ModelToken[] {
  const tokens: ModelToken[] = [];
  for (const piece of output.match(/[^ \t]*[ \t]|[^ \t]+$/g) ?? []) {
    for (const part of piece.split(/(⟦\d+⟧)/)) {
      if (part === '') continue;
      const placeholder = /^⟦(\d+)⟧$/.exec(part);
      const previous = tokens[tokens.length - 1];
      if (!placeholder && previous?.atom != null && coreOf(part) === '') {
        // Spacing after a placeholder belongs to the atom, which keeps its own.
        tokens[tokens.length - 1] = { ...previous, text: previous.text + part };
        continue;
      }
      tokens.push({ text: part, atom: placeholder ? Number(placeholder[1]) : null });
    }
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

/** Propose the model's rewrite as tracked changes, and return the proposed paragraph text. */
export async function apply(
  context: RequestContext,
  prepared: PreparedRewrite,
  modelOutput: string
): Promise<string> {
  const { paragraph, units } = prepared;
  const output = modelOutput.replace(/\s+$/, '');
  checkPlaceholders(output, prepared.legend);
  const tokens = tokensOf(output);
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let expected = '';
  let carry = '';
  let next = 0;
  for (const step of diff(units, tokens)) {
    if (step.kind === 'keep') {
      open = null;
      const unit = units[step.unit]!;
      expected += unit.text;
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
      expected += carry;
      carry = '';
      hunks.push(open);
    }
    if (step.kind === 'delete') {
      open.to = step.unit + 1;
      next = step.unit + 1;
    } else {
      open.text += step.token.text;
      expected += step.token.text;
    }
  }

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
    }

    const proposed = paragraph.getReviewedText('Current');
    await context.sync();
    if (proposed.value !== expected) {
      throw new Error('The proposed paragraph differs from the model output.');
    }
    return proposed.value;
  } catch (error) {
    // prepare() accepted the paragraph only without tracked changes, so every change in it now
    // came from this call. Rejecting them leaves the paragraph as it was.
    paragraph.getRange('Whole').revisions.rejectAll();
    try {
      await context.sync();
    } catch (rollback) {
      throw new AggregateError([error, rollback], 'The rewrite failed, and so did its rollback.');
    }
    throw error;
  }
}

/** Rewrite the first paragraph of a document as tracked changes, and save the result. */
export async function proposeRewrite(
  bytes: Uint8Array,
  instruction: string,
  rewriteText: (prompt: string) => Promise<string>
): Promise<{ readonly proposed: string; readonly saved: Uint8Array }> {
  const runtime = await DocxEditor.createServer(bytes, { author: 'Rewrite agent' });
  try {
    const proposed = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = context.document.body.paragraphs.getFirst();
      const prepared = await prepare(context, paragraph);
      // Send only plain text to the model. The ranges stay in this run.
      return apply(context, prepared, await rewriteText(promptFor(prepared, instruction)));
    });
    return { proposed, saved: await runtime.save() };
  } finally {
    runtime.dispose();
  }
}
