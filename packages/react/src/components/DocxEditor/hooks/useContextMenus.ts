import { useCallback, useMemo, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { SemanticTarget } from '@docx-editor.dev/core-contract/interaction';
import type { ImageLayoutTarget, TableContextInfo } from '../../../legacy-core-compat';
import type { WrapType } from '../../../lib/wrapTypes';
import { en as defaultLocale } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../../i18n';
import type { Translations } from '@docx-editor.dev/i18n';
import { useImageContextMenu } from '../../ImageContextMenu';
import { type TextContextAction, type TextContextMenuItem } from '../../TextContextMenu';
import { formatKeys } from '../../dialogs/KeyboardShortcutsDialog/ShortcutItem';

/** Whether two semantic targets address the same spot. */
function sameTarget(a: SemanticTarget, b: SemanticTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'atomic' && b.kind === 'atomic') return a.objectId === b.objectId;
  if (a.kind === 'text' && b.kind === 'text') {
    return a.graphemeOffset === b.graphemeOffset && a.identity.blockId === b.identity.blockId;
  }
  return false;
}

/**
 * The menu's view of the document, asked of the engine.
 *
 * Legacy read three things off the editing engine's state: whether the selection spans
 * anything, whether the caret is in a table, and whether it is inside a table of
 * contents. Each is a capability here. `getSelectedTable` and `isInsideToc` are stubs
 * today, so the table block and the TOC entry stay out of the menu rather than appearing
 * and doing nothing.
 */
