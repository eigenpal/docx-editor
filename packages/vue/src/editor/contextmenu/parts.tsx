import { computed, defineComponent, h, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { tableChromeIconPaths } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';
import { MenuRow, menuRowSlot } from '../menu/parts';
import { useMenuLabel } from '../menu/menu-context';
import { useContextMenuContext } from './contextmenu-context';
import {
  COPY_PATHS,
  CUT_PATHS,
  DELETE_PATHS,
  PASTE_PATHS,
  SELECT_ALL_PATHS,
  REFRESH_TOC_PATHS,
  REFRESH_TOC_PAGE_NUMBERS_PATHS,
} from './contextmenu-icons';
import { chromeIcon } from '../toolbar/ToolbarButton';

/** Props for a packaged context-menu row. @public */
export interface ContextMenuCommandProps {
  icon?: DocxEditorChildren;
  labelKey?: string;
  shortcutKey?: string;
  className?: string;
  hidden?: boolean;
}

function defineCommandRow(
  rowId: string,
  command: EditorCommand,
  defaults: { labelKey: string; shortcutKey: string; paths: readonly string[] }
) {
  const Part = defineComponent({
    name: `ContextMenu_${rowId.replace(/\./g, '_')}`,
    props: {
      icon: { type: null as unknown as PropType<VNode>, default: undefined },
      labelKey: { type: String, default: undefined },
      shortcutKey: { type: String, default: undefined },
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
    },
    setup(props) {
      const editorRef = useDocxEditor();
      const { close } = useContextMenuContext();
      const label = useMenuLabel();
      const cmd = useEditorCommand(command as unknown as EditorCommand);
      return () => {
        if (props.hidden) return null;
        return (
          <MenuRow
            {...menuRowSlot(rowId)}
            icon={props.icon ?? chromeIcon(defaults.paths) ?? undefined}
            shortcut={label(props.shortcutKey ?? defaults.shortcutKey)}
            disabled={!cmd.isEnabled.value}
            {...(cmd.disabledReason.value ? { title: cmd.disabledReason.value } : {})}
            onSelect={() => {
              editorRef.value?.exec(command);
              close(true);
            }}
            {...(props.className ? { className: props.className } : {})}
          >
            {label(props.labelKey ?? defaults.labelKey)}
          </MenuRow>
        );
      };
    },
  });
  return Object.assign(Part, { docxRow: rowId });
}

/** @public */
export const ContextMenuCut = defineCommandRow(
  'edit.cut',
  { type: 'cut' },
  { labelKey: 'contextMenu.cut', shortcutKey: 'contextMenu.cutShortcut', paths: CUT_PATHS }
);

/** @public */
export const ContextMenuCopy = defineCommandRow(
  'edit.copy',
  { type: 'copy' },
  { labelKey: 'contextMenu.copy', shortcutKey: 'contextMenu.copyShortcut', paths: COPY_PATHS }
);

/** @public */
export const ContextMenuDelete = defineCommandRow(
  'edit.delete',
  { type: 'deleteText' },
  { labelKey: 'contextMenu.delete', shortcutKey: 'contextMenu.deleteShortcut', paths: DELETE_PATHS }
);

/** @public */
export const ContextMenuSelectAll = defineCommandRow(
  'edit.selectAll',
  { type: 'selectAll' },
  {
    labelKey: 'contextMenu.selectAll',
    shortcutKey: 'contextMenu.selectAllShortcut',
    paths: SELECT_ALL_PATHS,
  }
);

/** @public */
export const ContextMenuPaste = defineComponent({
  name: 'ContextMenuPaste',
  props: {
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
    labelKey: { type: String, default: undefined },
    shortcutKey: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const { close, clipboardRefusal, reportClipboardRefusal } = useContextMenuContext();
    const label = useMenuLabel();
    const cmd = useEditorCommand({ type: 'paste', text: ' ' });
    return () => {
      if (props.hidden) return null;
      const blocked = clipboardRefusal !== null;
      return (
        <MenuRow
          {...menuRowSlot('edit.paste')}
          icon={props.icon ?? chromeIcon(PASTE_PATHS) ?? undefined}
          shortcut={label(props.shortcutKey ?? 'contextMenu.pasteShortcut')}
          disabled={!cmd.isEnabled.value || blocked}
          {...((clipboardRefusal ?? cmd.disabledReason.value)
            ? { title: clipboardRefusal ?? cmd.disabledReason.value ?? '' }
            : {})}
          onSelect={() => {
            void (async () => {
              try {
                const { text, html } = await readClipboardPayload();
                if (text || html) {
                  editorRef.value?.exec({ type: 'paste', text, ...(html ? { html } : {}) });
                }
              } catch (error) {
                reportClipboardRefusal(
                  error instanceof Error ? error.message : 'the clipboard is not readable'
                );
              } finally {
                close(true);
              }
            })();
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {label(props.labelKey ?? 'contextMenu.paste')}
        </MenuRow>
      );
    };
  },
});

ContextMenuPaste.docxRow = 'edit.paste' as const;

/**
 * Both clipboard flavours where the async read allows it, plain text where it does not.
 * Some engines strip attributes from async-read HTML — the engine's paste router degrades
 * to the surviving flavours, so the read never has to guess what made it through.
 */
async function readClipboardPayload(): Promise<{ text: string; html: string | null }> {
  const clipboard = navigator.clipboard;
  if (typeof clipboard.read === 'function' && typeof ClipboardItem !== 'undefined') {
    try {
      const items = await clipboard.read();
      let text = '';
      let html: string | null = null;
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text();
        }
        if (item.types.includes('text/html')) {
          html = await (await item.getType('text/html')).text();
        }
      }
      if (text || html) return { text, html };
    } catch {
      // Fall through to the plain read; a refusal there is the one reported.
    }
  }
  return { text: await clipboard.readText(), html: null };
}

/**
 * Paste the clipboard's plain text as if typed, whatever richer flavours it holds — the
 * Cmd+Shift+V twin as a menu row.
 *
 * @public
 */
export const ContextMenuPasteWithoutFormatting = defineComponent({
  name: 'ContextMenuPasteWithoutFormatting',
  props: {
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
    labelKey: { type: String, default: undefined },
    shortcutKey: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const { close, clipboardRefusal, reportClipboardRefusal } = useContextMenuContext();
    const label = useMenuLabel();
    const cmd = useEditorCommand({ type: 'pasteWithoutFormatting', text: ' ' });
    return () => {
      if (props.hidden) return null;
      const blocked = clipboardRefusal !== null;
      return (
        <MenuRow
          {...menuRowSlot('edit.pasteWithoutFormatting')}
          icon={props.icon ?? chromeIcon(PASTE_PATHS) ?? undefined}
          shortcut={label(props.shortcutKey ?? 'contextMenu.pasteWithoutFormattingShortcut')}
          disabled={!cmd.isEnabled.value || blocked}
          {...((clipboardRefusal ?? cmd.disabledReason.value)
            ? { title: clipboardRefusal ?? cmd.disabledReason.value ?? '' }
            : {})}
          onSelect={() => {
            void (async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) editorRef.value?.exec({ type: 'pasteWithoutFormatting', text });
              } catch (error) {
                reportClipboardRefusal(
                  error instanceof Error ? error.message : 'the clipboard is not readable'
                );
              } finally {
                close(true);
              }
            })();
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {label(props.labelKey ?? 'contextMenu.pasteWithoutFormatting')}
        </MenuRow>
      );
    };
  },
});

