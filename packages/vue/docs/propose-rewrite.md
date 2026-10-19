<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Propose an AI rewrite as tracked changes

An agent that rewrites a paragraph should propose the smallest set of tracked changes, not one replacement of the whole paragraph. This recipe splits the paragraph into word ranges, sends plain text to a model, compares the model output with the original words, and applies each difference as a tracked change. It uses only Office.js-shaped calls from `@docx-editor.dev/editor-api`.

The recipe has two steps:

1. `prepare(context, paragraph)` splits the paragraph with `getTextRanges([' ', '\t'])`, and then reads the `fields` and `contentControls` of every word range in one sync. It returns `promptText` for the model and the word list.
1. `apply(context, prepared, modelOutput)` compares the model output with the original words, applies each difference from the last one to the first, and then checks the result with `getReviewedText('Current')`.

## Keep atoms whole

Some content must change as one unit or not at all. The recipe calls each of these an atom, and shows it to the model as a numbered placeholder, such as `⟦1⟧`:

| Content | Reads in a word range as | Why it is an atom |
| --- | --- | --- |
| Field | Its result, which can contain spaces, such as `Section 4.2` | The result is computed; editing its text does not change the field. |
| Equation or picture | U+FFFC | One character that has no words to edit. |
| Content-locked control | Its text, split into the words around it | Edits inside it fail with `edit.protected-content`. |

A placeholder that the model keeps is never changed. A placeholder that the model leaves out deletes that whole atom as one tracked deletion. A tracked deletion over an equation strikes the whole equation, and a tracked deletion or replacement that covers a whole content-locked control proposes removing the control. If the model moves or repeats a placeholder, `apply()` throws before it writes anything.

A word directly attached to an atom, with no space between them, belongs to the atom's range, so the model cannot change that word.

## Map differences to calls

Each word range keeps the space or tab after it. Every difference between the original words and the model output becomes one call:

| Difference | Call |
| --- | --- |
| Replace one or more words | `first.expandTo(last).insertText(text, 'Replace')` |
| Delete one or more words | `first.expandTo(last).delete()` |
| Insert before the first word | `words[0].insertText(text, 'Before')` |
| Insert after a word | `word.insertText(text, 'After')` |
| Insert after the last word | `last.insertText(' ' + text, 'After')`, because the last word has no space after it |

Because each word range ends with its space, deleting a word also deletes its space, and a replacement text ends with a space too. The paragraph keeps single spaces.

A word range is a snapshot. An edit before a range in its paragraph makes the range fail with `StaleDocument`. The recipe applies the differences from the last one to the first, one sync each, so every range that it read before the first edit stays valid.

## Code

The following code is the complete recipe:

```ts
import {
  DocxEditor,
  type Paragraph,
  type Range,
  type RequestContext,
} from '@docx-editor.dev/editor-api';

/** One word, or one atom that the model must keep whole. */
export interface RewriteUnit {
  readonly first: Range;
  readonly last: Range;
  /** The text the paragraph reads for this unit, with its trailing space or tab. */
  readonly text: string;
  /** The placeholder number of an atom, or null for a word. */
  readonly atom: number | null;
}

export interface PreparedRewrite {
  readonly paragraph: Paragraph;
  readonly units: readonly RewriteUnit[];
  /** The paragraph text for the model, with each atom shown as ⟦n⟧. */
  readonly promptText: string;
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

/** Split a paragraph into words and atoms, and build the text for the model. */
export async function prepare(
  context: RequestContext,
  paragraph: Paragraph
): Promise<PreparedRewrite> {
  const words = paragraph.getTextRanges([' ', '\t']);
  words.load('items/text');
  paragraph.load('text');
  const current = paragraph.getReviewedText('Current');
  await context.sync();
  if (current.value !== paragraph.text) {
    throw new Error('Decide the pending changes in this paragraph before you rewrite it.');
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
  return { paragraph, units, promptText };
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
  const tokens = tokensOf(modelOutput.replace(/\s+$/, ''));
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
}

/** Rewrite the first paragraph of a document as tracked changes, and save the result. */
export async function proposeRewrite(
  bytes: Uint8Array,
  rewriteText: (promptText: string) => Promise<string>
): Promise<{ readonly proposed: string; readonly saved: Uint8Array }> {
  const runtime = await DocxEditor.createServer(bytes, { author: 'Rewrite agent' });
  try {
    const proposed = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = context.document.body.paragraphs.getFirst();
      const prepared = await prepare(context, paragraph);
      // Send only plain text to the model. The ranges stay in this run.
      return apply(context, prepared, await rewriteText(prepared.promptText));
    });
    return { proposed, saved: await runtime.save() };
  } finally {
    runtime.dispose();
  }
}
```

`prepare()` refuses a paragraph that already has pending changes, because its word ranges would join deleted and inserted text. Decide those changes first, or rewrite another paragraph.

`apply()` compares `getReviewedText('Current')` with the text that it expects. If they differ, it throws. Never turn tracking off to make a refused edit succeed.

For the word-range rules, see [Text and ranges](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges#split-text-into-word-ranges). For tracked edit limits, see [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions).
