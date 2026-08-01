// Run and paragraph property edits at the selection (paginated-surface seam).
//
// The formatting lane: toggling a run property, setting one outright, and setting a
// paragraph property. They share one rule the structural edits do not — a change that
// covers a WHOLE paragraph also writes its mark, because that is what a list marker
// inherits its face from.

import type { TreeApplyResult, TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import {
  documentOrder,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';
import {
  formattingAt,
  isRunPropertyActive,
  mergedProperties,
  paragraphMarkOps,
  paragraphPropertiesOf,
  selectionRunProperties,
} from './surface-formatting.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** What the composition root lends this lane. */
export interface SurfaceFormatDeps {
  readonly session: TreeDocxSession;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null
  ): void;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  textOf(paragraphId: string): string;
}

type FormatMethods = Pick<
  PaginatedSurface,
  'setRunProperty' | 'setParagraphProperty' | 'toggleRunProperty' | 'formatting'
>;

export function createSurfaceFormat(deps: SurfaceFormatDeps): FormatMethods {
  const { session, commit, orderedRange, selectionMark, textOf } = deps;
  const currentLayout = {
    get value(): SemanticLayout {
      return deps.layout();
    },
  };
  const selectionNow = {
    get value(): SemanticSelection {
      return deps.selection();
    },
  };

  return {
    setRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      const properties = mergedProperties(
        selectionRunProperties(currentLayout.value, selectionNow.value),
        {
          localName,
          ...(attributes ? { attributes } : {}),
        }
      );
      commit(() =>
        session.applyTreeOps(
          [
            {
              op: 'setRunProperties',
              paragraphId: from.paragraphId,
              start: from.offset,
              end: to.offset,
              properties,
            },
            ...paragraphMarkOps(textOf(from.paragraphId), from, to, properties),
          ],
          selectionMark()
        )
      );
    },

    setParagraphProperty(localName, attributes) {
      const { from, to } = orderedRange();
      const order = documentOrder(currentLayout.value);
      const firstIndex = order.indexOf(from.paragraphId);
      const lastIndex = order.indexOf(to.paragraphId);
      if (firstIndex === -1 || lastIndex === -1) return;
      // EVERY paragraph the selection touches, not just the one the caret is in: selecting
      // three paragraphs and pressing centre must centre three paragraphs.
      const ops = order.slice(firstIndex, lastIndex + 1).map((paragraphId) => ({
        op: 'setParagraphProperties' as const,
        paragraphId,
        properties: mergedProperties(paragraphPropertiesOf(currentLayout.value, paragraphId), {
          localName,
          ...(attributes ? { attributes } : {}),
        }),
      }));
      if (ops.length === 0) return;
      commit(() => session.applyTreeOps(ops, selectionMark()));
    },

    formatting: () =>
      formattingAt(currentLayout.value, selectionNow.value, (paragraphId: string, runProperties) =>
        session.effectiveRunDefaults(paragraphId, runProperties)
      ),

    toggleRunProperty(localName, attributes) {
      const { from, to } = orderedRange();
      // A collapsed caret has no range to format. Stored marks — formatting that applies to
      // the NEXT character typed — are a separate lane; refusing is honest rather than
      // formatting a character the user did not select.
      if (from.paragraphId !== to.paragraphId || from.offset === to.offset) return;
      const active = isRunPropertyActive(currentLayout.value, selectionNow.value, localName);
      const properties = mergedProperties(
        selectionRunProperties(currentLayout.value, selectionNow.value),
        active
          ? // `w:u` is a closed enumeration, not a boolean: its off value is `none`,
            // and `val="0"` is an attribute value Word rejects outright.
            { localName, attributes: { val: localName === 'u' ? 'none' : '0' } }
          : { localName, ...(attributes ? { attributes } : {}) }
      );
      commit(() =>
        session.applyTreeOps(
          [
            {
              op: 'setRunProperties',
              paragraphId: from.paragraphId,
              start: from.offset,
              end: to.offset,
              // Toggling OFF sends an explicit `val="0"` rather than dropping the element:
              // the property may be inherited from a style, and removing the local override
              // would let the inherited value come back.
              properties,
            },
            ...paragraphMarkOps(textOf(from.paragraphId), from, to, properties),
          ],
          selectionMark()
        )
      );
    },
  };
}
