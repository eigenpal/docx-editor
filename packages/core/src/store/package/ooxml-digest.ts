// Save/reopen semantic digest — the SECOND serialization oracle (task 4.8, design D9).
//
// The canonical tree fingerprint answers "is this the same tree?". It cannot answer "did a
// round trip lose meaning?", because a serializer bug that drops content produces a tree
// that is internally consistent and fingerprints happily against itself. So D9 requires two
// oracles and forbids one compensating for the other: serialize, REOPEN the produced bytes,
// and compare a digest of what the reopened package actually means.
//
// The digest deliberately covers exactly what the spec names — paragraph identities,
// content tokens, accepted run and paragraph properties, and generic-node structure — and
// deliberately ignores lexical detail, because byte equality is the alternative D9 rejects:
// it rejects harmless normalization while failing to say what was lost.

import { hardBreakText } from './hard-break.ts';
import { canonicalOoxmlFingerprint, WML_NAMESPACE_URI } from './ooxml-tree.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlParagraphPropertiesNode,
  OoxmlPart,
  OoxmlRunPropertiesNode,
} from './ooxml-tree.ts';

/** One paragraph's meaning, independent of how it was spelled in XML. */
export interface ParagraphDigest {
  /** Ordinal identity within its story. Node ids are NOT used: a reopened package
   *  legitimately re-derives them, and requiring them to match would test the id scheme
   *  rather than the content. */
  readonly ordinal: number;
  /** Text content, including tabs and hard breaks as their characters. */
  readonly text: string;
  /** Accepted paragraph properties, as sorted `local=value` tokens. */
  readonly paragraphProperties: readonly string[];
  /** Per-run accepted properties, in run order. */
  readonly runProperties: readonly (readonly string[])[];
  /** Fingerprints of every generic (unknown) subtree, in document order. */
  readonly genericStructure: readonly string[];
}

export interface StoryDigest {
  readonly partName: string;
  readonly paragraphs: readonly ParagraphDigest[];
}

export interface SemanticDigest {
  readonly stories: readonly StoryDigest[];
}

export type DigestDifference = {
  readonly path: string;
  readonly before: string;
  readonly after: string;
};

function propertyTokens(
  container: OoxmlRunPropertiesNode | OoxmlParagraphPropertiesNode | undefined
): string[] {
  if (!container) return [];
  const tokens: string[] = [];
  for (const child of container.children) {
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const values: string[] = [];
    for (const attribute of child.attributes) {
      values.push(`${attribute.localName}=${attribute.value}`);
    }
    values.sort();
    tokens.push(values.length > 0 ? `${child.localName}(${values.join(',')})` : child.localName);
  }
  // Sorted: OOXML property order inside `w:rPr` / `w:pPr` is schema-fixed and carries no
  // authored meaning, so a serializer that emits them in a different valid order has lost
  // nothing. Significant CONTENT order is checked separately, by the fingerprint oracle.
  tokens.sort();
  return tokens;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') return '';
  if (node.kind === 'generic') return '';
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}

function collectGeneric(node: OoxmlNode, out: string[]): void {
  if (node.kind === 'textValue') return;
  // A property container's children are covered by `propertyTokens`, which sorts them
  // because OOXML property order is schema-fixed and carries no authored meaning. Walking
  // into it here as well would both double-count every property AND smuggle their document
  // order back in as significant, so `<w:b/><w:u/>` and `<w:u/><w:b/>` would read as
  // semantic loss. Foreign-namespace children are the exception: `propertyTokens` skips
  // those, so this is their only owner.
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') {
    const foreign: string[] = [];
    for (const child of node.children) {
      if (child.namespaceUri === WML_NAMESPACE_URI) continue;
      foreign.push(canonicalOoxmlFingerprint(child));
    }
    foreign.sort(); // order among properties is not authored meaning
    out.push(...foreign);
    return;
  }
  if (node.kind === 'generic') {
    out.push(canonicalOoxmlFingerprint(node));
    return; // fingerprint covers the whole subtree; do not double-count descendants
  }
  for (const child of node.children) collectGeneric(child, out);
}

function digestParagraph(paragraph: OoxmlParagraphNode, ordinal: number): ParagraphDigest {
  const pPr = paragraph.children.find(
    (child): child is OoxmlParagraphPropertiesNode => child.kind === 'paragraphProperties'
  );
  const runProperties: string[][] = [];
  let text = '';
  const genericStructure: string[] = [];
  for (const child of paragraph.children) {
    if (child.kind === 'run') {
      const rPr = child.children.find(
        (grand): grand is OoxmlRunPropertiesNode => grand.kind === 'runProperties'
      );
      runProperties.push(propertyTokens(rPr));
      text += textOf(child);
      // Includes the run's own `w:rPr`, so a FOREIGN-namespace property child is digested
      // exactly once (there) rather than falling between the two collectors.
      for (const grand of child.children) collectGeneric(grand, genericStructure);
      continue;
    }
    collectGeneric(child, genericStructure);
  }
  return {
    ordinal,
    text,
    paragraphProperties: propertyTokens(pPr),
    runProperties,
    genericStructure,
  };
}

