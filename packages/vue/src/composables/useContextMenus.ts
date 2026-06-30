/**
 * Right-click menu composable — owns the `contextMenu` /
 * `imageContextMenu` state plus the trio of handlers that surface them
 * (`handleContextMenu`, `handleSelectedImageContextMenu`,
 * `handleContextMenuAction`) and the wrap-select bridge used by the
 * image menu. Reads `selectedImage` from `useImageActions` and writes
 * back into it for cut/delete-image actions. Pages-level selection
 * primitives (`clearOverlay`, `setPmSelection`, `resolvePos`) are
 * passed in as callbacks so this composable can live independently of
 * the still-in-parent pointer wiring.
 */

import { computed, ref, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import {
  captureInlinePositionEmu,
  findImageElement,
} from '@eigenpal/docx-editor-core/painter-model';
import { getTableContext } from '@eigenpal/docx-editor-core/prosemirror/extensions/nodes/TableExtension';
import type { ImageLayoutTarget } from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import {
  copyImageToClipboard,
  pasteFromClipboard,
  triggerReplaceImage,
} from '../utils/imageClipboard';
import type { ImageSelectionInfo } from '../components/imageSelectionTypes';
import type {
  ImageContextMenuState,
  ImageContextMenuTextAction,
} from '../components/imageContextMenuTypes';
import { useTranslation } from '../i18n';

type Commands = Record<string, ((...args: unknown[]) => unknown) | undefined>;

export interface TextContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  hasSelection: boolean;
  inTable: boolean;
  onImage: boolean;
  canMergeCells: boolean;
  canSplitCell: boolean;
}

export interface UseContextMenusOptions {
  editorView: Ref<EditorView | null>;
  selectedImage: ShallowRef<ImageSelectionInfo | null>;
  zoom: Ref<number>;
  showImageProperties: Ref<boolean>;
  getCommands: () => Commands;
  clearOverlay: () => void;
  setPmSelection: (anchor: number, head?: number) => void;
  resolvePos: (clientX: number, clientY: number) => number | null;
}

export interface UseContextMenusReturn {
  contextMenu: Ref<TextContextMenuState>;
  imageContextMenu: Ref<ImageContextMenuState | null>;
  imageContextMenuTextActions: ComputedRef<ImageContextMenuTextAction[]>;
  handleContextMenu: (event: MouseEvent) => void;
  handleSelectedImageContextMenu: (event: MouseEvent) => void;
  handleImageWrapSelect: (target: ImageLayoutTarget) => void;
  handleContextMenuAction: (action: string) => void;
}

