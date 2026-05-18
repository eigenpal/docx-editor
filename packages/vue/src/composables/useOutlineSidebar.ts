/**
 * Outline + sidebar composable — owns the outline panel toggle (which
 * lazily collects headings from the PM doc on open), the sidebar
 * toggle (which seeds extractCommentsAndChanges so the panel opens
 * with fresh data), the outline-navigate scroll-into-view, and the
 * "click-outside-sidebar clears active item" mouse-down handler.
 */

import type { Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { collectHeadings } from '@eigenpal/docx-editor-core/utils/headingCollector';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils/headingCollector';

export interface UseOutlineSidebarOptions {
  editorView: Ref<EditorView | null>;
  showOutline: Ref<boolean>;
  showSidebar: Ref<boolean>;
  outlineHeadings: Ref<HeadingInfo[]>;
  activeSidebarItem: Ref<string | null>;
  extractCommentsAndChanges: () => void;
}

export function useOutlineSidebar(opts: UseOutlineSidebarOptions) {
  function handleToggleOutline() {
    if (!opts.showOutline.value) {
      // Opening: collect headings
      const view = opts.editorView.value;
      if (view) {
        opts.outlineHeadings.value = collectHeadings(view.state.doc);
      }
    }
    opts.showOutline.value = !opts.showOutline.value;
  }

  function handleOutlineNavigate(pmPos: number) {
    const view = opts.editorView.value;
    if (!view) return;
    // Set selection to heading position and scroll into view
    const $pos = view.state.doc.resolve(Math.min(pmPos + 1, view.state.doc.content.size));
    const sel = TextSelection.near($pos);
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
    view.focus();
  }

  function handleToggleSidebar() {
    if (!opts.showSidebar.value) {
      opts.extractCommentsAndChanges();
    }
    opts.showSidebar.value = !opts.showSidebar.value;
  }

  function handleEditorScrollMouseDown(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Clicks inside the editor pages, sidebar card, or comment margin
    // markers are real interactions — leave activeSidebarItem alone.
    if (
      target.closest('.paged-editor__pages') ||
      target.closest('.unified-sidebar') ||
      target.closest('.docx-comment-margin-markers')
    ) {
      return;
    }
    opts.activeSidebarItem.value = null;
  }

  return {
    handleToggleOutline,
    handleOutlineNavigate,
    handleToggleSidebar,
    handleEditorScrollMouseDown,
  };
}