function storyRootOf(root: OoxmlElement): OoxmlElement | null {
  if (root.localName === 'hdr' || root.localName === 'ftr') return root;
  if (root.kind === 'body') return root;
  for (const child of root.children) {
    if (child.kind === 'textValue') continue;
    const found = storyRootOf(child);
    if (found) return found;
  }
  return null;
}

/**
 * How deep a story is followed when collecting its paragraphs.
 *
 * Tables nest inside cells, and content controls nest inside both, so the walk has to
 * recurse — and a file-supplied tree is attacker-controlled, so the recursion is capped
 * rather than trusted to terminate at a sane depth. Well past anything Word authors; the
 * parse-time depth limit is the real bound, this is the belt to its braces.
 */
const MAX_STORY_NESTING = 64;

/**
 * Every paragraph of a story, in document order — including the ones inside tables and
 * block content controls.
 *
 * Walking only the body's direct `w:p` children put every table cell and every block SDT
 * OUTSIDE the oracle: a round trip that emptied a cell reported zero differences, and the
 * fingerprint oracle cannot cover for that (it compares a tree against its own reopen, so
 * content lost identically on every pass fingerprints equal). Paragraphs are not descended
 * into — a textbox story inside a run is a different story, digested through the generic
 * structure of the run that holds it.
 */
function collectStoryParagraphs(
  container: OoxmlElement,
  out: OoxmlParagraphNode[],
  depth: number
): void {
  if (depth > MAX_STORY_NESTING) return;
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraph') {
      out.push(child);
      continue;
    }
    collectStoryParagraphs(child, out, depth + 1);
  }
}

/** Digest one part's story, or null when the part holds no flowable root. */
export function digestPart(part: OoxmlPart): StoryDigest | null {
  const body = storyRootOf(part.root);
  if (!body) return null;
  const found: OoxmlParagraphNode[] = [];
  collectStoryParagraphs(body, found, 0);
  const paragraphs = found.map((paragraph, ordinal) => digestParagraph(paragraph, ordinal));
  return { partName: part.name, paragraphs };
}

/** Digest every story-bearing part, in the given order. */
export function semanticDigest(parts: Iterable<OoxmlPart>): SemanticDigest {
  const stories: StoryDigest[] = [];
  for (const part of parts) {
    const story = digestPart(part);
    if (story) stories.push(story);
  }
  return { stories };
}

/**
 * Every way two digests differ, as readable paths.
 *
 * Returns the differences rather than a boolean because "the round trip lost something" is
 * useless without saying what — the failure this oracle exists to catch is a silent drop,
 * and a bare `false` reproduces the silence.
 */
export function diffSemanticDigests(
  before: SemanticDigest,
  after: SemanticDigest
): DigestDifference[] {
  const differences: DigestDifference[] = [];
  const report = (path: string, a: unknown, b: unknown): void => {
    differences.push({
      path,
      before: JSON.stringify(a) ?? 'undefined',
      after: JSON.stringify(b) ?? 'undefined',
    });
  };

  if (before.stories.length !== after.stories.length) {
    report('stories.length', before.stories.length, after.stories.length);
  }
  const count = Math.min(before.stories.length, after.stories.length);
  for (let s = 0; s < count; s += 1) {
    const a = before.stories[s]!;
    const b = after.stories[s]!;
    const at = (suffix: string) => `${a.partName}${suffix}`;
    if (a.paragraphs.length !== b.paragraphs.length) {
      report(at('.paragraphs.length'), a.paragraphs.length, b.paragraphs.length);
    }
    const paragraphCount = Math.min(a.paragraphs.length, b.paragraphs.length);
    for (let p = 0; p < paragraphCount; p += 1) {
      const pa = a.paragraphs[p]!;
      const pb = b.paragraphs[p]!;
      if (pa.text !== pb.text) report(at(`.p[${p}].text`), pa.text, pb.text);
      if (JSON.stringify(pa.paragraphProperties) !== JSON.stringify(pb.paragraphProperties)) {
        report(at(`.p[${p}].paragraphProperties`), pa.paragraphProperties, pb.paragraphProperties);
      }
      if (JSON.stringify(pa.runProperties) !== JSON.stringify(pb.runProperties)) {
        report(at(`.p[${p}].runProperties`), pa.runProperties, pb.runProperties);
      }
      if (JSON.stringify(pa.genericStructure) !== JSON.stringify(pb.genericStructure)) {
        report(at(`.p[${p}].genericStructure`), pa.genericStructure, pb.genericStructure);
      }
    }
  }
  return differences;
}