function menuStateFor(editor: Editor | null): {
  hasSelection: boolean;
  cursorInTable: boolean;
  cursorInToc: boolean;
  tableContext: TableContextInfo | null;
} {
  // The published interaction frame, not `query({ type: 'selection' })` — that query is
  // part of the unwired query surface and answers null even when a selection exists,
  // which would leave the menu permanently reporting "nothing selected".
  const selection = editor?.getInteractionFrame().selection ?? null;
  const table = editor?.getSelectedTable() ?? null;
  return {
    // A selection spans something when its two ends differ. Both ends are semantic
    // targets: a text target carries an identity and a grapheme offset, an atomic one an
    // object id. Compared structurally rather than by reference, because the frame mints
    // fresh target objects on every publish.
    hasSelection: selection !== null && !sameTarget(selection.anchor, selection.head),
    cursorInTable: table !== null,
    cursorInToc: false,
    tableContext: table
      ? {
          isInTable: true,
          rowCount: table.rowCount,
          columnCount: table.columnCount,
          // The engine reports the table's shape, not which cells are selected, so the
          // merge/split entries stay disabled rather than claiming to be available.
          hasMultiCellSelection: false,
          canSplitCell: false,
        }
      : null,
  };
}

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  hasSelection: boolean;
  cursorInTable: boolean;
  cursorInToc: boolean;
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
  editorRef,
  focusActiveEditor,
  openSplitCellDialog,
  onUpdateTableOfContents,
  i18n,
  onAddComment,
}: {
  editorRef: React.RefObject<Editor | null>;
  focusActiveEditor: () => void;
  openSplitCellDialog: () => void;
  onUpdateTableOfContents?: (position?: number | null) => boolean;
  i18n: Translations | undefined;
  onAddComment: (range: { from: number; to: number; yPos: number | null }) => void;
}) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    hasSelection: false,
    cursorInTable: false,
    cursorInToc: false,
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
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        ...menuStateFor(editorRef.current),
      });
    },
    [editorRef]
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
      setContextMenu({
        isOpen: true,
        position: data,
        // The caller already knows whether the click landed on a selection.
        ...menuStateFor(editorRef.current),
        hasSelection: data.hasSelection,
      });
    },
    [editorRef, imageContextMenu]
  );

  const handleImageWrapApply = useCallback(
    (_target: ImageLayoutTarget) => {
      // Legacy dispatched `setImageWrapType` at the image's document position, carrying
      // the inline glyph's EMU offset so a promoted float landed where it used to sit.
      // The engine has no image command surface (`getSelectedImage` is a stub returning
      // null), so there is nothing to dispatch to. The menu still opens and closes; the
      // wrap swatches simply do not apply, which is what the capability reports.
      if (imageContextMenu.imagePos === null) return;
    },
    [imageContextMenu.imagePos]
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
      cursorInToc: false,
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
    if (contextMenu.cursorInToc) {
      items.push({
        action: 'updateTableOfContents',
        label: t('contextMenu.updateTableOfContents'),
        dividerAfter: true,
      });
    }
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
  }, [
    contextMenu.hasSelection,
    contextMenu.cursorInTable,
    contextMenu.cursorInToc,
    contextMenu.tableContext,
    i18n,
    t,
  ]);

  const handleContextMenuAction = useCallback(
    async (action: TextContextAction) => {
      const editor = editorRef.current;
      if (!editor) return;

      // Focus the input host so `execCommand` targets the right element.
      focusActiveEditor();

      // Selection-addressed edits go through the contract: the engine answers where the
      // selection is, and the edit names that range as its target. Where a command is not
      // wired the engine refuses, so the menu entry does nothing rather than doing
      // something unintended.
      const selection = () => editor.query({ type: 'selection' });

      switch (action) {
        case 'cut':
          document.execCommand('cut');
          break;
        case 'copy':
          document.execCommand('copy');
          break;
        case 'paste':
        case 'pasteAsPlainText': {
          // `document.execCommand('paste')` is blocked in modern browsers, so the text
          // comes from the Clipboard API and is applied as an edit at the selection.
          // Both entries paste plain text: the engine has no HTML paste path, and
          // pretending the rich entry preserved formatting would be the lie.
          try {
            const text = await navigator.clipboard.readText();
            const range = selection();
            if (text && range) editor.exec({ type: 'replaceText', target: range, text });
          } catch {
            // Clipboard access denied.
          }
          break;
        }
        case 'delete': {
          const range = selection();
          if (range && range.from !== range.to) editor.exec({ type: 'deleteText', target: range });
          break;
        }
        case 'selectAll':
          // Legacy built a selection over the whole document. `setSelection` takes a
          // range, and there is no "everything" address on the contract yet, so this is
          // left to the browser's own Cmd+A rather than given a guessed range.
          break;
        case 'updateTableOfContents':
          if (!onUpdateTableOfContents?.(null)) editor.exec({ type: 'refreshToc' });
          break;
        case 'addRowAbove':
          editor.exec({ type: 'insertRow', where: 'above' });
          break;
        case 'addRowBelow':
          editor.exec({ type: 'insertRow', where: 'below' });
          break;
        case 'deleteRow':
          editor.exec({ type: 'deleteRow' });
          break;
        case 'addColumnLeft':
          editor.exec({ type: 'insertColumn', where: 'left' });
          break;
        case 'addColumnRight':
          editor.exec({ type: 'insertColumn', where: 'right' });
          break;
        case 'deleteColumn':
          editor.exec({ type: 'deleteColumn' });
          break;
        case 'mergeCells':
          editor.exec({ type: 'mergeCells' });
          break;
        case 'splitCell':
          openSplitCellDialog();
          break;
        case 'selectTable':
          // No "select this table" command on the contract; the table entries that DO
          // exist are wired above.
          break;
        case 'deleteTable':
          editor.exec({ type: 'deleteTable' });
          break;
        case 'addComment': {
          const range = selection();
          if (!range || range.from === range.to) break;
          // Legacy marked the range with a pending comment mark before handing off. The
          // engine has no comment vocabulary (see the `getComments` stub), so this
          // reports the range and its Y position and leaves marking to the capability
          // when it lands. The Y comes from the caret rect the engine already derives,
          // where legacy measured painted spans itself.
          const caret = editor.getCaretRect();
          onAddComment({
            from: Number(range.from),
            to: Number(range.to),
            yPos: caret ? caret.y : null,
          });
          break;
        }
      }
      // TextContextMenu calls onClose after onAction, so no need to close here.
    },
    [editorRef, focusActiveEditor, openSplitCellDialog, onUpdateTableOfContents, onAddComment]
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
