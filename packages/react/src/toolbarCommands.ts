// Toolbar can-before-exec wiring — re-exported from the engine.
//
// The logic is shared by both adapters (see engine-editor/src/toolbar-commands.ts);
// this shim keeps the React package's public API stable.

export {
  runSave,
  runToolbarCommand,
  toolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
  type ToolbarCommandId,
  type ToolbarCommandState,
} from '@docx-editor.dev/engine-editor';
