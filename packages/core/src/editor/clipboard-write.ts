// Writing text to the system clipboard, for the `copy` and `cut` commands.
//
// This is the one effect `execEditorCommand` performs outside the surface, and it is
// isolated here rather than inlined so that the switch stays a list of surface calls and
// this file carries the reasoning about why the effect is safe to fire and forget.
//
// WRITE, NOT READ. Clipboard write is gated on a user gesture but never prompts, so the
// engine can own it. Clipboard READ prompts in Chrome and is refused outright by Firefox
// and Safari, which is why `paste` takes its text as an argument instead — see the command
// docs in `contracts/editor.ts`.

/**
 * Put `text` on the system clipboard, if this environment has one.
 *
 * Returns nothing and never throws. The promise is deliberately not surfaced: by the time
 * it settles, `cut` has already deleted the selection, and failing the command on a late
 * clipboard rejection would report a document edit as not having happened when it did.
 *
 * A missing `navigator.clipboard` — an insecure origin, a non-browser host running the
 * engine headless — is a no-op rather than an error, for the same reason: the caller asked
 * the document a question, and the document answered.
 */
export function writeClipboardText(text: string): void {
  if (text === '') return;
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) return;
  try {
    // `void` the promise explicitly: a rejected clipboard write must not surface as an
    // unhandled rejection in the host's console for something the user cannot act on.
    void clipboard.writeText(text).catch(() => {});
  } catch {
    // Some environments throw synchronously rather than rejecting. Same answer.
  }
}
