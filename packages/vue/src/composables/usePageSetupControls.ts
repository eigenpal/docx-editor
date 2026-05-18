/**
 * Page-setup composable — owns the section-properties write path
 * (margins, page size, orientation) and the ruler-driven margin /
 * indent / tab-stop edit handlers. Bumps `stateTick` after every
 * write so `currentSectionProps` re-evaluates and the rulers redraw
 * with the new shape — Vue's shallowRef wouldn't see the deep
 * mutation otherwise.
 */

import type { Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Document, SectionProperties } from '@eigenpal/docx-editor-core/types/document';
import {
  setIndentLeft,
  setIndentRight,
  setIndentFirstLine,
  removeTabMark,
} from '@eigenpal/docx-editor-core/prosemirror/commands/paragraph';

export interface UsePageSetupControlsOptions {
  editorView: Ref<EditorView | null>;
  getDocument: () => Document | null;
  readOnly: Ref<boolean>;
  stateTick: Ref<number>;
  reLayout: () => void;
  emit: (event: string, ...args: unknown[]) => void;
}

export function usePageSetupControls(opts: UsePageSetupControlsOptions) {
  function handlePageSetupApply(sp: Partial<SectionProperties>) {
    const doc = opts.getDocument();
    if (!doc?.package?.document) return;
    const existing = doc.package.document.finalSectionProperties ?? {};
    doc.package.document.finalSectionProperties = { ...existing, ...sp };
    opts.stateTick.value++;
    opts.reLayout();
    opts.emit('change', doc);
  }

  function applyMarginChange(
    property: 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom',
    twips: number
  ) {
    if (opts.readOnly.value) return;
    handlePageSetupApply({ [property]: twips });
  }

  function handleLeftMarginChange(twips: number) {
    applyMarginChange('marginLeft', twips);
  }
  function handleRightMarginChange(twips: number) {
    applyMarginChange('marginRight', twips);
  }
  function handleTopMarginChange(twips: number) {
    applyMarginChange('marginTop', twips);
  }
  function handleBottomMarginChange(twips: number) {
    applyMarginChange('marginBottom', twips);
  }

  function handleIndentLeftChange(twips: number) {
    const view = opts.editorView.value;
    if (!view) return;
    setIndentLeft(twips)(view.state, view.dispatch);
  }
  function handleIndentRightChange(twips: number) {
    const view = opts.editorView.value;
    if (!view) return;
    setIndentRight(twips)(view.state, view.dispatch);
  }
  function handleFirstLineIndentChange(twips: number) {
    const view = opts.editorView.value;
    if (!view) return;
    // Negative twips → hanging indent (matches React's flag-shape API).
    if (twips < 0) {
      setIndentFirstLine(-twips, true)(view.state, view.dispatch);
    } else {
      setIndentFirstLine(twips, false)(view.state, view.dispatch);
    }
  }
  function handleTabMarkRemove(positionTwips: number) {
    const view = opts.editorView.value;
    if (!view) return;
    removeTabMark(positionTwips)(view.state, view.dispatch);
  }

  return {
    handlePageSetupApply,
    handleLeftMarginChange,
    handleRightMarginChange,
    handleTopMarginChange,
    handleBottomMarginChange,
    handleIndentLeftChange,
    handleIndentRightChange,
    handleFirstLineIndentChange,
    handleTabMarkRemove,
  };
}