ContextMenuPasteWithoutFormatting.docxRow = 'edit.pasteWithoutFormatting' as const;

/** @public */
export interface ContextMenuTableRowProps extends ContextMenuCommandProps {
  destructive?: boolean;
}

function defineTableCommandRow(
  rowId: string,
  command: EditorCommand,
  defaults: { labelKey: string; paths: readonly string[]; destructive?: boolean }
) {
  const Part = defineComponent({
    name: `ContextMenuTable_${rowId.replace(/\./g, '_')}`,
    props: {
      icon: { type: null as unknown as PropType<VNode>, default: undefined },
      labelKey: { type: String, default: undefined },
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
      destructive: { type: Boolean, default: undefined },
    },
    setup(props) {
      const { close } = useContextMenuContext();
      const label = useMenuLabel();
      const tableVisible = useTableContextMenuVisible();
      const cmd = useEditorCommand(command as unknown as EditorCommand);
      return () => {
        if (props.hidden || !tableVisible.value) return null;
        const destructive = props.destructive ?? defaults.destructive;
        return (
          <MenuRow
            {...menuRowSlot(rowId)}
            icon={props.icon ?? chromeIcon(defaults.paths) ?? undefined}
            disabled={!cmd.isEnabled.value}
            {...(cmd.disabledReason.value ? { title: cmd.disabledReason.value } : {})}
            class={`${destructive ? 'docx-table-chrome__destructive-row' : ''}${props.className ? ` ${props.className}` : ''}`}
            onSelect={() => {
              if (cmd.execute()) close(true);
            }}
          >
            {label(props.labelKey ?? defaults.labelKey)}
          </MenuRow>
        );
      };
    },
  });
  return Object.assign(Part, { docxRow: rowId });
}

