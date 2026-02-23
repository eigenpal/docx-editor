import React from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorPlugin } from '../../plugin-api/types';
import type { Document } from '../../types/document';
import { createReviewPluginState, findActiveRevisionId } from './extractor';
import {
  ReviewPageRailOverlay,
  REVIEW_PAGE_RAIL_OVERLAY_STYLES,
} from './components/ReviewPageRailOverlay';
import type { ReviewPluginState } from './types';

export interface ReviewPluginOptions {
  /** Width of the per-page review rail in pixels. */
  railWidth?: number;
  /** @deprecated Kept for backwards compatibility. Use railWidth. */
  panelWidth?: number;
}

export function createReviewPlugin(
  options: ReviewPluginOptions = {}
): EditorPlugin<ReviewPluginState> {
  let cachedState: ReviewPluginState | null = null;
  let cachedDoc: PMNode | null = null;
  let cachedDocumentModel: Document | null = null;

  const getInitialState = (): ReviewPluginState => ({
    revisions: [],
    activeRevisionId: null,
    totalCount: 0,
    supportedCount: 0,
    unsupportedCount: 0,
    mutateDocumentModel: undefined,
  });

  return {
    id: 'review',
    name: 'Review',
    initialize: () => {
      const initial = getInitialState();
      cachedState = initial;
      cachedDoc = null;
      cachedDocumentModel = null;
      return initial;
    },
    onStateChange: (view, context) => {
      const currentDoc = view.state.doc;
      const currentDocumentModel = context?.documentModel ?? null;
      const mutateDocumentModel = context?.mutateDocumentModel;
      const { from, to } = view.state.selection;

      if (
        !cachedState ||
        cachedDoc !== currentDoc ||
        cachedDocumentModel !== currentDocumentModel
      ) {
        const nextState = createReviewPluginState(view.state.doc, from, to, currentDocumentModel);
        cachedState = {
          ...nextState,
          mutateDocumentModel,
        };
        cachedDoc = currentDoc;
        cachedDocumentModel = currentDocumentModel;
        return cachedState;
      }

      const activeRevisionId = findActiveRevisionId(cachedState.revisions, from, to);
      if (
        activeRevisionId === cachedState.activeRevisionId &&
        mutateDocumentModel === cachedState.mutateDocumentModel
      ) {
        return undefined;
      }

      const nextState: ReviewPluginState = {
        ...cachedState,
        activeRevisionId,
        mutateDocumentModel,
      };
      cachedState = nextState;
      return nextState;
    },
    renderOverlay: (context, state, editorView) => {
      if (!state || state.revisions.length === 0) return null;
      return React.createElement(ReviewPageRailOverlay, {
        context,
        editorView,
        pluginState: state,
        railWidth: options.railWidth ?? options.panelWidth ?? 300,
      });
    },
    styles: REVIEW_PAGE_RAIL_OVERLAY_STYLES,
  };
}

export const reviewPlugin = createReviewPlugin();

export { RevisionPanel, REVIEW_PANEL_STYLES } from './components/RevisionPanel';
export {
  extractRevisionsFromDoc,
  findActiveRevisionId,
  createReviewPluginState,
} from './extractor';
export {
  canApplyBodyModelRevisionDecision,
  canApplyBulkBodyModelRevisionDecision,
  canApplyHeaderFooterRevisionDecision,
  canApplyBulkHeaderFooterRevisionDecision,
  applyBodyModelRevisionDecisionToDocument,
  applyBulkBodyModelRevisionDecisionToDocument,
  applyHeaderFooterRevisionDecisionToDocument,
  applyBulkHeaderFooterRevisionDecisionToDocument,
  createRevisionDecisionTransaction,
  createBulkRevisionDecisionTransaction,
  applyRevisionDecision,
  applyBulkRevisionDecision,
} from './actions';
export type {
  ReviewDecision,
  ReviewPluginState,
  ReviewRevisionItem,
  ReviewRevisionStatus,
  ReviewRevisionType,
} from './types';
