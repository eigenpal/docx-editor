/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read a paragraph as units: words, the text that touches an atom, and the atoms themselves.
//
// `rewrite-layout.ts` works out from the texts where each control and object character sits.
// This module turns that into ranges with public calls only:
//
// - a content control answers its own range, and the range from the word's start to the
//   control's start says where the control sits in the word;
// - `search()` finds each object character (U+FFFC or U+000B);
// - `getTextRanges()` with every character of a word as an ending mark finds where a field sits
//   in its word, because a field never splits;
// - a field that shows no text sits between two words, where the range between them holds it;
// - `getRange('Start' | 'End')` with `expandTo()` addresses the text between atoms.
//
// Every part is read back. A cluster whose parts do not read as expected becomes one atom, with
// its trailing space still outside it. Five syncs, however long the paragraph.

import type {
  ContentControl,
  FieldCollection,
  InlinePictureCollection,
  Paragraph,
  Range,
  RangeCollection,
  RequestContext,
} from '@docx-editor.dev/editor-api';
import { RewriteError } from './rewrite-error.ts';
import {
  layoutWords,
  LINE_BREAK,
  OBJECT,
  type Cluster,
  type LayoutAtom,
} from './rewrite-layout.ts';
import type { RewritePlaceholderKind } from './rewrite-plan.ts';

const TRAILING_SPACING = /[ \t]+$/;
/** The most ending marks one `getTextRanges` call takes. */
const MAX_MARKS = 32;

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

/** A read-back check: the range must read `text`, and hold `fields` fields when given. */
interface Check {
  readonly range: Range;
  readonly text: string;
  readonly fields?: { readonly count: number; readonly collection: FieldCollection };
}

/** Parts, and the reads that check them. `null` parts mean the split cannot be made. */
interface Built {
  readonly parts: Part[] | null;
  readonly checks: readonly Check[];
}

interface ObjectKind {
  readonly pictures: InlinePictureCollection;
  readonly font: { readonly superscript: boolean | null };
}

interface WordRead {
  readonly word: Range;
  readonly fields: FieldCollection;
  readonly locked: ContentControl[];
  readonly objects: RangeCollection | null;
  readonly breaks: RangeCollection | null;
}

/** What the third sync reads for a word: control positions, object kinds, field pieces. */
interface WordDetail {
  readonly starts: Range[];
  readonly kinds: ObjectKind[];
  readonly pieces: RangeCollection | null;
  readonly spacing: RangeCollection | null;
}

/** What the fourth sync reads for a field word's pieces. */
interface PieceDetail {
  readonly fields: FieldCollection[];
  readonly lastChars: (RangeCollection | null)[];
}

const quoted = (value: string) => JSON.stringify(value);
const text = (range: Range, value: string): Part => ({ range, text: value, atom: null });

/** The range from an edge of `from` to an edge of `to`. */
function between(from: Range, fromEdge: 'Start' | 'End', to: Range, toEdge: 'Start' | 'End') {
  return from.getRange(fromEdge).expandTo(to.getRange(toEdge));
}

/** Checks for every part of `parts`, or for the parts that `filter` selects. */
function built(parts: Part[] | null, filter: (part: Part) => boolean = () => true): Built {
  return {
    parts,
    checks: (parts ?? []).filter(filter).map((part) => ({ range: part.range, text: part.text })),
  };
}

const fieldDescription = (codes: readonly string[], value: string) =>
  `field with code ${codes.map((code) => quoted(code.trim())).join(' and ')}, ` +
  (value === '' ? 'shows no text' : `reads ${quoted(value)}`);

