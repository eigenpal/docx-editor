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
// - the paragraph's fields and controls are read once; a paragraph without them reads nothing
//   per word. With them, groups of words are read first, and only the words of a group that
//   holds a field or a locked control are read one by one;
// - a content control answers its own range, and the range from the word's start to the
//   control's start says where the control sits in the word;
// - `search()` finds each object character (U+FFFC or U+000B);
// - `getTextRanges()` with every character of a word as an ending mark splits a word that holds
//   a field, because a field never splits: a piece that holds a field holds it and at most the
//   one character after it;
// - a field that shows no text sits between two words, or between two pieces of a word, where
//   the range between them holds it. Fields in one such place share that range, so the model can
//   keep or delete them only together;
// - `getRange('Start' | 'End')` with `expandTo()` addresses the text between atoms.
//
// Every part is read back. A word whose parts do not read as expected becomes one atom, with its
// trailing space still outside it. Six syncs, however long the paragraph.

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
import { helperSync } from './rewrite-guard.ts';
import { RewriteError } from './rewrite-error.ts';
import {
  layoutWords,
  LINE_BREAK,
  OBJECT,
  type Cluster,
  type LayoutAtom,
} from './rewrite-layout.ts';
import { checkLength, type RewritePlaceholderKind } from './rewrite-plan.ts';

const TRAILING_SPACING = /[ \t]+$/;
/** The most ending marks one `getTextRanges` call takes. */
const MAX_MARKS = 32;
/** How many words one group read covers. */
const GROUP = 32;
/** The most field pieces in one word whose splits are tried in every combination. */
const MAX_COMBINED = 3;

/** One unit and the range that addresses it. */
export interface Unit {
  readonly range: Range;
  /** The text the paragraph reads for this unit. */
  readonly text: string;
  /** The placeholder number of an atom, or null for text. */
  readonly atom: number | null;
  readonly kind: RewritePlaceholderKind | null;
  readonly description: string;
  /**
   * Atoms that share one range, such as fields that show no text side by side, share a group:
   * they can be kept or deleted only together. Null for every other unit.
   */
  readonly group: number | null;
}

interface AtomInfo {
  readonly kind: RewritePlaceholderKind;
  readonly description: string;
}

/** A unit before its texts are read back. `atom` is called after the last sync. */
interface Part {
  readonly range: Range;
  readonly text: string;
  readonly atom: (() => AtomInfo) | null;
  readonly group?: number;
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
  readonly fields: FieldCollection | null;
  readonly controls: ContentControlCollection | null;
  readonly objects: RangeCollection | null;
  readonly breaks: RangeCollection | null;
}

/** A word after the third sync: its fields' codes and its locked controls. */
interface WordState {
  readonly word: Range;
  readonly codes: readonly string[];
  readonly locked: readonly ContentControl[];
  readonly objects: RangeCollection | null;
  readonly breaks: RangeCollection | null;
}

/** A range between two edges that can hold fields that show no text. */
interface Gap {
  readonly range: Range;
  readonly fields: FieldCollection | null;
}

/** What the fourth sync reads for a word. */
interface WordDetail {
  readonly starts: Range[];
  readonly kinds: ObjectKind[];
  readonly pieces: RangeCollection | null;
  readonly spacing: RangeCollection | null;
}

/** What the fifth sync reads for a field word's pieces. */
interface PieceDetail {
  readonly fields: FieldCollection[];
  /** The ranges between consecutive pieces, from the second piece on. */
  readonly gaps: Gap[];
  readonly lastChars: (RangeCollection | null)[];
}

const quoted = (value: string) => JSON.stringify(value);
const text = (range: Range, value: string): Part => ({ range, text: value, atom: null });

/** The range from an edge of `from` to an edge of `to`. */
function between(from: Range, fromEdge: 'Start' | 'End', to: Range, toEdge: 'Start' | 'End') {
  return from.getRange(fromEdge).expandTo(to.getRange(toEdge));
}

