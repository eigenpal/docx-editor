import { useCallback, useMemo, useState } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  getTableContext,
  addRowAbove,
  addRowBelow,
  deleteRow as pmDeleteRow,
  addColumnLeft,
  addColumnRight,
  deleteColumn as pmDeleteColumn,
  mergeCells as pmMergeCells,
  selectTable as pmSelectTable,
  deleteTable as pmDeleteTable,
  type TableContextInfo,
} from '@eigenpal/docx-editor-core/prosemirror';
import {
  setImageWrapType,
  type ImageLayoutTarget,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import { en as defaultLocale } from '@eigenpal/docx-editor-i18n';
import { useTranslation } from '../../../i18n';
import type { Translations } from '@eigenpal/docx-editor-i18n';
import { useImageContextMenu } from '../../ImageContextMenu';
import { type TextContextAction, type TextContextMenuItem } from '../../TextContextMenu';
import { findSelectionYPosition } from '../internals/pmAnchors';
import { PENDING_COMMENT_ID } from '../commentFactories';
import { formatKeys } from '../../dialogs/KeyboardShortcutsDialog/ShortcutItem';

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  hasSelection: boolean;
  cursorInTable: boolean;
  tableContext: TableContextInfo | null;
}

/**
 * Owns the right-click context-menu surfaces:
 *  - text context menu (cut/copy/paste/pasteAsPlainText/delete/selectAll
 *    + add-comment when there's a selection + table ops when in a cell)
 *  - image context menu (wrap-type swatches + reused text actions)
 *
 * Shortcut strings come from i18n (`contextMenu.*Shortcut`) and are
 * passed through `formatKeys` so Mac users see `⌘⇧V` instead of the
 * literal `Ctrl+Shift+V` — handles the full Ctrl/Alt/Shift swap set,
 * not just Ctrl.
 *
 * The text menu's `addComment` branch needs to mutate comment-management
 * state (selection range, Y position, sidebar visibility, isAddingComment,
 * floatingCommentBtn). To keep this hook independent of comment state
 * ownership, the parent passes a single `onAddComment({ from, to, yPos })`
 * callback that fans out to those setters.
 */
