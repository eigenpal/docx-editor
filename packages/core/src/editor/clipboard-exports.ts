// The clipboard names the adapters use, re-exported from `index.ts` as one group: event
// forwarding from chrome, the menu Paste read, and the refusal reasons they show. Everything
// else in these modules stays internal.
export { forwardClipboardEvents } from './chrome-clipboard.ts';
export {
  clipboardCommandRefusal,
  watchClipboardRefusals,
  type ClipboardAction,
  type ClipboardRefusal,
} from './clipboard-refusal-display.ts';
export { hasEditorClipboardCopy, readClipboardForPaste } from './clipboard-editor-copy.ts';
export { writeTextToClipboard } from './clipboard-write.ts';