function built(parts: Part[] | null, filter: (part: Part) => boolean = () => true): Built {
  return {
    parts,
    checks: (parts ?? []).filter(filter).map((part) => ({ range: part.range, text: part.text })),
  };
}

const fieldDescription = (code: string, value: string) =>
  `field with code ${quoted(code.trim())}, ` +
  (value === '' ? 'shows no text' : `reads ${quoted(value)}`);

/** One atom per field that shows no text, all on one range and in one group. */
function emptyFields(range: Range, codes: readonly string[], group: number): Part[] {
  return codes.map((code) => {
    const description = fieldDescription(code, '');
    return { range, text: '', group, atom: () => ({ kind: 'field', description }) };
  });
}

let groups = 0;
const nextGroup = () => ++groups;

/** Read the paragraph as units. Refuses a paragraph with pending tracked changes. */
export async function readUnits(
  context: RequestContext,
  paragraph: Paragraph
): Promise<{ units: Unit[]; paragraphId: string }> {
  // Sync 1: the words, pending changes, and whether the paragraph holds fields or controls.
  const words = paragraph.getTextRanges([' ', '\t']);
  const revisions = paragraph.getRange('Whole').revisions;
  const allFields = paragraph.getRange('Whole').fields;
  const allControls = paragraph.contentControls;
  words.load('items/text');
  revisions.load('items');
  allFields.load('items');
  allControls.load('items/cannotEdit');
  paragraph.load('uniqueLocalId');
  await helperSync(context);
  // The rollback rejects only the changes this rewrite made, and a word range over pending
  // changes joins deleted and inserted text, so the paragraph must start with none.
  if (revisions.items.length > 0) {
    throw new RewriteError(
      'pending-changes',
      'The paragraph has tracked changes. Accept or reject them before you rewrite it.'
    );
  }
  // Refused before any per-word read when no answer could be compared with the paragraph.
  checkLength(words.items);
  const anyFields = allFields.items.length > 0;
  const anyLocked = allControls.items.some((control) => control.cannotEdit);
  const items = words.items;

  // Sync 2: groups of words, the ranges between groups, and every word's object characters.
  const groupCount = Math.ceil(items.length / GROUP);
  const grouped = Array.from({ length: anyFields || anyLocked ? groupCount : 0 }, (_, at) => {
    const first = items[at * GROUP]!;
    const last = items[Math.min(items.length, (at + 1) * GROUP) - 1]!;
    const range = first.expandTo(last);
    const fields = anyFields ? range.fields : null;
    const controls = anyLocked ? range.contentControls : null;
    fields?.load('items');
    controls?.load('items/cannotEdit');
    return { fields, controls };
  });
  const gapAt = (index: number): Gap => {
    const before = items[index - 1];
    const after = items[index];
    const from = before ? before.getRange('End') : paragraph.getRange('Start');
    const range = from.expandTo(after ? after.getRange('Start') : paragraph.getRange('End'));
    return { range, fields: anyFields ? range.fields : null };
  };
  // The gaps at group edges now; the gaps inside a group that holds a field in the next sync.
  const gaps: (Gap | null)[] = Array.from({ length: items.length + 1 }, (_, index) =>
    anyFields && index % GROUP === 0 ? gapAt(index) : null
  );
  if (anyFields && items.length % GROUP !== 0) gaps[items.length] = gapAt(items.length);
  for (const gap of gaps) gap?.fields?.load('items/code');
  const objects = items.map((word) => {
    const found = word.text.includes(OBJECT) ? word.search(OBJECT) : null;
    const breaks = word.text.includes(LINE_BREAK) ? word.search(LINE_BREAK) : null;
    found?.load('items');
    breaks?.load('items');
    return { found, breaks };
  });
  await helperSync(context);

  // Sync 3: each word, and each gap, of a group that holds a field or a locked control.
  const reads: WordRead[] = items.map((word, index) => {
    const group = grouped[Math.floor(index / GROUP)];
    const hasFields = (group?.fields?.items.length ?? 0) > 0;
    const hasLocked = group?.controls?.items.some((control) => control.cannotEdit) ?? false;
    const fields = hasFields ? word.fields : null;
    const controls = hasLocked ? word.contentControls : null;
    fields?.load('items/code');
    controls?.load('items/tag,items/title,items/cannotEdit,items/text');
    if (hasFields && index % GROUP !== 0) {
      gaps[index] = gapAt(index);
      gaps[index]!.fields?.load('items/code');
    }
    return {
      word,
      fields,
      controls,
      objects: objects[index]!.found,
      breaks: objects[index]!.breaks,
    };
  });
  await helperSync(context);
  const states: WordState[] = reads.map((read) => ({
    word: read.word,
    codes: read.fields?.items.map((field) => field.code) ?? [],
    locked: read.controls?.items.filter((control) => control.cannotEdit) ?? [],
    objects: read.objects,
    breaks: read.breaks,
  }));

  // Sync 4: where each control starts, what each object is, a field word's pieces, and the
  // trailing spacing of every word that holds an atom.
  const details: WordDetail[] = states.map((state) => {
    const starts = state.locked.map((control) => {
      const range = between(state.word, 'Start', control.getRange('Whole'), 'Start');
      range.load('text');
      return range;
    });
    const kinds = (state.objects?.items ?? []).map((object): ObjectKind => {
      const pictures = object.inlinePictures;
      const font = object.font;
      pictures.load('items/altTextDescription');
      font.load('superscript');
      return { pictures, font };
    });
    const marks = [...new Set(state.word.text)];
    const isField = state.codes.length > 0 && state.locked.length === 0 && !state.objects;
    const pieces = isField && marks.length <= MAX_MARKS ? state.word.getTextRanges(marks) : null;
    pieces?.load('items/text');
    const hasAtom =
      state.codes.length > 0 || state.locked.length > 0 || state.objects || state.breaks;
    const space = TRAILING_SPACING.exec(state.word.text)?.[0] ?? '';
    const spacing = hasAtom && space !== '' ? state.word.search(space) : null;
    spacing?.load('items');
    return { starts, kinds, pieces, spacing };
  });
  await helperSync(context);
  const clusters = layoutWords(
    states.map((state, index) => ({
      text: state.word.text,
      controls: state.locked.map((control, at) => ({
        text: control.text,
        start: details[index]!.starts[at]!.text.length,
      })),
      fields: state.codes.length,
    }))
  );

  // Sync 5: what each piece of a field word holds, the ranges between pieces, and each piece's
  // last character.
  const pieceDetails = details.map((detail): PieceDetail | null => {
    const pieces = detail.pieces?.items;
    if (!pieces) return null;
    const fields = pieces.map((piece) => {
      const found = piece.fields;
      found.load('items');
      return found;
    });
    const between_ = pieces.slice(1).map((piece, at): Gap => {
      const range = pieces[at]!.getRange('End').expandTo(piece.getRange('Start'));
      const found = range.fields;
      found.load('items/code');
      return { range, fields: found };
    });
    const lastChars = pieces.map((piece) => {
      if (piece.text.length < 2) return null;
      const matches = piece.search(piece.text.slice(-1));
      matches.load('items');
      return matches;
    });
    return { fields, gaps: between_, lastChars };
  });
  await helperSync(context);

  // Sync 6: read every split back, and every fallback.
  const planned = clusters.map((cluster) => ({
    cluster,
    split: splitOf(cluster, states, details, pieceDetails),
    fallback: built(wholeParts(cluster, states, details)),
  }));
  const checks = planned.flatMap(({ split, fallback }) => [
    ...split.flatMap((option) => option.checks),
    ...fallback.checks,
  ]);
  for (const check of checks) {
    check.range.load('text');
    check.fields?.collection.load('items');
  }
  await helperSync(context);
  const exact = (option: Built) =>
    option.parts !== null &&
    option.checks.every(
      (check) =>
        check.range.text === check.text &&
        (check.fields === undefined || check.fields.collection.items.length === check.fields.count)
    );

  const parts: Part[] = [];
  const gapParts = (index: number) => {
    const gap = gaps[index];
    const codes = gap?.fields?.items.map((field) => field.code) ?? [];
    if (gap && codes.length > 0) parts.push(...emptyFields(gap.range, codes, nextGroup()));
  };
  for (const { cluster, split, fallback } of planned) {
    gapParts(cluster.kind === 'atoms' || cluster.kind === 'whole' ? cluster.first : cluster.word);
    const chosen = split.find(exact) ?? (exact(fallback) ? fallback : null);
    parts.push(...(chosen?.parts ?? wholeParts(cluster, states, null)));
  }
  gapParts(items.length);

  let atoms = 0;
  const units = parts.map((part): Unit => {
    const info = part.atom?.() ?? null;
    return {
      range: part.range,
      text: part.text,
      atom: info ? ++atoms : null,
      kind: info?.kind ?? null,
      description: info?.description ?? '',
      group: part.group ?? null,
    };
  });
  return { units, paragraphId: paragraph.uniqueLocalId };
}

