// The last copy or cut the editor wrote, for a menu Paste that the browser will not let read.
//
// A Paste row in a menu must read the clipboard with the async Clipboard API. Browsers can
// refuse that read: one asks for a permission the user can deny, and another allows the read
// only for some gestures. The keyboard paste never needs the read, because the browser gives
// its `paste` event the clipboard. Without this record, a menu Paste can fail in a window
// where the keyboard shortcuts work, also for a selected shape, line or text box.
//
// The editor knows what it last put on the clipboard. When the read is refused, the menu Paste
// uses that copy, but only while it is still the clipboard content:
//
// - The window kept focus since the copy. Another application can copy only while it has
//   focus, so a `blur` of the window, a hidden page or `pagehide` forgets the copy.
// - No other `copy` or `cut` event ran in the window's document since the copy. A copy from a
//   host text field forgets it. The editor's own copy event forgets the old copy first (a
//   capture listener) and then records the new one.
//
// When either condition fails, the read refusal stands and the menu shows it.
//
// The record follows only the clipboard writes the editor can see. The editor's own writes
// (`clipboard-write.ts`) record what landed, and a refused write forgets. Other changes while
// the window keeps focus go undetected: a host script that writes `navigator.clipboard`
// directly, a clipboard synced from another device, or a tool that clears the clipboard. Host
// chrome that writes the clipboard uses `writeTextToClipboard` instead.
//
// One record per window: the clipboard focus rule is per window, and a pop-out editor window
// has its own. The listeners live as long as the window, so they are not surface listeners
// (`surface-host-listeners.ts`), which follow one mounted surface between windows.

import { hostWindowOf } from './host-realm.ts';

/** One remembered copy: the flavours the editor wrote. */
export interface EditorClipboardCopy {
  readonly text: string;
  readonly html: string | null;
}

interface WindowCopyRecord {
  copy: EditorClipboardCopy | null;
}

const records = new WeakMap<Window, WindowCopyRecord>();

/** The record of `view`, with its forget listeners bound on first use. */
function recordOf(view: Window): WindowCopyRecord {
  const existing = records.get(view);
  if (existing) return existing;
  const record: WindowCopyRecord = { copy: null };
  const forget = (): void => {
    record.copy = null;
  };
  const doc = view.document;
  view.addEventListener('blur', forget);
  view.addEventListener('pagehide', forget);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') forget();
  });
  // Capture: these run before the editor's own copy handler, which records the new copy.
  doc.addEventListener('copy', forget, true);
  doc.addEventListener('cut', forget, true);
  records.set(view, record);
  return record;
}

/**
 * Remember the flavours the editor just wrote to the clipboard of `view`.
 *
 * Call it once a write has landed: from the clipboard events, and from `clipboard-write.ts`
 * when its write resolves. A missing window (a headless host) remembers nothing.
 */
export function rememberEditorCopy(view: Window | undefined, copy: EditorClipboardCopy): void {
  if (!view?.document) return;
  if (copy.text === '' && !copy.html) return;
  recordOf(view).copy = { text: copy.text, html: copy.html };
}

/** Forget the editor's last copy in `view`, when the clipboard content is no longer known. */
export function forgetEditorCopy(view: Window | undefined): void {
  const record = view ? records.get(view) : undefined;
  if (record) record.copy = null;
}

/** The editor's last copy in the window of `owner`, while it is still the clipboard content. */
export function rememberedEditorCopy(owner: Node | null): EditorClipboardCopy | null {
  return records.get(hostWindowOf(owner))?.copy ?? null;
}

/**
 * Whether a menu Paste in the window of `owner` can paste the editor's last copy when the
 * browser refuses to read the clipboard.
 *
 * Adapters use it to keep the Paste row enabled after a refused read: the row is dead only
 * when the read is refused AND no current editor copy exists.
 *
 * @param owner - A node in the editor's window, such as the viewport element.
 * @param options - `plainText` asks for a copy with text, for Paste without formatting. A
 * copied shape with no text has none.
 * @returns True while the window holds a current copy from the editor.
 * @public
 */
export function hasEditorClipboardCopy(
  owner: Node | null,
  options?: { readonly plainText?: boolean }
): boolean {
  const copy = rememberedEditorCopy(owner);
  return copy !== null && (!options?.plainText || copy.text !== '');
}

/**
 * Read the clipboard for a menu Paste row, inside the click that asked for it.
 *
 * The read tries both flavours, then plain text. When the browser refuses the read and the
 * editor's last copy or cut is still the clipboard content, the editor's copy is the result.
 * Otherwise the browser's refusal is thrown, for the row to show. The editor cannot see
 * clipboard writes that bypass it while the window keeps focus; see `writeTextToClipboard`.
 *
 * @param owner - A node in the editor's window, such as the viewport element. A pop-out
 * window's clipboard refuses a read through the opener.
 * @param options - `plainText` reads only the plain text flavour, for Paste without formatting.
 * @returns The text, and the HTML flavour when it was read.
 * @throws The browser's error when it refuses the read and no current editor copy exists.
 * @public
 */
export async function readClipboardForPaste(
  owner: Node | null,
  options?: { readonly plainText?: boolean }
): Promise<{ text: string; html: string | null }> {
  const win = hostWindowOf(owner);
  // Read the remembered copy BEFORE the read: a permission prompt can blur the window.
  const remembered = rememberedEditorCopy(owner);
  try {
    if (options?.plainText) return { text: await win.navigator.clipboard.readText(), html: null };
    return await readBothFlavours(win);
  } catch (error) {
    // A copy with no text, such as a shape, has nothing to paste without formatting.
    if (!remembered || (options?.plainText && remembered.text === '')) throw error;
    return options?.plainText ? { text: remembered.text, html: null } : remembered;
  }
}

/**
 * Both clipboard flavours where the async read allows it, plain text where it does not.
 *
 * Some engines strip attributes from async-read HTML, which can drop the embedded
 * fragment. The engine's paste router degrades to the remaining flavours, so the read
 * never has to guess what survived.
 */
async function readBothFlavours(win: Window): Promise<{ text: string; html: string | null }> {
  const clipboard = win.navigator.clipboard;
  const withItem = win as Window & { ClipboardItem?: unknown };
  if (typeof clipboard.read === 'function' && typeof withItem.ClipboardItem !== 'undefined') {
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
