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
// A DOCUMENT IS SEVERAL STORIES, and each is read on its own. The body, a header or footer per
// variant per section, and one story per footnote and endnote: they live in different parts, hold
// their own paragraphs, and commit through their own transaction scope. Nothing here flattens them
// together, and a story's reads carry the scope its writes go through — so a handle naming a
// header cannot be planned against the body by accident.
//
// PARAGRAPH ORDER IS READING ORDER, descending into tables and block-level content controls.
// Word's paragraph collection contains cell paragraphs, and an object model that skipped them
// would report a document shorter than the one on screen — then place an insertion in the wrong
// paragraph, because the caller counted with a different list than the engine writes with.

import {
  resolveHeaderFooterResolutionBySection,
  type HeaderFooterSectionResolution,
  type HeaderFooterSlotMeta,
  type HeaderFooterVariant,
} from '../store/package/hf-references.ts';
import {
  findNoteById,
  isNormalNote,
  noteIdOf,
  notesOf,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import { paraIdOf } from '../store/package/para-id.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { bodyStoryRoot, collectStoryParagraphs, storyParagraphs } from '../store/package/story-blocks.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import { paragraphTextOf } from '../store/store/tree-ops.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import { sectionReads, type AutomationSectionRead } from './sections.ts';
import { styleIndex, type AutomationStyleIndex } from './styles.ts';
import {
  BODY_STORY,
  HEADER_FOOTER_VARIANTS,
  storyKey,
  type AutomationStoryId,
} from './stories.ts';

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

/** One story's own reads. Everything a command or a query about a stretch of text needs. */
export interface AutomationStoryReads {
  readonly story: AutomationStoryId;
  /** The part the story's blocks live in, for callers that plan tree ops against it. */
  readonly part: OoxmlPart;
  /**
   * The transaction scope this story's writes commit through.
   *
   * Carried WITH the reads rather than derived by the caller: a header's scope is its `r:id`, and a
   * planner that resolved that itself would be resolving relationships — which is exactly the
   * engine identity a handle exists to keep out of the operation vocabulary.
   */
  readonly scope: StoryScope;
  /** Canonical ids of the story's paragraphs, in reading order. */
  readonly paragraphIds: readonly string[];
  /** The story's own top-level blocks, in document order. */
  readonly blocks: readonly AutomationBlockRead[];
  /** Whether a canonical id is one of this story's paragraphs right now. */
  has(paragraphId: string): boolean;
  /** Position of a paragraph in the story, or -1. */
  indexOf(paragraphId: string): number;
  /** A paragraph's read, or null when it is not in the story. */
  paragraph(paragraphId: string): AutomationParagraphRead | null;
  /** A paragraph's text in model-offset vocabulary, or null when it is not in the story. */
  paragraphText(paragraphId: string): string | null;
  /** The story's paragraphs joined by a paragraph mark. */
  text(): string;
  /**
   * What the package's `styles.xml` declares, for the reads and writes that speak style NAMES.
   *
   * Built once per package and shared, because a style write over a stretch resolves one name for
   * every paragraph it covers and indexing the part per paragraph would make that O(styles x
   * paragraphs) for a value that cannot change inside a batch.
   */
  styles(): AutomationStyleIndex;
}

/** What one header or footer slot resolves to, without naming a part or a relationship. */
export interface AutomationFurnitureRead {
  readonly kind: 'header' | 'footer';
  readonly variant: HeaderFooterVariant;
  /** False when the part comes from an earlier section ("same as previous"). */
  readonly declared: boolean;
}

/** Reads over the whole package: its stories, its sections, and what it declares about styles. */
export interface AutomationPackageReads {
  readonly package: OoxmlPackage | null;
  /** The main story, or null when this host holds no document. */
  readonly body: AutomationStoryReads | null;
  /** One story's reads, or null when the document has no such story. */
  story(id: AutomationStoryId): AutomationStoryReads | null;
  /** Which story a canonical paragraph id belongs to, or null when no story holds it. */
  storyOf(paragraphId: string): AutomationStoryId | null;
  /** The document's sections, in document order. */
  sections(): readonly AutomationSectionRead[];
  /** The furniture one section declares or inherits, in a stable order. */
  furniture(sectionIndex: number): readonly AutomationFurnitureRead[];
  /** Every note of one kind, by `w:id`, in the order the notes part writes them. */
  noteIds(noteKind: NoteKind): readonly number[];
  styles(): AutomationStyleIndex;
}

const NONE: readonly string[] = Object.freeze([]);
/** What a host with no document declares about styles: nothing. */
const NO_STYLE_INDEX: AutomationStyleIndex = Object.freeze({
  nameOf: () => null,
  idOf: () => null,
  defaultId: null,
  present: false,
});
const NO_BLOCKS: readonly AutomationBlockRead[] = Object.freeze([]);
const NO_SECTIONS: readonly AutomationSectionRead[] = Object.freeze([]);
const NO_FURNITURE: readonly AutomationFurnitureRead[] = Object.freeze([]);

export const EMPTY_READS: AutomationPackageReads = Object.freeze({
  package: null,
  body: null,
  story: () => null,
  storyOf: () => null,
  sections: () => NO_SECTIONS,
  furniture: () => NO_FURNITURE,
  noteIds: () => Object.freeze([]) as readonly number[],
  styles: () => NO_STYLE_INDEX,
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

/** One story's reads over a root that is already known to be in `part`. */
function storyReadsOver(
  story: AutomationStoryId,
  part: OoxmlPart,
  scope: StoryScope,
  root: OoxmlNode,
  styles: () => AutomationStyleIndex
): AutomationStoryReads {
  const nodes: readonly OoxmlNode[] = storyParagraphs(root);
  const paragraphIds = Object.freeze(nodes.map((node) => node.id));
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
    const text = paragraphTextOf(part, paragraphId) ?? '';
    texts.set(paragraphId, text);
    return text;
  };

  return {
    story,
    part,
    scope,
    paragraphIds,
    blocks: storyBlockReads(root),
    has: (paragraphId) => positions.has(paragraphId),
    indexOf: (paragraphId) => positions.get(paragraphId) ?? -1,
    paragraph(paragraphId) {
      const node = byId.get(paragraphId);
      if (!node) return null;
      return { nodeId: paragraphId, paraId: paraIdOf(node), text: textOf(paragraphId) ?? '' };
    },
    paragraphText: textOf,
    text: () => paragraphIds.map((id) => textOf(id) ?? '').join(PARAGRAPH_MARK),
    styles,
  };
}

/**
 * Project the reads out of a package snapshot.
 *
 * Pure and cheap to throw away: packages are immutable, so a caller caches this on package
 * IDENTITY and never has to reason about invalidation. Stories are resolved LAZILY and memoized
 * per story: a batch about the body must not pay for opening every header in the document, and a
 * batch about one footnote must not walk the other four hundred.
 */
export function documentReads(pkg: OoxmlPackage): AutomationPackageReads {
  const main: OoxmlPart | undefined = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return EMPTY_READS;

  let styles: AutomationStyleIndex | undefined;
  const stylesOf = (): AutomationStyleIndex => (styles ??= styleIndex(pkg));

  let furnitureBySection: readonly HeaderFooterSectionResolution[] | undefined;
  const resolution = (): readonly HeaderFooterSectionResolution[] =>
    (furnitureBySection ??= resolveHeaderFooterResolutionBySection(pkg));

  let sections: readonly AutomationSectionRead[] | undefined;

  const cache = new Map<string, AutomationStoryReads | null>();

  const slotOf = (
    story: Extract<AutomationStoryId, { kind: 'header' | 'footer' }>
  ): HeaderFooterSlotMeta | null => {
    const section = resolution()[story.sectionIndex];
    if (!section) return null;
    const slots = story.kind === 'header' ? section.headers : section.footers;
    return slots.get(story.variant) ?? null;
  };

  const build = (story: AutomationStoryId): AutomationStoryReads | null => {
    if (story.kind === 'body') {
      const root = bodyStoryRoot(main);
      if (!root) return null;
      return storyReadsOver(story, main, { kind: 'body' }, root, stylesOf);
    }
    if (story.kind === 'note') {
      const notesPart = resolveNotesPart(pkg, story.noteKind);
      if (!notesPart) return null;
      const note = findNoteById(notesPart.root, story.noteId);
      // Reachable only if it is a note a document HAS: a separator is markup Word needs and a
      // caller has no business editing, so it is not addressable as a story either.
      if (!note || !isNormalNote(note)) return null;
      return storyReadsOver(
        story,
        notesPart,
        { kind: 'notesPart', noteKind: story.noteKind },
        note,
        stylesOf
      );
    }
    const slot = slotOf(story);
    if (!slot) return null;
    // The part's ROOT is the story: `w:hdr` and `w:ftr` hold blocks directly.
    return storyReadsOver(story, slot.part, { kind: 'headerFooter', rId: slot.rId }, slot.part.root, stylesOf);
  };

  const story = (id: AutomationStoryId): AutomationStoryReads | null => {
    const key = storyKey(id);
    if (cache.has(key)) return cache.get(key) ?? null;
    const built = build(id);
    cache.set(key, built);
    return built;
  };

  /**
   * Which story holds a paragraph.
   *
   * Resolved by ASKING each story rather than by parsing the id, even though ids are part-
   * qualified: a part can hold many stories (a notes part holds one per note), so the part name
   * alone does not name the story a paragraph belongs to. Ordered cheapest-first, and the body is
   * both the common case and the only story most documents have.
   */
  const storyOf = (paragraphId: string): AutomationStoryId | null => {
    const body = story(BODY_STORY);
    if (body?.has(paragraphId)) return BODY_STORY;
    for (const [index] of resolution().entries()) {
      for (const kind of ['header', 'footer'] as const) {
        for (const variant of HEADER_FOOTER_VARIANTS) {
          const id: AutomationStoryId = { kind, sectionIndex: index, variant };
          if (story(id)?.has(paragraphId)) return id;
        }
      }
    }
    for (const noteKind of ['footnote', 'endnote'] as const) {
      for (const noteId of noteIdsOf(noteKind)) {
        const id: AutomationStoryId = { kind: 'note', noteKind, noteId };
        if (story(id)?.has(paragraphId)) return id;
      }
    }
    return null;
  };

  const noteIdsOf = (noteKind: NoteKind): readonly number[] => {
    const part = resolveNotesPart(pkg, noteKind);
    if (!part) return NONE_NUMBERS;
    const ids: number[] = [];
    for (const note of notesOf(part.root)) {
      // THE SEPARATORS ARE NOT NOTES. Every notes part Word writes begins with a separator and
      // a continuation separator (`w:id` -1 and 0); listing them would report a document with two
      // more footnotes than it has, and hand a caller a story that paints no note anywhere.
      if (!isNormalNote(note)) continue;
      const id = noteIdOf(note);
      if (id !== null) ids.push(id);
    }
    return Object.freeze(ids);
  };

  return {
    package: pkg,
    get body() {
      return story(BODY_STORY);
    },
    story,
    storyOf,
    sections: () => (sections ??= sectionReads(pkg, main, resolution())),
    furniture(sectionIndex) {
      const section = resolution()[sectionIndex];
      if (!section) return NO_FURNITURE;
      const found: AutomationFurnitureRead[] = [];
      for (const kind of ['header', 'footer'] as const) {
        const slots = kind === 'header' ? section.headers : section.footers;
        for (const variant of HEADER_FOOTER_VARIANTS) {
          const slot = slots.get(variant);
          if (!slot) continue;
          found.push(Object.freeze({ kind, variant, declared: !slot.inherited }));
        }
      }
      return Object.freeze(found);
    },
    noteIds: noteIdsOf,
    styles: stylesOf,
  };
}

const NONE_NUMBERS: readonly number[] = Object.freeze([]);