export function useContextMenus(opts: UseContextMenusOptions): UseContextMenusReturn {
  const { t } = useTranslation();

  const contextMenu = ref<TextContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    hasSelection: false,
    inTable: false,
    onImage: false,
    canMergeCells: false,
    canSplitCell: false,
  });

  // Image-specific right-click menu — shows wrap-mode options instead of the
  // generic text menu when the user right-clicks a rendered image.
  const imageContextMenu = ref<ImageContextMenuState | null>(null);

  // Cut / Copy / Paste / Delete items appended below the layout choices in
  // the image context menu so users don't have to flip menus to do
  // clipboard work on a selected image.
  const imageContextMenuTextActions = computed<ImageContextMenuTextAction[]>(() => [
    { action: 'cut', label: t('contextMenu.cut'), shortcut: t('contextMenu.cutShortcut') },
    { action: 'copy', label: t('contextMenu.copy'), shortcut: t('contextMenu.copyShortcut') },
    {
      action: 'paste',
      label: t('contextMenu.paste'),
      shortcut: t('contextMenu.pasteShortcut'),
      dividerAfter: true,
    },
    {
      action: 'delete',
      label: t('contextMenu.delete'),
      shortcut: t('contextMenu.deleteShortcut'),
    },
  ]);

  function handleContextMenu(event: MouseEvent) {
    const view = opts.editorView.value;
    if (!view) return;
    const target = event.target as HTMLElement;

    // Check if right-click is on an image
    const imageEl = findImageElement(target);
    if (imageEl) {
      const docFrom = Number(imageEl.dataset.docFrom);
      if (!isNaN(docFrom)) {
        try {
          const sel = NodeSelection.create(view.state.doc, docFrom);
          view.dispatch(view.state.tr.setSelection(sel));
        } catch {
          /* ignore */
        }
        opts.selectedImage.value = {
          element: imageEl,
          pmPos: docFrom,
          width: imageEl.offsetWidth,
          height: imageEl.offsetHeight,
        };
        opts.clearOverlay();

        // Image right-click takes priority over the text context menu —
        // surface the layout-options menu instead and bail out.
        const node = view.state.doc.nodeAt(docFrom);
        if (node && node.type.name === 'image') {
          const wrapType = (node.attrs.wrapType as WrapType | undefined) ?? 'inline';
          const cssFloat = node.attrs.cssFloat as 'left' | 'right' | 'none' | null | undefined;
          imageContextMenu.value = {
            open: true,
            position: { x: event.clientX, y: event.clientY },
            pmPos: docFrom,
            currentWrapType: wrapType,
            currentCssFloat: cssFloat ?? null,
            inlinePositionEmu:
              wrapType === 'inline'
                ? captureInlinePositionEmu(imageEl, opts.zoom.value)
                : undefined,
          };
          contextMenu.value.isOpen = false;
          return;
        }
      }
    }

    // Move the PM caret to the right-click point unless the click landed
    // inside the current selection (or exactly on a collapsed caret —
    // re-dispatching the same position would force a needless re-layout).
    // Mirrors React's PagedEditor: table ops and other caret-scoped
    // actions then operate on the cell/run the user actually clicked.
    {
      const { from, to } = view.state.selection;
      const clickPos = opts.resolvePos(event.clientX, event.clientY);
      if (clickPos !== null && (clickPos < from || clickPos > to)) {
        try {
          opts.setPmSelection(clickPos);
        } catch {
          // resolved position may be out of range after a concurrent edit
        }
      }
    }

    const tableCtx = getTableContext(view.state);
    const { empty } = view.state.selection;

    // Right-clicking outside an image clears any open image context menu
    // — otherwise the image menu can stay visible while TextContextMenu
    // is shown over a different element. Mirrors React's PagedEditor
    // exclusivity (only one of the two menus visible at a time).
    if (imageContextMenu.value) imageContextMenu.value = null;

    contextMenu.value = {
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      hasSelection: !empty,
      inTable: tableCtx.isInTable,
      onImage: !!imageEl,
      canMergeCells: !!tableCtx.hasMultiCellSelection,
      canSplitCell: !!tableCtx.canSplitCell,
    };
  }

  function handleSelectedImageContextMenu(event: MouseEvent) {
    const view = opts.editorView.value;
    const sel = opts.selectedImage.value;
    if (!view || !sel) return;
    const node = view.state.doc.nodeAt(sel.pmPos);
    if (!node || node.type.name !== 'image') return;
    const wrapType = (node.attrs.wrapType as WrapType | undefined) ?? 'inline';
    const cssFloat = node.attrs.cssFloat as 'left' | 'right' | 'none' | null | undefined;
    imageContextMenu.value = {
      open: true,
      position: { x: event.clientX, y: event.clientY },
      pmPos: sel.pmPos,
      currentWrapType: wrapType,
      currentCssFloat: cssFloat ?? null,
      inlinePositionEmu:
        wrapType === 'inline' ? captureInlinePositionEmu(sel.element, opts.zoom.value) : undefined,
    };
    contextMenu.value.isOpen = false;
  }

  function handleImageWrapSelect(target: ImageLayoutTarget) {
    const view = opts.editorView.value;
    const state = imageContextMenu.value;
    if (!view || !state) return;
    const cmds = opts.getCommands();
    const optsArg =
      state.inlinePositionEmu && target !== 'inline'
        ? { initialPositionEmu: state.inlinePositionEmu }
        : undefined;
    const cmd = cmds.setImageWrapType?.(state.pmPos, target, optsArg) as
      | ((
          state: EditorView['state'],
          dispatch: EditorView['dispatch'],
          view: EditorView
        ) => boolean)
      | undefined;
    if (!cmd) return;
    cmd(view.state, (tr) => view.dispatch(tr), view);
    view.focus();
  }

  function handleContextMenuAction(action: string) {
    const view = opts.editorView.value;
    if (!view) return;
    const cmds = opts.getCommands();

    switch (action) {
      case 'cut':
        if (opts.selectedImage.value) {
          copyImageToClipboard(view, opts.selectedImage.value.pmPos);
          const pos = opts.selectedImage.value.pmPos;
          const node = view.state.doc.nodeAt(pos);
          if (node) {
            view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
            opts.selectedImage.value = null;
          }
        } else {
          // Focus the hidden PM first so the browser's clipboard op targets it.
          // The hidden editor is off-screen (left: -9999px) and not focused
          // after a context-menu click, so execCommand would otherwise no-op
          // (#929). The trailing view.focus() below runs too late.
          view.focus();
          document.execCommand('cut');
        }
        break;
      case 'copy':
        if (opts.selectedImage.value) {
          copyImageToClipboard(view, opts.selectedImage.value.pmPos);
        } else {
          view.focus();
          document.execCommand('copy');
        }
        break;
      case 'paste':
        pasteFromClipboard(view);
        break;
      case 'pasteAsPlainText':
        // Strip all formatting — insert the clipboard's text/plain only.
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
          })
          .catch(() => {
            // Clipboard read denied — nothing to paste.
          });
        break;
      case 'delete': {
        const { from, to } = view.state.selection;
        if (from !== to) view.dispatch(view.state.tr.delete(from, to));
        break;
      }
      case 'selectAll': {
        const sel = TextSelection.create(view.state.doc, 0, view.state.doc.content.size);
        view.dispatch(view.state.tr.setSelection(sel));
        break;
      }
      case 'imageProperties':
        if (opts.selectedImage.value) {
          opts.showImageProperties.value = true;
        }
        break;
      case 'replaceImage':
        if (opts.selectedImage.value) {
          triggerReplaceImage(view, opts.selectedImage.value.pmPos);
        }
        break;
      case 'deleteImage': {
        if (opts.selectedImage.value) {
          const pos = opts.selectedImage.value.pmPos;
          const node = view.state.doc.nodeAt(pos);
          if (node) {
            view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
            opts.selectedImage.value = null;
          }
        }
        break;
      }
      case 'addRowAbove':
      case 'addRowBelow':
      case 'deleteRow':
      case 'addColumnLeft':
      case 'addColumnRight':
      case 'deleteColumn':
      case 'mergeCells':
      case 'splitCell':
      case 'selectTable':
      case 'deleteTable': {
        const cmd = cmds[action];
        if (cmd) {
          const command = cmd() as (
            state: EditorView['state'],
            dispatch: EditorView['dispatch'],
            view: EditorView
          ) => boolean;
          command(view.state, (tr) => view.dispatch(tr), view);
        }
        break;
      }
    }
    view.focus();
  }

  return {
    contextMenu,
    imageContextMenu,
    imageContextMenuTextActions,
    handleContextMenu,
    handleSelectedImageContextMenu,
    handleImageWrapSelect,
    handleContextMenuAction,
  };
}