export function useContextMenus({
  getActiveEditorView,
  focusActiveEditor,
  openSplitCellDialog,
  scrollContainerRef,
  editorContentRef,
  i18n,
  onAddComment,
}: {
  getActiveEditorView: () => EditorView | null | undefined;
  focusActiveEditor: () => void;
  openSplitCellDialog: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  editorContentRef: React.RefObject<HTMLDivElement | null>;
  i18n: Translations | undefined;
  onAddComment: (range: { from: number; to: number; yPos: number | null }) => void;
}) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    hasSelection: false,
    cursorInTable: false,
    tableContext: null,
  });

  const imageContextMenu = useImageContextMenu();

  // The body editor's right-click is wired through PagedEditor's
  // onContextMenu (handleContextMenu below). This handler is mounted on the
  // outer editor shell to catch HF-region clicks while the inline editor is
  // open — the body's plumbing won't fire for HF clicks.
  const handleEditorContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.paged-editor__pages') && !target.closest('.hf-inline-editor')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const view = getActiveEditorView();
      const tableContext = view ? getTableContext(view.state) : { isInTable: false };
      const { from, to } = view?.state.selection ?? { from: 0, to: 0 };
      const hasSel = from !== to;
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        hasSelection: hasSel,
        cursorInTable: tableContext.isInTable,
        tableContext: tableContext.isInTable ? tableContext : null,
      });
    },
    [getActiveEditorView]
  );

  const handleContextMenu = useCallback(
    (data: {
      x: number;
      y: number;
      hasSelection: boolean;
      image?: {
        pos: number;
        wrapType: WrapType;
        cssFloat?: 'left' | 'right' | 'none' | null;
        inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
      } | null;
    }) => {
      // An image right-click takes priority over the text context menu.
      if (data.image) {
        imageContextMenu.openForImage({
          x: data.x,
          y: data.y,
          wrapType: data.image.wrapType,
          cssFloat: data.image.cssFloat,
          pos: data.image.pos,
          inlinePositionEmu: data.image.inlinePositionEmu,
        });
        return;
      }
      const view = getActiveEditorView();
      const tableContext = view ? getTableContext(view.state) : { isInTable: false };
      setContextMenu({
        isOpen: true,
        position: data,
        hasSelection: data.hasSelection,
        cursorInTable: tableContext.isInTable,
        tableContext: tableContext.isInTable ? tableContext : null,
      });
    },
    [getActiveEditorView, imageContextMenu]
  );

  const handleImageWrapApply = useCallback(
    (target: ImageLayoutTarget) => {
      const view = getActiveEditorView();
      if (!view || imageContextMenu.imagePos === null) return;
      // For inline → anchor, hand the captured EMU offset to the command so
      // the new float lands where the inline glyph used to sit.
      const opts = imageContextMenu.inlinePositionEmu
        ? { initialPositionEmu: imageContextMenu.inlinePositionEmu }
        : undefined;
      setImageWrapType(imageContextMenu.imagePos, target, opts)(view.state, view.dispatch);
    },
    [getActiveEditorView, imageContextMenu.imagePos, imageContextMenu.inlinePositionEmu]
  );

  // Cut / Copy / Paste / Delete ride along inside the image context menu so
  // users don't need to flip menus to do basic clipboard work on the
  // selected image. Shortcuts go through `formatKeys` so multi-modifier
  // combos like `Ctrl+Shift+V` render as `⌘⇧V` on Mac instead of `⌘+Shift+V`.
  const imageContextMenuTextActions = useMemo(
    () => [
      {
        action: 'cut' as TextContextAction,
        label: t('contextMenu.cut'),
        shortcut: formatKeys(t('contextMenu.cutShortcut')),
      },
      {
        action: 'copy' as TextContextAction,
        label: t('contextMenu.copy'),
        shortcut: formatKeys(t('contextMenu.copyShortcut')),
      },
      {
        action: 'paste' as TextContextAction,
        label: t('contextMenu.paste'),
        shortcut: formatKeys(t('contextMenu.pasteShortcut')),
        dividerAfter: true,
      },
      {
        action: 'delete' as TextContextAction,
        label: t('contextMenu.delete'),
        shortcut: formatKeys(t('contextMenu.deleteShortcut')),
      },
    ],
    [t]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      hasSelection: false,
      cursorInTable: false,
      tableContext: null,
    });
  }, []);

  const contextMenuItems = useMemo((): TextContextMenuItem[] => {
    // `formatKeys` handles all modifier swaps on Mac (Ctrl+ → ⌘, Shift+ → ⇧,
    // Alt+ → ⌥) so multi-modifier strings like `Ctrl+Shift+V` render as
    // `⌘⇧V` rather than the wrong `⌘+Shift+V`.
    const items: TextContextMenuItem[] = [
      {
        action: 'cut',
        label: t('contextMenu.cut'),
        shortcut: formatKeys(t('contextMenu.cutShortcut')),
      },
      {
        action: 'copy',
        label: t('contextMenu.copy'),
        shortcut: formatKeys(t('contextMenu.copyShortcut')),
      },
      {
        action: 'paste',
        label: t('contextMenu.paste'),
        shortcut: formatKeys(t('contextMenu.pasteShortcut')),
      },
      {
        action: 'pasteAsPlainText',
        label: t('contextMenu.pastePlainText'),
        shortcut: formatKeys(t('contextMenu.pastePlainTextShortcut')),
        dividerAfter: true,
      },
      {
        action: 'delete',
        label: t('contextMenu.delete'),
        shortcut: formatKeys(t('contextMenu.deleteShortcut')),
        dividerAfter: !contextMenu.hasSelection && !contextMenu.cursorInTable,
      },
    ];
    if (contextMenu.hasSelection) {
      items.push({
        action: 'addComment',
        label: 'Comment',
        dividerAfter: !contextMenu.cursorInTable,
      });
    }
    if (contextMenu.cursorInTable) {
      items.push(
        { action: 'addRowAbove', label: 'Insert row above' },
        { action: 'addRowBelow', label: 'Insert row below' },
        { action: 'deleteRow', label: 'Delete row', dividerAfter: true },
        { action: 'addColumnLeft', label: 'Insert column left' },
        { action: 'addColumnRight', label: 'Insert column right' },
        { action: 'deleteColumn', label: 'Delete column' },
        {
          action: 'mergeCells',
          label: i18n?.table?.mergeCells ?? defaultLocale.table.mergeCells,
          disabled: !contextMenu.tableContext?.hasMultiCellSelection,
        },
        {
          action: 'splitCell',
          label: i18n?.table?.splitCell ?? defaultLocale.table.splitCell,
          disabled: !contextMenu.tableContext?.canSplitCell,
          dividerAfter: true,
        },
        {
          action: 'selectTable',
          label: i18n?.table?.selectTable ?? defaultLocale.table.selectTable,
        },
        {
          action: 'deleteTable',
          label: i18n?.table?.deleteTable ?? defaultLocale.table.deleteTable,
          dividerAfter: true,
        }
      );
    }
    items.push({
      action: 'selectAll',
      label: t('contextMenu.selectAll'),
      shortcut: formatKeys(t('contextMenu.selectAllShortcut')),
    });
    return items;
  }, [contextMenu.hasSelection, contextMenu.cursorInTable, contextMenu.tableContext, i18n, t]);

  const handleContextMenuAction = useCallback(
    async (action: TextContextAction) => {
      const view = getActiveEditorView();
      if (!view) return;

      // Focus the hidden PM so execCommand targets the right element.
      focusActiveEditor();

      switch (action) {
        case 'cut':
          document.execCommand('cut');
          break;
        case 'copy':
          document.execCommand('copy');
          break;
        case 'paste': {
          // Use the Clipboard API — document.execCommand('paste') is blocked in modern browsers.
          try {
            const items = await navigator.clipboard.read();
            let html = '';
            let text = '';
            for (const item of items) {
              if (item.types.includes('text/html')) {
                html = await (await item.getType('text/html')).text();
              }
              if (item.types.includes('text/plain')) {
                text = await (await item.getType('text/plain')).text();
              }
            }
            const dt = new DataTransfer();
            if (html) dt.items.add(html, 'text/html');
            if (text) dt.items.add(text, 'text/plain');
            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            });
            view.dom.dispatchEvent(pasteEvent);
          } catch {
            try {
              const text = await navigator.clipboard.readText();
              if (text) view.dispatch(view.state.tr.insertText(text));
            } catch {
              // Clipboard access denied
            }
          }
          break;
        }
        case 'pasteAsPlainText':
          try {
            const text = await navigator.clipboard.readText();
            if (text) view.dispatch(view.state.tr.insertText(text));
          } catch {
            // Clipboard access denied
          }
          break;
        case 'delete': {
          const { from, to } = view.state.selection;
          if (from !== to) {
            view.dispatch(view.state.tr.deleteRange(from, to));
          }
          break;
        }
        case 'selectAll':
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, 0, view.state.doc.content.size)
            )
          );
          break;
        case 'addRowAbove':
          addRowAbove(view.state, view.dispatch);
          break;
        case 'addRowBelow':
          addRowBelow(view.state, view.dispatch);
          break;
        case 'deleteRow':
          pmDeleteRow(view.state, view.dispatch);
          break;
        case 'addColumnLeft':
          addColumnLeft(view.state, view.dispatch);
          break;
        case 'addColumnRight':
          addColumnRight(view.state, view.dispatch);
          break;
        case 'deleteColumn':
          pmDeleteColumn(view.state, view.dispatch);
          break;
        case 'mergeCells':
          pmMergeCells(view.state, view.dispatch);
          break;
        case 'splitCell':
          openSplitCellDialog();
          break;
        case 'selectTable':
          pmSelectTable(view.state, view.dispatch);
          break;
        case 'deleteTable':
          pmDeleteTable(view.state, view.dispatch);
          break;
        case 'addComment': {
          const { from, to } = view.state.selection;
          if (from === to) break;
          // Compute Y position BEFORE dispatching — the dispatch triggers a
          // re-layout that rebuilds page DOM and invalidates the old spans.
          const yPos = findSelectionYPosition(
            scrollContainerRef.current,
            editorContentRef.current,
            from
          );
          const pendingMark = view.state.schema.marks.comment.create({
            commentId: PENDING_COMMENT_ID,
          });
          const tr = view.state.tr.addMark(from, to, pendingMark);
          tr.setSelection(TextSelection.create(tr.doc, to));
          view.dispatch(tr);
          onAddComment({ from, to, yPos });
          break;
        }
      }
      // TextContextMenu calls onClose after onAction, so no need to close here.
    },
    [
      getActiveEditorView,
      focusActiveEditor,
      openSplitCellDialog,
      scrollContainerRef,
      editorContentRef,
      onAddComment,
    ]
  );

  return {
    contextMenu,
    imageContextMenu,
    handleEditorContextMenu,
    handleContextMenu,
    handleContextMenuClose,
    handleImageWrapApply,
    imageContextMenuTextActions,
    contextMenuItems,
    handleContextMenuAction,
  };
}