/** The ways to split one cluster, in order of preference. */
function splitOf(
  cluster: Cluster,
  states: readonly WordState[],
  details: readonly WordDetail[],
  pieceDetails: readonly (PieceDetail | null)[]
): Built[] {
  if (cluster.kind === 'text') {
    const { word } = states[cluster.word]!;
    return [{ parts: [text(word, word.text)], checks: [] }];
  }
  if (cluster.kind === 'whole') return [];
  if (cluster.kind === 'field') {
    return splitField(states[cluster.word]!, details[cluster.word]!, pieceDetails[cluster.word]);
  }
  return [splitAtoms(cluster, states, details)];
}

/**
 * A word that holds fields, split by its pieces. Plain pieces are text; a piece that holds a
 * field holds the field and at most the one character after it, so each such piece is tried
 * both without its last character and whole; a range between pieces that holds fields that show
 * no text gives one atom per field.
 */
function splitField(
  state: WordState,
  detail: WordDetail,
  pieces: PieceDetail | null | undefined
): Built[] {
  const items = detail.pieces?.items ?? [];
  if (!pieces || items.length === 0) return [];
  const fieldPieces = pieces.fields.flatMap((found, at) => (found.items.length > 0 ? [at] : []));
  if (fieldPieces.some((at) => pieces.fields[at]!.items.length !== 1)) return [];
  // Codes of the fields that show text, in order: the word's codes without those of its gaps.
  const gapCodes = pieces.gaps.flatMap((gap) => gap.fields?.items.map((field) => field.code) ?? []);
  const shown = [...state.codes];
  for (const code of gapCodes) shown.splice(shown.indexOf(code), 1);
  if (shown.length !== fieldPieces.length) return [];

  const combos: boolean[][] = [];
  const count = fieldPieces.length;
  if (count <= MAX_COMBINED) {
    for (let mask = 0; mask < 1 << count; mask += 1) {
      combos.push(Array.from({ length: count }, (_, at) => (mask & (1 << at)) === 0));
    }
  } else
    combos.push(
      fieldPieces.map(() => true),
      fieldPieces.map(() => false)
    );

  return combos.map((trims) => {
    const parts: Part[] = [];
    const checks: Check[] = [];
    let start = state.word.getRange('Start');
    let run = '';
    const flush = (end: Range) => {
      if (run === '') return;
      const range = start.expandTo(end);
      parts.push(text(range, run));
      // Text beside a field must not hold it, or an edit of the text would delete the field.
      checks.push({ range, text: run, fields: { count: 0, collection: range.fields } });
      run = '';
    };
    let field = 0;
    for (const [at, piece] of items.entries()) {
      const gap = at > 0 ? pieces.gaps[at - 1] : undefined;
      const codes = gap?.fields?.items.map((found) => found.code) ?? [];
      if (codes.length > 0) {
        flush(items[at - 1]!.getRange('End'));
        parts.push(...emptyFields(gap!.range, codes, nextGroup()));
        start = piece.getRange('Start');
      }
      const index = fieldPieces.indexOf(at);
      if (index < 0) {
        run += piece.text;
        continue;
      }
      flush(at > 0 ? items[at - 1]!.getRange('End') : piece.getRange('Start'));
      const trim = trims[index]! && piece.text.length > 1 && pieces.lastChars[at]?.items.at(-1);
      const last = trim ? pieces.lastChars[at]!.items.at(-1)! : null;
      const result = last ? piece.text.slice(0, -1) : piece.text;
      const atom = last ? piece.getRange('Start').expandTo(last.getRange('Start')) : piece;
      const description = fieldDescription(shown[field]!, result);
      field += 1;
      parts.push({ range: atom, text: result, atom: () => ({ kind: 'field', description }) });
      checks.push({ range: atom, text: result, fields: { count: 1, collection: atom.fields } });
      start = last ? last.getRange('Start') : piece.getRange('End');
      run = last ? piece.text.slice(-1) : '';
    }
    flush(state.word.getRange('End'));
    return { parts, checks };
  });
}

