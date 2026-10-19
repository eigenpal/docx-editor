/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read a paragraph as units: words, the text that touches an atom, and the atoms themselves.
//
// `rewrite-layout.ts` works out from the texts where each atom sits. This module turns that into
// ranges with public calls only: a content control answers its own range, `search()` finds each
// object character and the punctuation around a field, and `getRange('Start' | 'End')` with
// `expandTo()` addresses the text between atoms. Every part is read back. A cluster whose parts
// do not read as expected becomes one atom, with its trailing space still outside it.
//
// Four syncs, however long the paragraph.

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

const LEADING_PUNCTUATION = /^[\p{Ps}\p{Pi}"'([]+/u;
const TRAILING_TEXT = /\p{P}*[ \t]*$/u;
const TRAILING_SPACING = /[ \t]+$/;

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
  readonly locked: ContentControl[];
  readonly objects: RangeCollection | null;
  readonly breaks: RangeCollection | null;
}

interface ObjectKind {
  readonly pictures: InlinePictureCollection;
  readonly font: { readonly superscript: boolean | null };
}

interface Check {
  readonly range: Range;
  readonly text: string;
}

/** Parts, and the reads that check them. `null` parts mean the split cannot be made. */
interface Built {
  readonly parts: Part[] | null;
  readonly checks: readonly Check[];
}

/** One cluster after the third sync: its split, and one atom to use if the split fails. */
interface Planned {
  readonly split: Built;
  readonly fallback: Built;
}

/** Checks for every part of `parts`, or for the parts that `filter` selects. */
function built(parts: Part[] | null, filter: (part: Part) => boolean = () => true): Built {
  return {
    parts,
    checks: (parts ?? []).filter(filter).map((part) => ({ range: part.range, text: part.text })),
  };
}

