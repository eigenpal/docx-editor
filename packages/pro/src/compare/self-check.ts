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
import { finalSectionFurniture } from './stories.ts';
import { attributeOf, elementChildren, type ElementNode } from './xml-fragments.ts';

const STORY_TYPES = [
  'document.main+xml',
  '.header+xml',
  '.footer+xml',
  '.footnotes+xml',
  '.endnotes+xml',
];

const isStoryType = (part: OoxmlPart) =>
  STORY_TYPES.some((suffix) => part.contentType.endsWith(suffix));

const isFurniture = (part: OoxmlPart) =>
  part.contentType.endsWith('.header+xml') || part.contentType.endsWith('.footer+xml');

/** The compared story parts of `pkg`. */
function storyParts(pkg: OoxmlPackage): OoxmlPart[] {
  const furniture = finalSectionFurniture(pkg);
  return [...pkg.parts.values()].filter(
    (part) => isStoryType(part) && (!isFurniture(part) || furniture.has(part.name))
  );
}

type Level = 'text' | 'properties';

const NOTE_REFERENCES: Readonly<Record<string, 'footnote' | 'endnote'>> = {
  footnoteReference: 'footnote',
  endnoteReference: 'endnote',
};

/** Note ids, as `footnote:3`, that the main story references. */
function referencedNotes(parts: readonly OoxmlPart[]): ReadonlySet<string> {
  const out = new Set<string>();
  const main = parts.find((part) => part.contentType.endsWith('document.main+xml'));
  const stack: ElementNode[] = main ? [...elementChildren(main.root)] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const kind = NOTE_REFERENCES[node.localName];
    if (kind) out.add(`${kind}:${attributeOf(node, 'id') ?? ''}`);
    else stack.push(...elementChildren(node));
  }
  return out;
}

/** A notes part without the notes nothing references: those never show. */
function referencedOnly(part: OoxmlPart, referenced: ReadonlySet<string>): OoxmlPart {
  const kind = part.contentType.endsWith('.footnotes+xml') ? 'footnote' : 'endnote';
  const children = elementChildren(part.root).filter(
    (note) => note.localName !== kind || referenced.has(`${kind}:${attributeOf(note, 'id') ?? ''}`)
  );
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

function resolved(pkg: OoxmlPackage, op: 'acceptAllRevisions' | 'rejectAllRevisions'): OoxmlPart[] {
  const out: OoxmlPart[] = [];
  for (const part of storyParts(pkg)) {
    const result = applyTreeOp(part, { op });
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
  const accepted = resolved(output, 'acceptAllRevisions');
  const rejected = resolved(output, 'rejectAllRevisions');
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
    ...(detail === undefined ? {} : { detail }),
  };
}