/** @public */
export const ContextMenuInsertRowAbove = defineTableCommandRow(
  'table.insertRowAbove',
  { type: 'insertRow', where: 'above' },
  { labelKey: 'table.insertRowAbove', paths: tableChromeIconPaths('table_rows') }
);

/** @public */
export const ContextMenuInsertRowBelow = defineTableCommandRow(
  'table.insertRowBelow',
  { type: 'insertRow', where: 'below' },
  { labelKey: 'table.insertRowBelow', paths: tableChromeIconPaths('table_rows') }
);

/** @public */
export const ContextMenuInsertColumnLeft = defineTableCommandRow(
  'table.insertColumnLeft',
  { type: 'insertColumn', where: 'left' },
  { labelKey: 'table.insertColumnLeft', paths: tableChromeIconPaths('view_column') }
);

/** @public */
export const ContextMenuInsertColumnRight = defineTableCommandRow(
  'table.insertColumnRight',
  { type: 'insertColumn', where: 'right' },
  { labelKey: 'table.insertColumnRight', paths: tableChromeIconPaths('view_column') }
);

/** @public */
export const ContextMenuDeleteTableRow = defineTableCommandRow(
  'table.deleteRow',
  { type: 'deleteRow' },
  {
    labelKey: 'table.deleteRow',
    paths: tableChromeIconPaths('delete_sweep'),
    destructive: true,
  }
);

/** @public */
export const ContextMenuDeleteTableColumn = defineTableCommandRow(
  'table.deleteColumn',
  { type: 'deleteColumn' },
  {
    labelKey: 'table.deleteColumn',
    paths: tableChromeIconPaths('view_column'),
    destructive: true,
  }
);

/** @public */
export const ContextMenuDeleteTable = defineTableCommandRow(
  'table.deleteTable',
  { type: 'deleteTable' },
  {
    labelKey: 'table.deleteTable',
    paths: tableChromeIconPaths('delete'),
    destructive: true,
  }
);

const CELL_VERTICAL_ALIGNMENT_COMMANDS = [
  { alignment: 'top', labelKey: 'tableAdvanced.top', icon: 'vertical_align_top' },
  { alignment: 'center', labelKey: 'tableAdvanced.middle', icon: 'vertical_align_center' },
  { alignment: 'bottom', labelKey: 'tableAdvanced.bottom', icon: 'vertical_align_bottom' },
] as const;

/** @public */
export const ContextMenuCellVerticalAlignment = defineComponent({
  name: 'ContextMenuCellVerticalAlignment',
  props: {
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const { close } = useContextMenuContext();
    const label = useMenuLabel();
    const tableVisible = useTableContextMenuVisible();
    const top = useEditorCommand({ type: 'setTableCellVerticalAlignment', alignment: 'top' });
    const center = useEditorCommand({
      type: 'setTableCellVerticalAlignment',
      alignment: 'center',
    });
    const bottom = useEditorCommand({
      type: 'setTableCellVerticalAlignment',
      alignment: 'bottom',
    });
    const states = [top, center, bottom] as const;
    return () => {
      if (props.hidden || !tableVisible.value) return null;
      return (
        <div class="docx-contextmenu__table-align">
          <span class="docx-contextmenu__table-align-label">
            {label('tableAdvanced.verticalAlignment')}
          </span>
          <div
            class="docx-contextmenu__table-align-buttons"
            role="group"
            aria-label={label('tableAdvanced.verticalAlignment')}
          >
            {CELL_VERTICAL_ALIGNMENT_COMMANDS.map((item, index) => {
              const state = states[index]!;
              return (
                <button
                  key={item.alignment}
                  type="button"
                  role="menuitemradio"
                  aria-checked={false}
                  aria-label={label(item.labelKey)}
                  title={state.disabledReason.value ?? label(item.labelKey)}
                  aria-disabled={!state.isEnabled.value}
                  class="docx-contextmenu__table-align-button"
                  onMousedown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    if (state.execute()) close(true);
                  }}
                >
                  {chromeIcon(tableChromeIconPaths(item.icon))}
                </button>
              );
            })}
          </div>
        </div>
      );
    };
  },
});