const quoted = (value: string) => JSON.stringify(value);
const text = (range: Range, value: string): Part => ({ range, text: value, atom: null });

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

  // Sync 2: what every word holds, and where its object characters are.
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
  await context.sync();
  const reads: WordRead[] = pending.map(({ controls, ...rest }) => ({
    ...rest,
    locked: controls.items.filter((control) => control.cannotEdit),
  }));
  const clusters = layoutWords(
    reads.map((read) => ({
      text: read.word.text,
      controls: read.locked.map((control) => control.text),
      fields: read.fields.items.length,
    }))
  );

  // Sync 3: where each field ends, what each object is, and each cluster's trailing spacing.
  const plans = clusters.map((cluster) => plan(cluster, reads));
  await context.sync();

  // Sync 4: read every split back, and every fallback.
  const planned = plans.map((build) => build());
  const checks = planned.flatMap((item) => [...item.split.checks, ...item.fallback.checks]);
  for (const check of checks) check.range.load('text');
  await context.sync();
  const exact = (item: Built) =>
    item.parts !== null && item.checks.every((check) => check.range.text === check.text);

  let atoms = 0;
  const units = planned
    .flatMap((item, index) => {
      if (exact(item.split)) return item.split.parts!;
      if (exact(item.fallback)) return item.fallback.parts!;
      return wholeParts(clusters[index]!, reads, null)!;
    })
    .map((part): Unit => {
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

/** Queue the third sync's reads for one cluster. The answer builds its parts after that sync. */
function plan(cluster: Cluster, reads: readonly WordRead[]): () => Planned {
  if (cluster.kind === 'text') {
    const { word } = reads[cluster.word]!;
    const parts = [text(word, word.text)];
    return () => ({ split: { parts, checks: [] }, fallback: { parts, checks: [] } });
  }
  const last = cluster.kind === 'field' ? cluster.word : cluster.last;
  const lastWord = reads[last]!.word;
  const spacing = TRAILING_SPACING.exec(lastWord.text)?.[0] ?? '';
  const matches = spacing === '' ? null : lastWord.search(spacing);
  matches?.load('items');
  const fallback = () => built(wholeParts(cluster, reads, matches));
  if (cluster.kind === 'whole') {
    return () => ({ split: { parts: null, checks: [] }, fallback: fallback() });
  }
  const split =
    cluster.kind === 'field' ? planField(reads[cluster.word]!) : planAtoms(cluster, reads);
  return () => ({ split: split(), fallback: fallback() });
}

/** A word that holds one field: the punctuation before it, the field, and the text after it. */
function planField(read: WordRead): () => Built {
  const { word } = read;
  const value = word.text;
  const lead = LEADING_PUNCTUATION.exec(value)?.[0] ?? '';
  const trail = TRAILING_TEXT.exec(value.slice(lead.length))?.[0] ?? '';
  const before = lead === '' ? null : word.search(lead);
  const after = trail === '' ? null : word.search(trail);
  before?.load('items');
  after?.load('items');
  return () => {
    // Each search answers its match nearest the field: the first leading, the last trailing.
    const leading = before?.items[0];
    const trailing = after?.items[after.items.length - 1];
    if ((lead !== '' && !leading) || (trail !== '' && !trailing)) return built(null);
    const field = read.fields.items[0]!;
    const result = value.slice(lead.length, value.length - trail.length);
    const start = leading ? leading.getRange('End') : word.getRange('Start');
    const end = trailing ? trailing.getRange('Start') : word.getRange('End');
    const description = `field with code ${quoted(field.code.trim())}, reads ${quoted(result)}`;
    const parts: Part[] = [];
    if (leading) parts.push(text(between(word, 'Start', leading, 'End'), lead));
    parts.push({
      range: start.expandTo(end),
      text: result,
      atom: () => ({ kind: 'field', description }),
    });
    if (trailing) parts.push(text(between(trailing, 'Start', word, 'End'), trail));
    return built(parts);
  };
}

/** A cluster of locked controls and object characters with text between them. */
function planAtoms(cluster: Extract<Cluster, { kind: 'atoms' }>, reads: readonly WordRead[]) {
  // Queue what each object is now, so the third sync answers it.
  const kinds = cluster.atoms.map((atom): ObjectKind | null => {
    const range = rangeOf(atom, reads);
    if (atom.source.type !== 'object' || !range) return null;
    const pictures = range.inlinePictures;
    const font = range.font;
    pictures.load('items/altTextDescription');
    font.load('superscript');
    return { pictures, font };
  });
  return (): Built => {
    const ranges = cluster.atoms.map((atom) => rangeOf(atom, reads));
    if (ranges.some((range) => range === null)) return built(null);
    const parts: Part[] = [];
    const controls = new Set<Part>();
    for (const entry of cluster.order) {
      if ('atom' in entry) {
        const atom = cluster.atoms[entry.atom]!;
        const value = cluster.text.slice(atom.start, atom.end);
        const info = atomInfo(atom, reads, kinds[entry.atom] ?? null);
        const part: Part = { range: ranges[entry.atom]!, text: value, atom: info };
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
  };
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
  kind: ObjectKind | null
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
 * A cluster as one atom, with its trailing space or tab outside it when `spacing` found it, so a
 * model that keeps the space does not double it.
 */
function wholeParts(
  cluster: Cluster,
  reads: readonly WordRead[],
  spacing: RangeCollection | null
): Part[] {
  const first = cluster.kind === 'atoms' || cluster.kind === 'whole' ? cluster.first : 0;
  const last = cluster.kind === 'atoms' || cluster.kind === 'whole' ? cluster.last : 0;
  const start = cluster.kind === 'text' || cluster.kind === 'field' ? cluster.word : first;
  const end = cluster.kind === 'text' || cluster.kind === 'field' ? cluster.word : last;
  const words = reads.slice(start, end + 1).map((read) => read.word);
  const value = words.map((word) => word.text).join('');
  const firstWord = words[0]!;
  const lastWord = words[words.length - 1]!;
  if (cluster.kind === 'text') return [text(firstWord, value)];
  const field = reads[start]!.fields.items[0];
  const core = value.replace(TRAILING_SPACING, '');
  const space = value.slice(core.length);
  const description = field
    ? `field with code ${quoted(field.code.trim())} and the text beside it, reads ${quoted(core)}`
    : `content that cannot change, reads ${quoted(core)}`;
  const kind: RewritePlaceholderKind = field ? 'field' : 'content-control';
  const match = spacing?.items[spacing.items.length - 1];
  if (space !== '' && match) {
    return [
      {
        range: between(firstWord, 'Start', match, 'Start'),
        text: core,
        atom: () => ({ kind, description }),
      },
      text(between(match, 'Start', lastWord, 'End'), space),
    ];
  }
  const range = firstWord === lastWord ? firstWord : firstWord.expandTo(lastWord);
  return [{ range, text: value, atom: () => ({ kind, description }) }];
}
