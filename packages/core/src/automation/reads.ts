// Every read the protocol answers, derived from one canonical package.
//
// INTERNAL. There is exactly one implementation of "what are this story's paragraphs", "what
// does this paragraph say" and "what is between these two positions", and both hosts run it
// over the package their port hands back. That is the whole reason the browser host cannot
// drift from the headless one: it is not that two implementations agree, it is that there is
// one implementation.
//
// TEXT COMES FROM `paragraphTextOf`, the same offset authority the tree ops validate against,
// so a length a consumer reads and an offset it then writes at are the same vocabulary. A
// paragraph text derived any other way — a layout span, a painted node, a projection — reads a
// field or a note differently and puts every subsequent offset one character out.
//
// THE STORY IS THE MAIN BODY, and it is named rather than implied: `bodyStory` is the one story
// this protocol slice addresses. Header, footer and note stories exist in the same package and
// have their OWN paragraph sets; nothing here flattens them together, so adding them later adds
// a story rather than changing what an existing handle means.
//
// PARAGRAPH ORDER IS READING ORDER, descending into tables and block-level content controls.
// Word's paragraph collection contains cell paragraphs, and an object model that skipped them
// would report a document shorter than the one on screen — then place an insertion in the wrong
// paragraph, because the caller counted with a different list than the engine writes with.

import { paraIdOf } from '../store/package/para-id.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  bodyStoryRoot,
  collectStoryParagraphs,
  storyParagraphs,
} from '../store/package/story-blocks.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import { paragraphTextOf } from '../store/store/tree-ops.ts';

/** The separator Word's own text properties put at a paragraph mark. */
export const PARAGRAPH_MARK = '\r';

export interface AutomationParagraphRead {
  readonly nodeId: string;
  /** `w14:paraId` as the document writes it, or null when the file declared none. */
  readonly paraId: string | null;
  readonly text: string;
}

/**
 * One TOP-LEVEL block of the story, for the one operation that is structural about the story
 * itself: emptying it.
 *
 * The paragraph list is a flat reading order and cannot answer "what would removing this take with
 * it" — a table is one block holding many paragraphs — so a plan that has to take blocks OUT reads
 * them here instead. `removable` is this file's business rather than the planner's, because whether
 * a block can leave the tree is a property of the tree: `deleteBlock` names `w:p`, `w:tbl` and
 * `w:tr` only, and it refuses a paragraph whose mark ends a section, since dropping that mark would
 * merge the section into the next one and take its page setup over every page it governed.
 */
export interface AutomationBlockRead {
  readonly id: string;
  readonly kind: 'paragraph' | 'table' | 'other';
  /** Paragraphs this block holds, in reading order — itself, when it is one. */
  readonly paragraphIds: readonly string[];
  /** Whether `deleteBlock` may name it. */
  readonly removable: boolean;
}

export interface AutomationDocumentReads {
  /** The main body part, for callers that plan tree ops against it. */
  readonly bodyPart: OoxmlPart | null;
  /** Canonical ids of the body story's paragraphs, in reading order. */
  readonly bodyParagraphIds: readonly string[];
  /** The body story's own blocks, in document order. */
  readonly bodyBlocks: readonly AutomationBlockRead[];
  /** Whether a canonical id is one of this story's paragraphs right now. */
  has(paragraphId: string): boolean;
  /** Position of a paragraph in the story, or -1. */
  indexOf(paragraphId: string): number;
  /** A paragraph's read, or null when it is not in the story. */
  paragraph(paragraphId: string): AutomationParagraphRead | null;
  /** A paragraph's text in model-offset vocabulary, or null when it is not in the story. */
  paragraphText(paragraphId: string): string | null;
  /** The story's paragraphs joined by a paragraph mark. */
  bodyText(): string;
}

const NONE: readonly string[] = Object.freeze([]);
const NO_BLOCKS: readonly AutomationBlockRead[] = Object.freeze([]);

const EMPTY_READS: AutomationDocumentReads = Object.freeze({
  bodyPart: null,
  bodyParagraphIds: NONE,
  bodyBlocks: NO_BLOCKS,
  has: () => false,
  indexOf: () => -1,
  paragraph: () => null,
  paragraphText: () => null,
  bodyText: () => '',
});

/** The story root's own children, each with what it holds and whether it can be removed. */
function storyBlockReads(root: OoxmlNode): readonly AutomationBlockRead[] {
  if (root.kind === 'textValue') return NO_BLOCKS;
  return Object.freeze(
    root.children
      .filter((child) => child.kind !== 'textValue')
      .map((child) => {
        const paragraphIds: OoxmlNode[] = [];
        collectStoryParagraphs([child], paragraphIds, 0);
        const kind =
          child.kind === 'paragraph' ? 'paragraph' : child.kind === 'table' ? 'table' : 'other';
        const endsASection =
          child.kind === 'paragraph' &&
          namedChild(paragraphPropertiesNodeOf(child), 'sectPr') !== undefined;
        return Object.freeze({
          id: child.id,
          kind,
          paragraphIds: Object.freeze(paragraphIds.map((node) => node.id)),
          removable: kind !== 'other' && !endsASection,
        }) as AutomationBlockRead;
      })
  );
}

/**
 * Project the reads out of a package snapshot.
 *
 * Pure and cheap to throw away: packages are immutable, so a caller caches this on package
 * IDENTITY and never has to reason about invalidation.
 */
export function documentReads(pkg: OoxmlPackage): AutomationDocumentReads {
  const main: OoxmlPart | undefined = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return EMPTY_READS;
  const root = bodyStoryRoot(main);
  if (!root) return EMPTY_READS;

  const nodes: readonly OoxmlNode[] = storyParagraphs(root);
  const bodyParagraphIds = Object.freeze(nodes.map((node) => node.id));
  const positions = new Map<string, number>();
  const byId = new Map<string, OoxmlNode>();
  nodes.forEach((node, index) => {
    positions.set(node.id, index);
    byId.set(node.id, node);
  });

  // Text is read lazily and memoized: a story search touches every paragraph, while reading
  // one paragraph must not walk the whole body.
  const texts = new Map<string, string>();
  const textOf = (paragraphId: string): string | null => {
    if (!positions.has(paragraphId)) return null;
    const cached = texts.get(paragraphId);
    if (cached !== undefined) return cached;
    const text = paragraphTextOf(main, paragraphId) ?? '';
    texts.set(paragraphId, text);
    return text;
  };

  return {
    bodyPart: main,
    bodyParagraphIds,
    bodyBlocks: storyBlockReads(root),
    has: (paragraphId) => positions.has(paragraphId),
    indexOf: (paragraphId) => positions.get(paragraphId) ?? -1,
    paragraph(paragraphId) {
      const node = byId.get(paragraphId);
      if (!node) return null;
      return { nodeId: paragraphId, paraId: paraIdOf(node), text: textOf(paragraphId) ?? '' };
    },
    paragraphText: textOf,
    bodyText: () => bodyParagraphIds.map((id) => textOf(id) ?? '').join(PARAGRAPH_MARK),
  };
}
