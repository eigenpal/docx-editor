// Header/footer story layout (phase 2 of the legacy-lane retirement).
//
// A header or footer is a STORY laid out at the section's content width with no pagination:
// its height is whatever its blocks flow to. That flow height — never an anchored-object
// extent — is what sizes the box on every page (the #856 rule).
//
// Baseline stories are laid out once per variant for furniture height / content-area
// push-down. Allowlisted PAGE/NUMPAGES/SECTIONPAGES fields need context-sensitive projection
// because digit widths affect right-tab alignment. Callers obtain those via
// {@link HeaderFooterStoryLayout.withPageContext}:
//
//   - no dynamic fields → identity reuse of the baseline
//   - NUMPAGES only → one cached layout per page count
//   - SECTIONPAGES only → one cached layout per section page count
//   - PAGE (alone or combined) → bounded LRU over the distinct evaluated values
//
// Scope stays furniture-only; body field projection remains deferred.

import type { OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { stableHash } from '../store/comparators/canonical.ts';
import { canonicalOoxmlFingerprint } from '../store/package/ooxml-tree.ts';
import {
  detectStoryPageFields,
  fieldPageContextToken,
  storyNeedsPageFields,
  type FieldPageContext,
  type StoryPageFieldNeeds,
} from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  PageRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { storyBlocks } from './story-roots.ts';

/**
 * Distinct PAGE-dependent contexts retained before LRU eviction.
 *
 * Finalize stores projected furniture on each page record, so eviction cannot drop published
 * geometry. The bound only prevents the per-story cache from retaining every historical
 * `(pageNumber, pageCount)` pair across edits.
 */
export const DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES = 128;

export interface HeaderFooterStoryLayout {
  readonly partName: string;
  /** Main-document relationship id when the furniture source knows it. */
  readonly rId?: string;
  /**
   * Bounded identity of the story's canonical OOXML content.
   *
   * Furniture cache keys must not rely on {@link flowHeight} alone: equal-height A→B edits
   * would otherwise reuse stale page furniture. Derived as a 16-hex FNV-1a over the part's
   * canonical fingerprint — never DOM identity or unbounded raw serialization in the key.
   * PAGE/NUMPAGES/SECTIONPAGES projection shares this key; page context is cached separately.
   */
  readonly contentKey: string;
  /** Story-relative fragments; origin at the story box's top-left. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** The height the blocks actually flow to — what sizes the box on every page. */
  readonly flowHeight: number;
  /**
   * Allowlisted complex PAGE / NUMPAGES / SECTIONPAGES presence detected for this story.
   *
   * Callers use this to skip attaching a page-field projector when the baseline is enough.
   */
  readonly pageFieldNeeds: StoryPageFieldNeeds;
  /**
   * Re-layout this story under a page-field context.
   *
   * Field-free stories return `this`. Count-only stories cache by the counts they read.
   * PAGE stories cache by the distinct evaluated values (including format) with a bounded LRU.
   */
  readonly withPageContext: (ctx: FieldPageContext) => HeaderFooterStoryLayout;
}

/** Bounded digest of a header/footer part's canonical tree for furniture cache identity. */
export function headerFooterContentKey(part: OoxmlPart): string {
  return stableHash(canonicalOoxmlFingerprint(part));
}

function createBoundedContextCache(maxEntries: number): {
  get(key: string): HeaderFooterStoryLayout | undefined;
  set(key: string, value: HeaderFooterStoryLayout): void;
  readonly size: number;
} {
  const capacity = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, HeaderFooterStoryLayout>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Lay one header/footer part out at `contentWidth`.
 *
 * Line ids are namespaced by part so the body's `line-N` counter — which incremental
 * convergence compares — never moves because a header changed.
 *
 * When `pageContext` is set, allowlisted PAGE/NUMPAGES/SECTIONPAGES instructions project
 * live values; otherwise those fields contribute only cached result text (often empty).
 * Field-free stories ignore `pageContext` and share one baseline layout.
 *
 * `defaultTabStopPt` is the document's `w:settings/w:defaultTabStop` (ECMA-376 §17.15.1.25)
 * in points; absent keeps the 0.5" schema default. Furniture tabs on the SAME grid as the
 * body — a page-number tab in a metric-locale footer belongs on the document's interval, not
 * on a constant. It sits at the tail because the parameters ahead of it are already
 * positional; new callers should keep passing `undefined` for what they do not set.
 */
export function layoutHeaderFooterStory(
  part: OoxmlPart,
  contentWidth: number,
  measurer: TextMeasurer,
  producer: string,
  cache?: ParagraphLayoutCache<readonly PendingLine[]>,
  styleCascade?: StyleCascadeTable,
  pageContext?: FieldPageContext,
  maxPageContextEntries: number = DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES,
  defaultTabStopPt?: number,
  displayMode?: RevisionDisplayMode
): HeaderFooterStoryLayout {
  const needs = detectStoryPageFields(part.root);
  const contextCache = createBoundedContextCache(maxPageContextEntries);
  const blocks = storyBlocks(part);
  // Content identity is of the authored part, not of a page-field projection.
  const contentKey = headerFooterContentKey(part);
  let baseline: HeaderFooterStoryLayout | undefined;

  const layoutOnce = (ctx: FieldPageContext | undefined): HeaderFooterStoryLayout => {
    const effectiveCtx = storyNeedsPageFields(needs) ? ctx : undefined;
    const token = fieldPageContextToken(effectiveCtx, needs);

    if (token === '') {
      if (baseline) return baseline;
    } else {
      const cached = contextCache.get(token);
      if (cached) return cached;
    }

    let lineCounter = 0;
    const flow = flowBlocksInBox(blocks, 0, Math.max(1, contentWidth), 0, 0, {
      measurer,
      cache,
      // The mode is part of the producer for the same reason it is in the body: it changes
      // every break, and a header carrying revisions must resolve the same mode as the body.
      producer: producer + token + (displayMode ? `|rev:${displayMode}` : ''),
      nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
      styleCascade,
      pageContext: effectiveCtx,
      ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
      ...(displayMode ? { displayMode } : {}),
    });

    const story: HeaderFooterStoryLayout = {
      partName: part.name,
      contentKey,
      fragments: flow.blocks,
      flowHeight: flow.bottom,
      pageFieldNeeds: needs,
      withPageContext: (next) => {
        if (!storyNeedsPageFields(needs)) return baseline ?? story;
        return layoutOnce(next);
      },
    };

    if (token === '') {
      baseline = story;
    } else {
      contextCache.set(token, story);
    }
    return story;
  };

  return layoutOnce(pageContext);
}

/**
 * Remap a section-local page onto the document sheet stack.
 *
 * Each section lays out with its own origin; the orchestrator assigns global indices and
 * cumulative Y so sheets of different heights still stack without gaps or overlaps.
 *
 * Furniture boxes must move with the sheet. The attach-time `pageFieldProjector` closes over
 * the section-local page box, so a bare shift of the current story box is not enough —
 * document-level page-field finalize would re-place at the pre-stack origin and paint
 * would compute `(story.box.y - page.box.y)` as a negative full-page offset onto the prior
 * sheet. Wrap the projector so projected furniture receives the same `dy`.
 */
export function remapPage(page: PageRecord, globalIndex: number, sheetY: number): PageRecord {
  const dy = sheetY - page.box.y;
  const shiftBox = (box: LayoutBox): LayoutBox => ({ ...box, y: box.y + dy });
  const shiftFurniture = (
    story: HeaderFooterStoryRecord | undefined
  ): HeaderFooterStoryRecord | undefined => {
    if (!story) return undefined;
    const shifted: HeaderFooterStoryRecord = { ...story, box: shiftBox(story.box) };
    if (!story.pageFieldProjector) return shifted;
    const project = story.pageFieldProjector;
    return {
      ...shifted,
      pageFieldProjector: (context) => {
        const projected = project(context);
        return { ...projected, box: shiftBox(projected.box) };
      },
    };
  };
  const shiftNoteArea = (
    area: import('./semantic-records.ts').NoteAreaRecord | undefined
  ): import('./semantic-records.ts').NoteAreaRecord | undefined => {
    if (!area) return undefined;
    return {
      ...area,
      box: shiftBox(area.box),
      ...(area.separator
        ? { separator: { ...area.separator, box: shiftBox(area.separator.box) } }
        : {}),
      notes: area.notes.map((note) => ({ ...note, box: shiftBox(note.box) })),
    };
  };
  const header = shiftFurniture(page.header);
  const footer = shiftFurniture(page.footer);
  const footnotes = shiftNoteArea(page.footnotes);
  const endnotes = shiftNoteArea(page.endnotes);
  return {
    ...page,
    id: `page-${globalIndex}`,
    index: globalIndex,
    box: shiftBox(page.box),
    contentBox: shiftBox(page.contentBox),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(footnotes ? { footnotes } : {}),
    ...(endnotes ? { endnotes } : {}),
  };
}
