/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Proves a compare result with the engine's own review operations: accepting every revision
 * must give the revised document, and rejecting every revision must give the original.
 *
 * Text is the hard requirement. Paragraph properties are checked too, but a difference there
 * is reported rather than fatal: some structure has no revision form (a content control added
 * around existing text, a section break added or removed), and refusing the whole compare for
 * it would be worse than showing every text change.
 *
 * Only the compared stories are checked: the main story, the notes, and the headers and footers
 * of the final section. Other sections keep the original's headers and footers.
 */
import {
  applyTreeOp,
  digestPart,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPackage,
  type OoxmlPart,
  type ParagraphDigest,
} from '@docx-editor.dev/core/store';
import { comparedStoryParts } from './stories.ts';
import { attributeOf, elementChildren, isElement, type ElementNode } from './xml-fragments.ts';

/** The compared story parts of `pkg`, the main story first. */
const storyParts = comparedStoryParts;

type Level = 'text' | 'properties';

const NOTE_REFERENCES: Readonly<Record<string, 'footnote' | 'endnote'>> = {
  footnoteReference: 'footnote',
  endnoteReference: 'endnote',
};

/**
 * Note ids, as `footnote:3`, that the main story references, each with the position of its
 * first reference. A notes part may list notes in any order; readers show them by reference.
 */
function referencedNotes(parts: readonly OoxmlPart[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const main = parts[0];
  const stack: ElementNode[] = main ? [main.root as ElementNode] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const kind = NOTE_REFERENCES[node.localName];
    if (kind) {
      const key = `${kind}:${attributeOf(node, 'id') ?? ''}`;
      if (!out.has(key)) out.set(key, out.size);
      continue;
    }
    // Children are pushed last first, so they are visited in document order.
    const children = elementChildren(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return out;
}

/**
 * A notes part with only the notes something references, in reference order, after its
 * separators: notes nothing references never show.
 */
function referencedOnly(part: OoxmlPart, referenced: ReadonlyMap<string, number>): OoxmlPart {
  const kind = part.contentType.endsWith('.footnotes+xml') ? 'footnote' : 'endnote';
  const keyOf = (note: ElementNode) => `${kind}:${attributeOf(note, 'id') ?? ''}`;
  const all = elementChildren(part.root);
  const others = all.filter((note) => note.localName !== kind);
  const notes = all
    .filter((note) => note.localName === kind && referenced.has(keyOf(note)))
    .sort((a, b) => referenced.get(keyOf(a))! - referenced.get(keyOf(b))!);
  const children = [...others, ...notes];
  return { ...part, root: { ...part.root, children } as OoxmlPart['root'] };
}

/** Paragraph text (and, at the properties level, paragraph properties) per story, sorted. */
function fingerprint(list: readonly OoxmlPart[], level: Level): string {
  const stories: string[] = [];
  const referenced = referencedNotes(list);
  for (const story of list) {
    const part = story.contentType.endsWith('notes+xml')
      ? referencedOnly(story, referenced)
      : story;
    const digest = digestPart(part);
    if (!digest) continue;
    // Empty paragraphs carry no text. A note whose reference was rejected (or accepted away)
    // stays as an empty note, and a deleted block content control keeps an empty paragraph
    // when no paragraph follows it to join.
    const notes = part.contentType.endsWith('notes+xml');
    const paragraphs = digest.paragraphs
      .filter((paragraph) => (level === 'properties' && !notes) || paragraph.text.trim() !== '')
      .map((paragraph) => paragraphFingerprint(paragraph, level));
    // Empty stories carry no content (a deleted header, a notes part with only separators).
    if (digest.paragraphs.every((paragraph) => paragraph.text.trim() === '')) continue;
    stories.push(paragraphs.join('\n'));
  }
  return stories.sort().join('\n\n');
}

function paragraphFingerprint(paragraph: ParagraphDigest, level: Level): string {
  if (level === 'text') {
    // An emptied content control shows placeholder spaces; whitespace runs are not compared.
    return paragraph.text.replace(/\s+/g, ' ').trim();
  }
  // An empty paragraph-mark `w:rPr` (left when a mark revision resolves) carries nothing.
  const properties = paragraph.paragraphProperties.filter((property) => property !== 'rPr');
  return `${paragraph.text}\u0001${properties.join('|')}`;
}

const REVISION_NAMES = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'cellIns',
  'cellDel',
]);

/** Whether `node` holds a revision element. */
export function hasRevision(node: OoxmlPart['root'] | ElementNode): boolean {
  if (!isElement(node)) return false;
  if (REVISION_NAMES.has(node.localName)) return true;
  return node.children.some((child) => isElement(child) && hasRevision(child));
}

/** Reasons a review decision refuses that come from the content, not from the compare. */
const GUARDS = new Set(['locked', 'bound']);

function resolved(
  pkg: OoxmlPackage,
  op: 'acceptAllRevisions' | 'rejectAllRevisions',
  guards: Set<string>
): OoxmlPart[] {
  const out: OoxmlPart[] = [];
  for (const part of storyParts(pkg)) {
    if (!hasRevision(part.root)) {
      out.push(part);
      continue;
    }
    const result = applyTreeOp(part, { op });
    if (!result.ok && GUARDS.has(result.reason)) guards.add(result.reason);
    const next = result.ok ? result.part : part;
    // Re-read, so renamed elements (a restored `w:instrText`) take their typed kinds.
    const reread = readOoxmlPart(serializeOoxmlPart(next), {
      name: next.name,
      contentType: next.contentType,
    });
    out.push(reread.ok ? reread.part : next);
  }
  return out;
}

export interface SelfCheckResult {
  /** Accepting every revision gives the revised document's text. */
  readonly accept: boolean;
  /** Rejecting every revision gives the original's text. */
  readonly reject: boolean;
  /** Paragraph properties also agree in both directions. */
  readonly properties: boolean;
  /**
   * A lock or a data binding on a content control keeps some revisions from being accepted or
   * rejected: `locked` or `bound`.
   */
  readonly guard?: string;
  readonly detail?: string;
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `${JSON.stringify(a.slice(Math.max(0, i - 40), i + 80))} vs ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 80))}`;
}

export function selfCheck(
  output: OoxmlPackage,
  original: OoxmlPackage,
  revised: OoxmlPackage
): SelfCheckResult {
  const guards = new Set<string>();
  const accepted = resolved(output, 'acceptAllRevisions', guards);
  const rejected = resolved(output, 'rejectAllRevisions', guards);
  const check = (level: Level) => {
    const a = fingerprint(accepted, level);
    const r = fingerprint(rejected, level);
    const expectedA = fingerprint(storyParts(revised), level);
    const expectedR = fingerprint(storyParts(original), level);
    return {
      accept: a === expectedA,
      reject: r === expectedR,
      detail:
        a !== expectedA
          ? `accept: ${firstDifference(a, expectedA)}`
          : r !== expectedR
            ? `reject: ${firstDifference(r, expectedR)}`
            : undefined,
    };
  };
  const text = check('text');
  const properties = text.accept && text.reject ? check('properties') : text;
  const detail = text.detail ?? properties.detail;
  return {
    accept: text.accept,
    reject: text.reject,
    properties: properties.accept && properties.reject,
    ...(guards.size > 0 ? { guard: [...guards].sort().join(',') } : {}),
    ...(detail === undefined ? {} : { detail }),
  };
}