ContextMenuCellVerticalAlignment.docxRow = 'table.cellVerticalAlignment' as const;

function defineTocCommandRow(
  rowId: string,
  mode: 'entire' | 'pageNumbers',
  defaults: { labelKey: string; paths: readonly string[] }
) {
  const Part = defineComponent({
    name: `ContextMenuToc_${rowId.replace(/\./g, '_')}`,
    props: {
      icon: { type: null as unknown as PropType<VNode>, default: undefined },
      labelKey: { type: String, default: undefined },
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
    },
    setup(props) {
      const editorRef = useDocxEditor();
      const { close, tocId } = useContextMenuContext();
      const label = useMenuLabel();
      const command = computed(
        (): EditorCommand => ({ type: 'refreshToc', mode, ...(tocId ? { tocId } : {}) })
      );
      const cmd = useEditorCommand(command as unknown as EditorCommand);
      return () => {
        if (props.hidden || tocId === null) return null;
        return (
          <MenuRow
            {...menuRowSlot(rowId)}
            icon={props.icon ?? chromeIcon(defaults.paths) ?? undefined}
            disabled={!cmd.isEnabled.value}
            {...(cmd.disabledReason.value ? { title: cmd.disabledReason.value } : {})}
            onSelect={() => {
              editorRef.value?.exec(command.value);
              close(true);
            }}
            {...(props.className ? { className: props.className } : {})}
          >
            {label(props.labelKey ?? defaults.labelKey)}
          </MenuRow>
        );
      };
    },
  });
  return Object.assign(Part, { docxRow: rowId });
}

/** @public */
export const ContextMenuRefreshToc = defineTocCommandRow('toc.refresh', 'entire', {
  labelKey: 'toc.refresh',
  paths: REFRESH_TOC_PATHS,
});

/** @public */
export const ContextMenuRefreshTocPageNumbers = defineTocCommandRow(
  'toc.refreshPageNumbers',
  'pageNumbers',
  { labelKey: 'toc.refreshPageNumbers', paths: REFRESH_TOC_PAGE_NUMBERS_PATHS }
);

/** @internal */
export const TOC_CONTEXT_ROWS = [ContextMenuRefreshToc, ContextMenuRefreshTocPageNumbers] as const;

/** @internal */
export function useTableContextMenuVisible() {
  return useEditorState(
    (snapshot) => snapshot.table != null,
    (a, b) => a === b
  );
}

/** @internal */
export const TABLE_CONTEXT_ROWS = [
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuDeleteTableRow,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTable,
  ContextMenuCellVerticalAlignment,
] as const;

/** @public */
export interface ContextMenuItemProps {
  label: string;
  icon?: DocxEditorChildren;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  active?: boolean;
  onSelect?: () => void;
  className?: string;
}

/** @public */
export const ContextMenuItem = defineComponent({
  name: 'ContextMenuItem',
  props: {
    label: { type: String, required: true },
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
    shortcut: { type: String, default: undefined },
    disabled: { type: Boolean, default: undefined },
    disabledReason: { type: String, default: undefined },
    active: { type: Boolean, default: undefined },
    onSelect: { type: Function as PropType<() => void>, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { close } = useContextMenuContext();
    return () =>
      h(
        MenuRow,
        {
          ...(props.icon ? { icon: props.icon } : {}),
          ...(props.shortcut ? { shortcut: props.shortcut } : {}),
          ...(props.disabled ? { disabled: props.disabled } : {}),
          ...(props.disabled && props.disabledReason ? { title: props.disabledReason } : {}),
          ...(props.active !== undefined ? { active: props.active } : {}),
          onSelect: () => {
            props.onSelect?.();
            close(true);
          },
          ...(props.className ? { className: props.className } : {}),
        },
        { default: () => props.label }
      );
  },
});
