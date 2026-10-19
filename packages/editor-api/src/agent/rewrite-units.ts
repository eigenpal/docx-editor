/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read a paragraph as units: words, the text that touches an atom, and the atoms themselves.
//
// `getTextRanges([' ', '\t'])` keeps an atom inside the word it touches, so `Section 4.2,` is one
// range when a field reads `Section 4.2`. Each such word is split into its parts with public
// calls only: a content control answers its own range, `search(OBJECT)` finds an equation, a
// picture, or a note reference, and `search()` for the punctuation around a field finds where
// the field ends. `getRange('Start' | 'End')` and `expandTo()` then address the text before and
// after the atom. Every split part is read back; if any part does not read as expected, each
// word that holds an atom stays one atom instead.
//
// Four syncs, however long the paragraph.

import type {
  ContentControl,
  ContentControlCollection,
  FieldCollection,
  InlinePictureCollection,
  Paragraph,
  Range,
  RangeCollection,
  RequestContext,
} from '@docx-editor.dev/editor-api';
import { RewriteError } from './rewrite-error.ts';
import type { RewritePlaceholderKind } from './rewrite-plan.ts';

/** U+FFFC, the character an equation, a picture, or a note reference reads as. */
const OBJECT = String.fromCharCode(0xfffc);
const LEADING_PUNCTUATION = /^[\p{Ps}\p{Pi}"'([]+/u;
const TRAILING_TEXT = /\p{P}*[ \t]*$/u;

/** One unit and the range that addresses it. */
export interface Unit {
  readonly range: Range;
  /** The text the paragraph reads for this unit. */
  readonly text: string;
  /** The placeholder number of an atom, or null for text. */
  readonly atom: number | null;
  readonly kind: RewritePlaceholderKind | null;
  readonly description: string;
}

/** What an atom is. */
interface AtomInfo {
  readonly kind: RewritePlaceholderKind;
  readonly description: string;
}

/** A unit before its texts are read back. `atom` is called after the last sync. */
interface Part {
  readonly range: Range;
  readonly text: string;
  readonly atom: (() => AtomInfo) | null;
}

interface WordRead {
  readonly word: Range;
  readonly fields: FieldCollection;
  readonly pictures: InlinePictureCollection;
  readonly controls: ContentControlCollection;
  readonly objects: RangeCollection | null;
}

interface ObjectKind {
  readonly pictures: InlinePictureCollection;
  readonly font: { readonly superscript: boolean | null };
}

/** A word whose parts the third sync finds. */
type Plan =
  | { readonly kind: 'text'; readonly read: WordRead }
  | {
      readonly kind: 'locked';
      readonly read: WordRead;
      readonly control: ContentControl;
      readonly last: Range;
      readonly text: string;
    }
  | {
      readonly kind: 'field';
      readonly read: WordRead;
      readonly lead: string;
      readonly trail: string;
      readonly before: RangeCollection | null;
      readonly after: RangeCollection | null;
    }
  | { readonly kind: 'objects'; readonly read: WordRead; readonly kinds: readonly ObjectKind[] }
  | { readonly kind: 'whole'; readonly read: WordRead };

const quoted = (value: string) => JSON.stringify(value);

const text = (range: Range, value: string): Part => ({ range, text: value, atom: null });

const isLocked = (control: ContentControl, like: ContentControl) =>
  control.cannotEdit && control.tag === like.tag && control.text === like.text;

/** The range from an edge of `from` to an edge of `to`. */
function between(from: Range, fromEdge: 'Start' | 'End', to: Range, toEdge: 'Start' | 'End') {
  return from.getRange(fromEdge).expandTo(to.getRange(toEdge));
}

/** Read the paragraph as units. Refuses a paragraph with pending tracked changes. */
export async function readUnits(
  context: RequestContext,
  paragraph: Paragraph
): Promise<{ units: Unit[]; paragraphId: string }> {
  const words = paragraph.getTextRanges([' ', '\t']);
  const revisions = paragraph.getRange('Whole').revisions;
  words.load('items/text');
  revisions.load('items');
  paragraph.load('uniqueLocalId');
  await context.sync();
  // The rollback rejects only the changes this rewrite made, and a word range over pending
  // changes joins deleted and inserted text, so the paragraph must start with none.
  if (revisions.items.length > 0) {
    throw new RewriteError(
      'pending-changes',
      'The paragraph has tracked changes. Accept or reject them before you rewrite it.'
    );
  }

  // Sync 2: what every word holds, and where its objects are.
  const reads: WordRead[] = words.items.map((word) => {
    const fields = word.fields;
    const pictures = word.inlinePictures;
    const controls = word.contentControls;
    fields.load('items/code');
    pictures.load('items');
    controls.load('items/tag,items/title,items/cannotEdit,items/text');
    const objects = word.text.includes(OBJECT) ? word.search(OBJECT) : null;
    objects?.load('items');
    return { word, fields, pictures, controls, objects };
  });
  await context.sync();

  // Sync 3: where each field ends, and what each object is.
  const plans: Plan[] = [];
  for (let index = 0; index < reads.length; index += 1) {
    const read = reads[index]!;
    const locked = read.controls.items.find((control) => control.cannotEdit);
    if (locked) {
      // The words of one locked control form one atom.
      let last = index;
      while (reads[last + 1]?.controls.items.some((control) => isLocked(control, locked)))
        last += 1;
      const value = reads
        .slice(index, last + 1)
        .map((item) => item.word.text)
        .join('');
      plans.push({ kind: 'locked', read, control: locked, last: reads[last]!.word, text: value });
      index = last;
    } else plans.push(planWord(read));
  }
  await context.sync();

  // Sync 4: read every split part back.
  const parts: Part[] = [];
  const checks: { range: Range; text: string }[] = [];
  for (const plan of plans) parts.push(...partsOf(plan, checks));
  for (const check of checks) check.range.load('text');
  await context.sync();
  const exact = checks.every((check) => check.range.text === check.text);
  let atoms = 0;
  const units = (exact ? parts : plans.flatMap(wholeParts)).map((part): Unit => {
    const info = part.atom?.() ?? null;
    return {
      range: part.range,
      text: part.text,
      atom: info ? ++atoms : null,
      kind: info?.kind ?? null,
      description: info?.description ?? '',
    };
  });
  return { units, paragraphId: paragraph.uniqueLocalId };
}

/** Queue the third sync's reads for one word that is not in a locked control. */
function planWord(read: WordRead): Plan {
  const fields = read.fields.items.length;
  const objects = read.objects?.items ?? [];
  if (fields === 0 && objects.length === 0) return { kind: 'text', read };
  if (fields === 1 && objects.length === 0) {
    const value = read.word.text;
    const lead = LEADING_PUNCTUATION.exec(value)?.[0] ?? '';
    const trail = TRAILING_TEXT.exec(value.slice(lead.length))?.[0] ?? '';
    const before = lead === '' ? null : read.word.search(lead);
    const after = trail === '' ? null : read.word.search(trail);
    before?.load('items');
    after?.load('items');
    return { kind: 'field', read, lead, trail, before, after };
  }
  if (fields === 0) {
    const kinds = objects.map((object): ObjectKind => {
      const pictures = object.inlinePictures;
      const font = object.font;
      pictures.load('items/altTextDescription');
      font.load('superscript');
      return { pictures, font };
    });
    return { kind: 'objects', read, kinds };
  }
  return { kind: 'whole', read };
}

/** The parts of one planned word, and the reads that check them. */
function partsOf(plan: Plan, checks: { range: Range; text: string }[]): Part[] {
  const { word } = plan.read;
  const value = word.text;
  const check = (part: Part): Part => {
    checks.push({ range: part.range, text: part.text });
    return part;
  };
  switch (plan.kind) {
    case 'text':
      return [text(word, value)];
    case 'whole':
      return wholeParts(plan);
    case 'locked': {
      const { control } = plan;
      const at = plan.text.indexOf(control.text);
      if (at < 0) return wholeParts(plan);
      const whole = control.getRange('Whole');
      const name = control.tag || control.title;
      const description =
        `locked content control${name ? ` ${quoted(name)}` : ''}, reads ` + quoted(control.text);
      const parts: Part[] = [];
      const before = plan.text.slice(0, at);
      const after = plan.text.slice(at + control.text.length);
      if (before !== '') parts.push(check(text(between(word, 'Start', whole, 'Start'), before)));
      parts.push({
        range: whole,
        text: control.text,
        atom: () => ({ kind: 'content-control', description }),
      });
      if (after !== '') parts.push(check(text(between(whole, 'End', plan.last, 'End'), after)));
      return parts;
    }
    case 'field': {
      // Each search answers its match nearest the field: the first leading one, the last
      // trailing one.
      const lead = plan.before?.items[0];
      const trail = plan.after?.items[plan.after.items.length - 1];
      if ((plan.lead !== '' && !lead) || (plan.trail !== '' && !trail)) return wholeParts(plan);
      const field = plan.read.fields.items[0]!;
      const result = value.slice(plan.lead.length, value.length - plan.trail.length);
      const start = lead ? lead.getRange('End') : word.getRange('Start');
      const end = trail ? trail.getRange('Start') : word.getRange('End');
      const description = `field ${field.code.trim()}, reads ${quoted(result)}`;
      const parts: Part[] = [];
      if (lead) parts.push(check(text(between(word, 'Start', lead, 'End'), plan.lead)));
      parts.push(
        check({
          range: start.expandTo(end),
          text: result,
          atom: () => ({ kind: 'field', description }),
        })
      );
      if (trail) parts.push(check(text(between(trail, 'Start', word, 'End'), plan.trail)));
      return parts;
    }
    case 'objects': {
      // Text and objects alternate: text before the first object, between objects, and after.
      const pieces = value.split(OBJECT);
      const objects = plan.read.objects!.items;
      const parts: Part[] = [];
      let cursor = word.getRange('Start');
      objects.forEach((object, at) => {
        const before = pieces[at]!;
        if (before !== '') {
          parts.push(check(text(cursor.expandTo(object.getRange('Start')), before)));
        }
        const kind = plan.kinds[at]!;
        parts.push(check({ range: object, text: OBJECT, atom: () => objectInfo(kind) }));
        cursor = object.getRange('End');
      });
      const rest = pieces[pieces.length - 1]!;
      if (rest !== '') parts.push(check(text(cursor.expandTo(word.getRange('End')), rest)));
      return parts;
    }
  }
}

/** What an object is: a picture, a note reference mark, which is superscript, or an equation. */
function objectInfo({ pictures, font }: ObjectKind): AtomInfo {
  const picture = pictures.items[0];
  if (picture) {
    const alt = picture.altTextDescription;
    return {
      kind: 'picture',
      description: alt ? `picture, described as ${quoted(alt)}` : 'picture',
    };
  }
  return font.superscript === true
    ? { kind: 'note-reference', description: 'footnote or endnote reference mark' }
    : { kind: 'equation', description: 'equation' };
}

/** A planned word as it reads, with a word that holds an atom as one atom. */
function wholeParts(plan: Plan): Part[] {
  const { word } = plan.read;
  if (plan.kind === 'text') return [text(word, word.text)];
  if (plan.kind === 'locked') {
    const description = `locked content control, reads ${quoted(plan.text)}`;
    return [
      {
        range: word.expandTo(plan.last),
        text: plan.text,
        atom: () => ({ kind: 'content-control', description }),
      },
    ];
  }
  const field = plan.read.fields.items[0];
  const info: AtomInfo = field
    ? {
        kind: 'field',
        description: `field ${field.code.trim()} with the text beside it, reads ${quoted(word.text)}`,
      }
    : { kind: 'equation', description: `content that cannot change, reads ${quoted(word.text)}` };
  return [{ range: word, text: word.text, atom: () => info }];
}
