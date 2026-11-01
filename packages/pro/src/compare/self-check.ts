/**
 * Proves a compare result with the engine's own review operations: accepting every revision
 * must give the revised document, and rejecting every revision must give the original.
 *
 * Text is the hard requirement. Paragraph properties are checked too, but a difference there
 * is reported rather than fatal: some structure has no revision form (a content control added
 * around existing text, a section break added or removed), and refusing the whole compare for
 * it would be worse than showing every text change.
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

const STORY_TYPES = [
  'document.main+xml',
  '.header+xml',
  '.footer+xml',
  '.footnotes+xml',
  '.endnotes+xml',
];

const isStory = (part: OoxmlPart) =>
  STORY_TYPES.some((suffix) => part.contentType.endsWith(suffix));

type Level = 'text' | 'properties';

/** Paragraph text (and, at the properties level, paragraph properties) per story, sorted. */
function fingerprint(parts: Iterable<OoxmlPart>, level: Level): string {
  const stories: string[] = [];
  for (const part of parts) {
    if (!isStory(part)) continue;
    const digest = digestPart(part);
    if (!digest) continue;
    // A note whose reference was rejected (or accepted away) stays as an empty note.
    const notes = part.contentType.endsWith('notes+xml');
    const paragraphs = digest.paragraphs
      .filter((paragraph) => !notes || paragraph.text.trim() !== '')
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
  for (const part of pkg.parts.values()) {
    if (!isStory(part)) continue;
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
    const expectedA = fingerprint(revised.parts.values(), level);
    const expectedR = fingerprint(original.parts.values(), level);
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