/** Read the paragraph as units. Refuses a paragraph with pending tracked changes. */
export async function readUnits(
  context: RequestContext,
  paragraph: Paragraph
): Promise<{ units: Unit[]; paragraphId: string }> {
  // Sync 1: the words, and whether the paragraph has pending changes.
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

  // Sync 2: what every word holds, where its object characters are, and the fields that show
  // no text, which sit between words.
  const pending = words.items.map((word) => {
    const fields = word.fields;
    const controls = word.contentControls;
    fields.load('items/code');
    controls.load('items/tag,items/title,items/cannotEdit,items/text');
    const objects = word.text.includes(OBJECT) ? word.search(OBJECT) : null;
    const breaks = word.text.includes(LINE_BREAK) ? word.search(LINE_BREAK) : null;
    objects?.load('items');
    breaks?.load('items');
    return { word, fields, controls, objects, breaks };
  });
  const gaps = Array.from({ length: words.items.length + 1 }, (_, index) => {
    const before = words.items[index - 1];
    const after = words.items[index];
    const from = before ? before.getRange('End') : paragraph.getRange('Start');
    const range = from.expandTo(after ? after.getRange('Start') : paragraph.getRange('End'));
    const fields = range.fields;
    fields.load('items/code');
    return { range, fields };
  });
  await context.sync();
  const reads: WordRead[] = pending.map(({ controls, ...rest }) => ({
    ...rest,
    locked: controls.items.filter((control) => control.cannotEdit),
  }));

  // Sync 3: where each control starts, what each object is, a field word's pieces, and the
  // trailing spacing of every word that holds an atom.
  const details: WordDetail[] = reads.map((read) => {
    const starts = read.locked.map((control) => {
      const range = between(read.word, 'Start', control.getRange('Whole'), 'Start');
      range.load('text');
      return range;
    });
    const kinds = (read.objects?.items ?? []).map((object): ObjectKind => {
      const pictures = object.inlinePictures;
      const font = object.font;
      pictures.load('items/altTextDescription');
      font.load('superscript');
      return { pictures, font };
    });
    const marks = [...new Set(read.word.text)];
    const isField = read.fields.items.length === 1 && read.locked.length === 0 && !read.objects;
    const pieces = isField && marks.length <= MAX_MARKS ? read.word.getTextRanges(marks) : null;
    pieces?.load('items/text');
    const hasAtom =
      read.fields.items.length > 0 || read.locked.length > 0 || read.objects || read.breaks;
    const space = TRAILING_SPACING.exec(read.word.text)?.[0] ?? '';
    const spacing = hasAtom && space !== '' ? read.word.search(space) : null;
    spacing?.load('items');
    return { starts, kinds, pieces, spacing };
  });
  await context.sync();
  const clusters = layoutWords(
    reads.map((read, index) => ({
      text: read.word.text,
      controls: read.locked.map((control, at) => ({
        text: control.text,
        start: details[index]!.starts[at]!.text.length,
      })),
      fields: read.fields.items.length,
    }))
  );

  // Sync 4: which piece of a field word holds the field, and the last character of each piece.
  const pieceDetails = details.map((detail): PieceDetail | null => {
    if (!detail.pieces) return null;
    const fields = detail.pieces.items.map((piece) => {
      const found = piece.fields;
      found.load('items');
      return found;
    });
    const lastChars = detail.pieces.items.map((piece) => {
      if (piece.text.length < 2) return null;
      const matches = piece.search(piece.text.slice(-1));
      matches.load('items');
      return matches;
    });
    return { fields, lastChars };
  });
  await context.sync();

  // Sync 5: read every split back, and every fallback.
  const planned = clusters.map((cluster) => {
    const split = splitOf(cluster, reads, details, pieceDetails);
    const fallback = built(wholeParts(cluster, reads, details));
    return { cluster, split, fallback };
  });
  const checks = planned.flatMap(({ split, fallback }) => [
    ...split.flatMap((option) => option.checks),
    ...fallback.checks,
  ]);
  for (const check of checks) {
    check.range.load('text');
    check.fields?.collection.load('items');
  }
  await context.sync();
  const exact = (option: Built) =>
    option.parts !== null &&
    option.checks.every(
      (check) =>
        check.range.text === check.text &&
        (check.fields === undefined || check.fields.collection.items.length === check.fields.count)
    );

  const parts: Part[] = [];
  const gapPart = (index: number) => {
    const gap = gaps[index]!;
    if (gap.fields.items.length === 0) return;
    const description = fieldDescription(
      gap.fields.items.map((field) => field.code),
      ''
    );
    parts.push({ range: gap.range, text: '', atom: () => ({ kind: 'field', description }) });
  };
  for (const { cluster, split, fallback } of planned) {
    gapPart(cluster.kind === 'atoms' || cluster.kind === 'whole' ? cluster.first : cluster.word);
    const chosen = split.find(exact) ?? (exact(fallback) ? fallback : null);
    parts.push(...(chosen?.parts ?? wholeParts(cluster, reads, null)));
  }
  gapPart(words.items.length);

  let atoms = 0;
  const units = parts.map((part): Unit => {
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

/** The ways to split one cluster, in order of preference. */
function splitOf(
  cluster: Cluster,
  reads: readonly WordRead[],
  details: readonly WordDetail[],
  pieceDetails: readonly (PieceDetail | null)[]
): Built[] {
  if (cluster.kind === 'text') {
    const { word } = reads[cluster.word]!;
    return [{ parts: [text(word, word.text)], checks: [] }];
  }
  if (cluster.kind === 'whole') return [];
  if (cluster.kind === 'field') {
    return splitField(reads[cluster.word]!, details[cluster.word]!, pieceDetails[cluster.word]);
  }
  return [splitAtoms(cluster, reads, details)];
}

/**
 * A word that holds one field, split by its pieces: the pieces before the one that holds the
 * field are text. The field's piece holds the field and at most the one character after it, so
 * two splits are checked: the piece without its last character, and the whole piece.
 */
function splitField(
  read: WordRead,
  detail: WordDetail,
  pieces: PieceDetail | null | undefined
): Built[] {
  const items = detail.pieces?.items ?? [];
  if (!pieces || items.length === 0) return [];
  const at = pieces.fields.findIndex((found) => found.items.length > 0);
  if (at < 0) return [];
  const { word } = read;
  const field = read.fields.items[0]!;
  const prefix = items
    .slice(0, at)
    .map((piece) => piece.text)
    .join('');
  const piece = items[at]!;
  const rest = items
    .slice(at + 1)
    .map((item) => item.text)
    .join('');
  const start = at === 0 ? word.getRange('Start') : items[at - 1]!.getRange('End');
  const options: Built[] = [];
  const option = (end: Range, result: string, tail: string, tailStart: Range) => {
    const atom = start.expandTo(end);
    const parts: Part[] = [];
    if (prefix !== '') parts.push(text(between(word, 'Start', items[at - 1]!, 'End'), prefix));
    const description = fieldDescription([field.code], result);
    parts.push({ range: atom, text: result, atom: () => ({ kind: 'field', description }) });
    if (tail !== '') parts.push(text(tailStart.expandTo(word.getRange('End')), tail));
    const checks = parts.map(
      (part): Check =>
        part.range === atom
          ? { range: atom, text: result, fields: { count: 1, collection: atom.fields } }
          : { range: part.range, text: part.text }
    );
    options.push({ parts, checks });
  };
  const lastChar = pieces.lastChars[at]?.items.at(-1);
  if (lastChar) {
    const last = piece.text.slice(-1);
    option(
      lastChar.getRange('Start'),
      piece.text.slice(0, -1),
      last + rest,
      lastChar.getRange('Start')
    );
  }
  option(piece.getRange('End'), piece.text, rest, piece.getRange('End'));
  return options;
}

/** A cluster of locked controls and object characters with text between them. */
function splitAtoms(
  cluster: Extract<Cluster, { kind: 'atoms' }>,
  reads: readonly WordRead[],
  details: readonly WordDetail[]
): Built {
  const ranges = cluster.atoms.map((atom) => rangeOf(atom, reads));
  if (ranges.some((range) => range === null)) return built(null);
  const parts: Part[] = [];
  const controls = new Set<Part>();
  for (const entry of cluster.order) {
    if ('atom' in entry) {
      const atom = cluster.atoms[entry.atom]!;
      const value = cluster.text.slice(atom.start, atom.end);
      const part: Part = {
        range: ranges[entry.atom]!,
        text: value,
        atom: atomInfo(atom, reads, details),
      };
      if (atom.source.type === 'control') controls.add(part);
      parts.push(part);
      continue;
    }
    const piece = cluster.pieces[entry.piece]!;
    const word = reads[piece.word]!.word;
    const from =
      piece.after === null ? word.getRange('Start') : ranges[piece.after]!.getRange('End');
    const to =
      piece.before === null ? word.getRange('End') : ranges[piece.before]!.getRange('Start');
    parts.push(text(from.expandTo(to), cluster.text.slice(piece.start, piece.end)));
  }
  // A control reads its own text; every other part is checked.
  return built(parts, (part) => !controls.has(part));
}

/** The range of one atom, or null when its word's search did not find it. */
function rangeOf(atom: LayoutAtom, reads: readonly WordRead[]): Range | null {
  const read = reads[atom.source.word]!;
  if (atom.source.type === 'control') {
    return read.locked[atom.source.index]?.getRange('Whole') ?? null;
  }
  const found = atom.source.type === 'object' ? read.objects : read.breaks;
  return found?.items[atom.source.index] ?? null;
}

/** What an atom is, read after the third sync. */
function atomInfo(
  atom: LayoutAtom,
  reads: readonly WordRead[],
  details: readonly WordDetail[]
): () => AtomInfo {
  if (atom.source.type === 'break') {
    return () => ({ kind: 'line-break', description: 'line break' });
  }
  if (atom.source.type === 'control') {
    const control = reads[atom.source.word]!.locked[atom.source.index]!;
    const name = control.tag || control.title;
    const description =
      `locked content control${name ? ` named ${quoted(name)}` : ''}, reads ` +
      quoted(control.text);
    return () => ({ kind: 'content-control', description });
  }
  const kind = details[atom.source.word]!.kinds[atom.source.index];
  return () => {
    const picture = kind?.pictures.items[0];
    if (picture) {
      const alt = picture.altTextDescription;
      return {
        kind: 'picture',
        description: alt ? `picture, described as ${quoted(alt)}` : 'picture',
      };
    }
    // A note reference mark is superscript; an equation is not.
    return kind?.font.superscript === true
      ? { kind: 'note-reference', description: 'footnote or endnote reference mark' }
      : { kind: 'equation', description: 'equation' };
  };
}

/**
 * A cluster as one atom, with its trailing space or tab outside it when the third sync found
 * it, so a model that keeps the space does not double it.
 */
function wholeParts(
  cluster: Cluster,
  reads: readonly WordRead[],
  details: readonly WordDetail[] | null
): Part[] {
  const start = cluster.kind === 'text' || cluster.kind === 'field' ? cluster.word : cluster.first;
  const end = cluster.kind === 'text' || cluster.kind === 'field' ? cluster.word : cluster.last;
  const words = reads.slice(start, end + 1).map((read) => read.word);
  const value = words.map((word) => word.text).join('');
  const firstWord = words[0]!;
  const lastWord = words[words.length - 1]!;
  if (cluster.kind === 'text') return [text(firstWord, value)];
  const codes = reads.slice(start, end + 1).flatMap((read) => read.fields.items.map((f) => f.code));
  const core = value.replace(TRAILING_SPACING, '');
  const space = value.slice(core.length);
  const info: AtomInfo =
    codes.length > 0
      ? { kind: 'field', description: `${fieldDescription(codes, core)}, with the text beside it` }
      : {
          kind: 'content-control',
          description: `content that cannot change, reads ${quoted(core)}`,
        };
  const spacing = details?.[end]?.spacing;
  const match = spacing?.items[spacing.items.length - 1];
  if (space !== '' && match) {
    return [
      { range: between(firstWord, 'Start', match, 'Start'), text: core, atom: () => info },
      text(between(match, 'Start', lastWord, 'End'), space),
    ];
  }
  const range = firstWord === lastWord ? firstWord : firstWord.expandTo(lastWord);
  return [{ range, text: value, atom: () => info }];
}
