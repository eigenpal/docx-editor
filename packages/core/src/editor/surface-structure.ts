// Structural edits at the selection (paginated-surface seam).
//
// Breaks, lists, indent and section properties: the edits that change what the document
// IS rather than how a run looks. They share one shape — resolve the paragraphs the
// selection touches, plan tree ops, commit once — and they are the only surface methods
// that read `numbering.xml` or `w:sectPr`, so they sit together rather than in the
// composition root.

import type { TreeApplyResult, TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { TreeDocOp } from '@docx-editor.dev/core-contract/store';
import {
  documentOrder,
  enumerateDocumentSections,
  readSectionProperties,
  storyBlocks,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import type { ListMarkerRecord } from '@docx-editor.dev/core-contract/layout';
import { mergedProperties, paragraphPropertiesOf } from './surface-formatting.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** What the composition root lends this lane: its session, its layout, and its commit. */
export interface SurfaceStructureDeps {
  readonly session: TreeDocxSession;
  /** The CURRENT layout — read per call, never captured. */
  layout(): SemanticLayout;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null
  ): void;
  orderedStart(): SemanticPosition;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  collapsedAt(position: SemanticPosition): SemanticSelection;
  deleteSelectionOps(): readonly TreeDocOp[];
  /** Whether `numId` declares `level`, for refusing a demote that would erase the marker. */
  numberingLevelExists(numId: string, level: number): boolean;
}

type StructureMethods = Pick<
  PaginatedSurface,
  | 'insertTab'
  | 'insertLineBreak'
  | 'insertPageBreak'
  | 'isListParagraph'
  | 'isListActive'
  | 'toggleList'
  | 'adjustIndent'
  | 'canAdjustIndent'
  | 'sectionProperties'
  | 'sectionPropertiesAt'
  | 'setSectionProperties'
  | 'insertSectionBreak'
>;

export function createSurfaceStructure(deps: SurfaceStructureDeps): StructureMethods {
  const { session, commit, orderedStart, orderedRange, selectionMark, collapsedAt } = deps;
  const deleteSelectionOps = deps.deleteSelectionOps;
  const currentLayout = {
    get value(): SemanticLayout {
      return deps.layout();
    },
  };

  /** Word's Increase/Decrease Indent step: one default tab stop. */
  const INDENT_STEP_TWIPS = 720;
  /** `w:ilvl` is 0..8 (ECMA-376 17.9.24). */
  const MAX_LIST_LEVEL = 8;

  /** The list level of a paragraph, or null when it carries no numbering. */
  function listLevelOf(paragraphId: string): number | null {
    return markerOf(paragraphId)?.level ?? null;
  }

  /** The marker layout resolved for a paragraph, or null when it is not a list item. */
  function markerOf(paragraphId: string): ListMarkerRecord | null {
    for (const page of currentLayout.value.pages) {
      for (const fragment of page.fragments) {
        if (fragment.kind !== 'paragraph' || fragment.paragraphId !== paragraphId) continue;
        return fragment.marker ?? null;
      }
    }
    return null;
  }

  /**
   * Which kind of list a paragraph is in.
   *
   * Read from the resolved level's `w:numFmt`, never from the marker GLYPH: a bullet
   * level may legitimately use a letter-shaped character (Wingdings `§`, Courier `o` —
   * both of which Word's own default list uses at levels 2 and 3), so sniffing the text
   * reported half of every multi-level bullet list as numbered.
   */
  function listKindOf(paragraphId: string): 'bullet' | 'ordered' | null {
    const marker = markerOf(paragraphId);
    if (!marker) return null;
    return marker.numFmt === 'bullet' ? 'bullet' : 'ordered';
  }

  /**
   * The `w:numId` an adjacent paragraph of the same kind already uses, if any.
   *
   * Turning a list back on rejoins the list around it rather than minting a second
   * definition — otherwise re-bulleting one item in the middle of a list gave it a
   * different glyph from its neighbours.
   */
  function adjacentListNumId(
    touched: readonly string[],
    kind: 'bullet' | 'ordered'
  ): string | null {
    const order = documentOrder(currentLayout.value);
    const first = order.indexOf(touched[0] ?? '');
    const last = order.indexOf(touched[touched.length - 1] ?? '');
    if (first === -1 || last === -1) return null;
    // The paragraph BEFORE the selection, then the one after.
    for (const index of [first - 1, last + 1]) {
      const neighbour = order[index];
      if (!neighbour) continue;
      const marker = markerOf(neighbour);
      if (!marker) continue;
      if ((marker.numFmt === 'bullet' ? 'bullet' : 'ordered') === kind) return marker.numId;
    }
    return null;
  }

  /**
   * Whether a list paragraph could move to `level`.
   *
   * A `w:abstractNum` need not declare all nine levels — plenty of real documents declare
   * only `ilvl 0` — and a paragraph moved to a level its definition does not declare
   * resolves to no marker at all: it silently stops being a list item and springs back to
   * the margin. Refusing the move keeps the list intact, which is what Word's greyed-out
   * Increase Indent communicates.
   */
  function listLevelExists(marker: ListMarkerRecord, level: number): boolean {
    if (level < 0 || level > MAX_LIST_LEVEL) return false;
    return deps.numberingLevelExists(marker.numId, level);
  }

  /** Authored `w:ind/@left` in twips, zero when the paragraph states none. */
  function leftIndentTwipsOf(
    properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
  ): number {
    const ind = properties.find((property) => property.localName === 'ind');
    const raw = ind?.attributes?.left ?? ind?.attributes?.start;
    if (!raw || !/^-?\d{1,7}$/.test(raw)) return 0;
    return Number(raw);
  }

  return {
    insertTab() {
      const start = orderedStart();
      commit(
        () =>
          session.applyTreeOps(
            [
              ...deleteSelectionOps(),
              { op: 'insertTab', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    insertLineBreak() {
      const start = orderedStart();
      commit(
        () =>
          session.applyTreeOps(
            [
              ...deleteSelectionOps(),
              { op: 'insertHardBreak', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    insertPageBreak() {
      const start = orderedStart();
      commit(
        () =>
          session.applyTreeOps(
            [
              ...deleteSelectionOps(),
              { op: 'insertPageBreak', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    isListParagraph() {
      const { paragraphId } = orderedStart();
      return listLevelOf(paragraphId) !== null;
    },

    isListActive(kind) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout.value);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return false;
      const wanted = kind === 'bullet' ? 'bullet' : 'ordered';
      const touched = order.slice(firstIndex, lastIndex + 1);
      return (
        touched.length > 0 && touched.every((paragraphId) => listKindOf(paragraphId) === wanted)
      );
    },

    toggleList(kind) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout.value);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return false;
      const touched = order.slice(firstIndex, lastIndex + 1);
      if (touched.length === 0) return false;
      // Word toggles OFF only when the whole selection is already that list; a mixed
      // selection becomes one list rather than clearing half of it.
      const turningOff = touched.every((paragraphId) => listKindOf(paragraphId) === kind);
      const numId = turningOff
        ? null
        : (adjacentListNumId(touched, kind) ?? session.ensureListDefinition(kind));
      if (!turningOff && numId === null) return false;
      const ops: TreeDocOp[] = touched.map((paragraphId) => ({
        op: 'setListNumbering',
        paragraphId,
        numId,
      }));
      let committed = false;
      commit(() => {
        const result = session.applyTreeOps(ops, selectionMark());
        committed = result.committed;
        return result;
      });
      return committed;
    },

    canAdjustIndent(direction) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout.value);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return false;
      const step = direction === 'increase' ? 1 : -1;
      // Enabled when ANY paragraph the selection touches could move. Word greys the
      // control out only when nothing would happen at all.
      return order.slice(firstIndex, lastIndex + 1).some((paragraphId) => {
        const marker = markerOf(paragraphId);
        if (marker) return listLevelExists(marker, marker.level + step);
        const current = leftIndentTwipsOf(paragraphPropertiesOf(currentLayout.value, paragraphId));
        return Math.max(0, current + step * INDENT_STEP_TWIPS) !== current;
      });
    },

    adjustIndent(direction) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout.value);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return false;
      const step = direction === 'increase' ? 1 : -1;
      const ops: TreeDocOp[] = [];
      for (const paragraphId of order.slice(firstIndex, lastIndex + 1)) {
        const properties = paragraphPropertiesOf(currentLayout.value, paragraphId);
        const marker = markerOf(paragraphId);
        const level = marker?.level ?? null;
        if (marker && level !== null) {
          // A list item DEMOTES rather than shifting: `w:ilvl` is what picks the level's
          // format out of numbering.xml, so the marker changes with the indent the way
          // Word's Tab does. Nine levels exist (17.9.24); the ends are no-ops, not errors.
          const next = level + step;
          if (!listLevelExists(marker, next)) continue;
          ops.push({
            op: 'setListLevel',
            paragraphId,
            level: next,
          });
          continue;
        }
        const current = leftIndentTwipsOf(properties);
        const next = Math.max(0, current + step * INDENT_STEP_TWIPS);
        if (next === current) continue;
        const existing = properties.find((property) => property.localName === 'ind');
        ops.push({
          op: 'setParagraphProperties',
          paragraphId,
          properties: mergedProperties(properties, {
            localName: 'ind',
            attributes: {
              ...(existing?.attributes ?? {}),
              // Zero is written rather than dropped: an authored `w:ind` may inherit a
              // non-zero left from its style, and removing the attribute would let that
              // come back instead of taking the outdent.
              left: String(next),
            },
          }),
        });
      }
      if (ops.length === 0) return false;
      let committed = false;
      commit(() => {
        const result = session.applyTreeOps(ops, selectionMark());
        committed = result.committed;
        return result;
      });
      return committed;
    },

    sectionProperties: () => readSectionProperties(session.part()),

    sectionPropertiesAt(paragraphId) {
      const sections = enumerateDocumentSections(session.part());
      if (sections.length === 1) return sections[0]!.properties;
      const blocks = storyBlocks(session.part());
      const contains = (node: (typeof blocks)[number], id: string): boolean => {
        if (node.id === id) return true;
        for (const child of node.children) {
          if (child.kind !== 'textValue' && contains(child as (typeof blocks)[number], id)) {
            return true;
          }
        }
        return false;
      };
      const blockIndex = blocks.findIndex(
        (block) => block.id === paragraphId || contains(block, paragraphId)
      );
      // An unknown id falls back to the tail section — the document-wide answer.
      let owner = sections[sections.length - 1]!;
      if (blockIndex !== -1) {
        for (const section of sections) {
          if (section.blockStart <= blockIndex) owner = section;
          else break;
        }
      }
      return owner.properties;
    },

    setSectionProperties(update) {
      let committed = false;
      commit(() => {
        const result = session.applyTreeOps(
          [{ op: 'setSectionProperties', ...update }],
          selectionMark()
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },

    insertSectionBreak() {
      const start = orderedStart();
      const before = new Set(session.paragraphIds());
      let committed = false;
      commit(
        () => {
          const result = session.applyTreeOps(
            [
              // A break REPLACES a selection, like every other insertion.
              ...deleteSelectionOps(),
              { op: 'splitParagraph', paragraphId: start.paragraphId, offset: start.offset },
              // The HEAD keeps the original id; it ends the new section, cloning the
              // governing setup so the break changes where pages break, not how they look.
              { op: 'setSectionMark', paragraphId: start.paragraphId },
            ],
            selectionMark()
          );
          committed = result.committed;
          return result;
        },
        () => {
          // The caret lands at the start of the tail — the first paragraph of the
          // section the user keeps typing in, exactly where Word puts it.
          const tail = session.paragraphIds().find((id) => !before.has(id));
          return tail ? collapsedAt({ paragraphId: tail, offset: 0 }) : null;
        }
      );
      return committed;
    },
  };
}
