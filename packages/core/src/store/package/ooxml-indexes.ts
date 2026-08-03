// Derived semantic indexes over the canonical tree (typed-ooxml-paragraph-editor task 4.7).
//
// These are PROJECTIONS, never authority. Every index is a pure function of one tree
// revision: rebuilding from the same revision yields an identical index, and nothing here
// may be mutated or consulted as a source of truth by save. That is the whole point of the
// "derived indexes are not mutation or serialization authority" requirement — the store
// mutates the tree and re-derives, rather than keeping a second structure in sync.
//
// The revision tag is carried, not computed here: `DocumentStore` owns revisions, and an
// index that invented its own would let a stale projection claim to be current.

import { hardBreakText } from './hard-break.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { RelationshipRecord } from './relationships.ts';

export interface ParagraphIndexEntry {
  /** Canonical tree node id — the stable identity operations address. */
  readonly nodeId: string;
  /** Position among the story's paragraphs, in document order. */
  readonly ordinal: number;
  /** Concatenated text content, with tabs and breaks mapped as the model reads them. */
  readonly text: string;
  /** Node ids of the paragraph's runs, in order. */
  readonly runIds: readonly string[];
}

export interface StoryIndexEntry {
  /** The part the story lives in. */
  readonly partName: string;
  /** The `w:body` (or story root) node id. */
  readonly rootId: string;
  readonly paragraphs: readonly ParagraphIndexEntry[];
}

export interface StyleIndexEntry {
  readonly styleId: string;
  readonly type: string;
  readonly nodeId: string;
  readonly name: string | null;
  readonly basedOn: string | null;
}

export interface OoxmlIndexes {
  /** The tree revision these projections were derived from. */
  readonly revision: number;
  /** Body story first, then any other story parts, keyed by part name. */
  readonly stories: ReadonlyMap<string, StoryIndexEntry>;
  /** Every paragraph across every story, keyed by node id. */
  readonly paragraphs: ReadonlyMap<string, ParagraphIndexEntry>;
  readonly relationships: ReadonlyMap<string, readonly RelationshipRecord[]>;
  readonly styles: ReadonlyMap<string, StyleIndexEntry>;
}

function isWml(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function attr(element: OoxmlElement, localName: string): string | null {
  for (const a of element.attributes) {
    if (a.namespaceUri === WML_NAMESPACE_URI && a.localName === localName) return a.value;
  }
  return null;
}

/**
 * Text content of a run subtree.
 *
 * `w:t` contributes its characters, `w:tab` a tab, `w:br`/`w:cr` a newline — matching how
 * the authored model reads a run, so an index built from the tree and a model built from
 * the same source agree on paragraph text. A GENERIC child contributes nothing: unknown
 * content has no text projection, but it is still present in the tree, which is exactly the
 * difference from the legacy model that dropped the run entirely.
 */
function runText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  if (node.kind === 'generic') return '';
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') return '';
  let text = '';
  for (const child of node.children) text += runText(child);
  return text;
}

function indexParagraph(paragraph: OoxmlElement, ordinal: number): ParagraphIndexEntry {
  const runIds: string[] = [];
  let text = '';
  // A `w:hyperlink` is a run CONTAINER: its runs are part of the paragraph's text, so the
  // index descends into it. Reading only direct `w:r` children left the index disagreeing
  // with `segmentsOf` about how long every paragraph holding a link was.
  const visit = (child: OoxmlNode): void => {
    if (child.kind === 'run') {
      runIds.push(child.id);
      text += runText(child);
      return;
    }
    if (child.kind === 'hyperlink') {
      for (const inner of child.children) visit(inner);
    }
  };
  for (const child of paragraph.children) visit(child);
  return { nodeId: paragraph.id, ordinal, text, runIds };
}

/** The `w:body` element of a part, if it has one. */
function findBody(root: OoxmlElement): OoxmlElement | null {
  if (root.kind === 'body') return root;
  for (const child of root.children) {
    if (child.kind === 'textValue') continue;
    const found = findBody(child);
    if (found) return found;
  }
  return null;
}

function indexStory(part: OoxmlPart): StoryIndexEntry | null {
  const body = findBody(part.root);
  if (!body) return null;
  const paragraphs: ParagraphIndexEntry[] = [];
  for (const child of body.children) {
    if (child.kind === 'paragraph') paragraphs.push(indexParagraph(child, paragraphs.length));
  }
  return { partName: part.name, rootId: body.id, paragraphs };
}

/** Style definitions, read out of the generic `w:styles` tree. */
function indexStyles(part: OoxmlPart | undefined): Map<string, StyleIndexEntry> {
  const styles = new Map<string, StyleIndexEntry>();
  if (!part) return styles;
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isWml(node, 'style')) {
      const styleId = attr(node, 'styleId');
      if (styleId !== null) {
        let name: string | null = null;
        let basedOn: string | null = null;
        for (const child of node.children) {
          if (isWml(child, 'name')) name = attr(child, 'val');
          if (isWml(child, 'basedOn')) basedOn = attr(child, 'val');
        }
        // First definition wins, matching a reader that would not let a later duplicate
        // silently retarget an id.
        if (!styles.has(styleId)) {
          styles.set(styleId, {
            styleId,
            type: attr(node, 'type') ?? '',
            nodeId: node.id,
            name,
            basedOn,
          });
        }
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return styles;
}

const STYLES_PART_RE = /\/styles\.xml$/i;

/**
 * Derive every index from one canonical package revision.
 *
 * Pure: the same package and revision always produce the same index, which is what makes
 * "rebuild rather than mutate" a safe invalidation strategy.
 */
export function deriveOoxmlIndexes(pkg: OoxmlPackage, revision: number): OoxmlIndexes {
  const stories = new Map<string, StoryIndexEntry>();
  const paragraphs = new Map<string, ParagraphIndexEntry>();

  const main = pkg.parts.get(pkg.mainDocumentPart);
  const ordered = [
    ...(main ? [main] : []),
    ...[...pkg.parts.values()].filter((part) => part.name !== pkg.mainDocumentPart),
  ];

  for (const part of ordered) {
    const story = indexStory(part);
    if (!story) continue;
    stories.set(part.name, story);
    for (const paragraph of story.paragraphs) paragraphs.set(paragraph.nodeId, paragraph);
  }

  const stylesPart = [...pkg.parts.values()].find((part) => STYLES_PART_RE.test(part.name));

  return Object.freeze({
    revision,
    stories,
    paragraphs,
    relationships: pkg.relationships,
    styles: indexStyles(stylesPart),
  });
}