/** A cluster of locked controls and object characters with text between them. */
function splitAtoms(
  cluster: Extract<Cluster, { kind: 'atoms' }>,
  states: readonly WordState[],
  details: readonly WordDetail[]
): Built {
  const ranges = cluster.atoms.map((atom) => rangeOf(atom, states));
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
        atom: atomInfo(atom, states, details),
      };
      if (atom.source.type === 'control') controls.add(part);
      parts.push(part);
      continue;
    }
    const piece = cluster.pieces[entry.piece]!;
    const word = states[piece.word]!.word;
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
function rangeOf(atom: LayoutAtom, states: readonly WordState[]): Range | null {
  const state = states[atom.source.word]!;
  if (atom.source.type === 'control') {
    return state.locked[atom.source.index]?.getRange('Whole') ?? null;
  }
  const found = atom.source.type === 'object' ? state.objects : state.breaks;
  return found?.items[atom.source.index] ?? null;
}

/** What an atom is, read after the fourth sync. */
function atomInfo(
  atom: LayoutAtom,
  states: readonly WordState[],
  details: readonly WordDetail[]
): () => AtomInfo {
  if (atom.source.type === 'break') {
    return () => ({ kind: 'line-break', description: 'line break' });
  }
  if (atom.source.type === 'control') {
    const control = states[atom.source.word]!.locked[atom.source.index]!;
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
 * A cluster as one atom, with its trailing space or tab outside it when the fourth sync found
 * it, so a model that keeps the space does not double it.
 */
function wholeParts(
  cluster: Cluster,
  states: readonly WordState[],
  details: readonly WordDetail[] | null
): Part[] {
  const start = cluster.kind === 'text' || cluster.kind === 'field' ? cluster.word : cluster.first;
  const end = cluster.kind === 'text' || cluster.kind === 'field' ? cluster.word : cluster.last;
  const words = states.slice(start, end + 1).map((state) => state.word);
  const value = words.map((word) => word.text).join('');
  const firstWord = words[0]!;
  const lastWord = words[words.length - 1]!;
  if (cluster.kind === 'text') return [text(firstWord, value)];
  const codes = states.slice(start, end + 1).flatMap((state) => state.codes);
  const core = value.replace(TRAILING_SPACING, '');
  const space = value.slice(core.length);
  // The text and its fields cannot be told apart here, so the description names both.
  const info: AtomInfo =
    codes.length > 0
      ? {
          kind: 'field',
          description:
            `text ${quoted(core)} with ${codes.length === 1 ? 'a field' : 'fields'} ` +
            `${codes.map((code) => quoted(code.trim())).join(' and ')}, which change only together`,
        }
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
