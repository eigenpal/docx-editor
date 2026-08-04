/**
 * Honest-empty geometry / interaction members for the DocxEditor facade.
 *
 * The paginated surface owns pointer and frame interaction internally; the Editor
 * contract still exposes the cluster so adapters can wire against a stable shape.
 * These answers are typed empties — never invented geometry — and live here so the
 * composition root stays thin.
 */

import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import { emptyInteractionFrame } from './docx-editor-support.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

export type HonestEmptyInteractionApi = Pick<
  Editor,
  | 'getInteractionFrame'
  | 'getDisplay'
  | 'getSelectionRects'
  | 'getCaretRect'
  | 'getCaretGeometry'
  | 'getSelectionGeometry'
  | 'hitTest'
  | 'getPageGeometry'
  | 'getScrollGeometry'
  | 'resolvePointer'
  | 'dispatchInteraction'
  | 'getAccessibilityObservation'
  | 'getInputHostObservation'
  | 'getInteractionHostMetrics'
  | 'getCaretClientRect'
>;

export function createHonestEmptyInteractionApi(deps: {
  getSurface: () => PaginatedSurface | null;
  getMode: () => 'edit' | 'view';
  /** The LIVE editing mode, which Viewing changes without remounting. */
  getEditingMode?: () => 'editing' | 'suggesting' | 'viewing';
}): HonestEmptyInteractionApi {
  return {
    getInteractionFrame: () => emptyInteractionFrame(),
    getDisplay: () => [],
    getSelectionRects: () => [],
    getCaretRect: () => null,
    getCaretGeometry: () => null,
    getSelectionGeometry: () => null,
    hitTest: () => null,
    getPageGeometry: () => [],
    getScrollGeometry: () => emptyInteractionFrame().scrollGeometry,
    resolvePointer: () => ({
      ok: false,
      code: 'unsupported',
      reason: 'the paginated surface owns pointer interaction internally',
    }),
    dispatchInteraction: () => ({
      outcome: {
        ok: false,
        code: 'unsupported',
        reason: 'the paginated surface owns interaction dispatch internally',
      },
      hostEffects: [],
    }),
    getAccessibilityObservation: () => {
      const surface = deps.getSurface();
      return {
        owner: 'none' as const,
        scope: { kind: 'body' as const },
        frameId: emptyInteractionFrame().id,
        modelRevision: surface?.session.revision() ?? 0,
        // The LIVE mode, not only the construction-time one: hosts gate their chrome on
        // this, and it read `true` while every command was being refused with `locked`.
        editable:
          surface !== null &&
          surface.session.editable &&
          deps.getMode() !== 'view' &&
          deps.getEditingMode?.() !== 'viewing',
        name: { kind: 'absent' as const },
        entries: [],
        focus: { scope: null, focused: false },
        selection: null,
        paintedPagesAssistiveRole: null,
      };
    },
    getInputHostObservation: () => null,
    getInteractionHostMetrics: () => null,
    getCaretClientRect: () => null,
  };
}
