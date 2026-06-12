/**
 * Menu-bar action dispatcher — translates `MenuBar` action strings into
 * the right side-effect (toggle a dialog, fire a command, re-emit to
 * host). Also owns the two tiny helpers used alongside it: the simple
 * command dispatcher (used by `dirLTR`/`dirRTL`/`insertTOC`) and the
 * inline table-insert handler the toolbar's table picker emits.
 *
 * The composable is intentionally thin — it takes the dialog `Ref`s
 * and feature-action handlers as inputs and stitches them together so
 * the parent SFC keeps a one-line `@action="handleMenuAction"`
 * binding instead of carrying a 50-line switch in script-setup.
 */

import type { Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { openReportIssue } from '@eigenpal/docx-editor-core/utils/reportIssue';

export interface UseMenuActionsOptions {
  editorView: Ref<EditorView | null>;
  getCommands: () => Record<string, (...args: any[]) => any>;
  docxInputRef: Ref<HTMLInputElement | null>;
  imageInputRef: Ref<HTMLInputElement | null>;
  showPageSetup: Ref<boolean>;
  showWatermark: Ref<boolean>;
  showHyperlink: Ref<boolean>;
  showInsertSymbol: Ref<boolean>;
  showKeyboardShortcuts: Ref<boolean>;
  handleClearFormatting: () => void;
  handleInsertPageBreak: () => void;
  handleToggleOutline: () => void;
  handleToggleSidebar: () => void;
  downloadCurrentDocument: () => Promise<void>;
  emit: (event: string, ...args: unknown[]) => void;
}

export function useMenuActions(opts: UseMenuActionsOptions) {
  function execSimpleCommand(name: string) {
    const view = opts.editorView.value;
    if (!view) return;
    const cmdFactory = opts.getCommands()[name];
    if (!cmdFactory) return;
    const command = cmdFactory();
    command(view.state, (tr: any) => view.dispatch(tr), view);
    view.focus();
  }

  function handleMenuTableInsert(rows: number, cols: number) {
    const view = opts.editorView.value;
    if (!view) return;
    const insertCmd = opts.getCommands()['insertTable'];
    if (!insertCmd) return;
    insertCmd(rows, cols)(view.state, (tr: any) => view.dispatch(tr), view);
    view.focus();
  }

  function handleMenuAction(action: string) {
    switch (action) {
      case 'open':
        opts.docxInputRef.value?.click();
        opts.emit('menu-action', 'open');
        break;
      case 'save':
        opts.emit('menu-action', 'save');
        void opts.downloadCurrentDocument();
        break;
      case 'pageSetup':
        opts.showPageSetup.value = true;
        break;
      case 'watermark':
        opts.showWatermark.value = true;
        break;
      case 'clearFormatting':
        opts.handleClearFormatting();
        break;
      case 'insertImage':
        // Mirror React: open the OS file picker and insert directly (the
        // shared `insertImageFromFile` flow), no intermediate dialog.
        opts.imageInputRef.value?.click();
        break;
      case 'insertLink':
        opts.showHyperlink.value = true;
        break;
      case 'insertSymbol':
        opts.showInsertSymbol.value = true;
        break;
      case 'insertPageBreak':
        opts.handleInsertPageBreak();
        break;
      case 'insertTOC':
        execSimpleCommand('generateTOC');
        break;
      case 'outline':
        opts.handleToggleOutline();
        break;
      case 'sidebar':
        opts.handleToggleSidebar();
        break;
      case 'shortcuts':
        opts.showKeyboardShortcuts.value = true;
        break;
      case 'reportIssue':
        openReportIssue();
        break;
      case 'dirLTR':
        execSimpleCommand('setLtr');
        break;
      case 'dirRTL':
        execSimpleCommand('setRtl');
        break;
    }
  }

  return {
    handleMenuAction,
    handleMenuTableInsert,
    execSimpleCommand,
  };
}
