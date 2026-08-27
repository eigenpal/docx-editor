// Shortcut text, written the way the reader's keyboard is labelled.
//
// The catalogue states one spelling per shortcut, and it has to be the Windows/Linux one:
// a translator writes text, not a platform matrix, and a key that carried both spellings
// would have to be split in every locale. So the platform difference is applied HERE, once,
// at the point the resolved string is rendered — not in the catalogue and not per control.
//
// The modifier NAMES change, never the chord: the engine's keymap treats Ctrl and Cmd as one
// accelerator (`event.metaKey || event.ctrlKey`), so a Mac reader pressing ⌘ and a Windows
// reader pressing Ctrl reach the same command. Only the label was lying.

/** Apple platforms label the accelerator ⌘ and the alternate key Option. */
const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

/**
 * Whether this browser is running on an Apple platform.
 *
 * `userAgentData.platform` first — it is the un-deprecated answer and is not frozen the way
 * `navigator.platform` is. Both are absent under SSR and in a bare test environment, where
 * the answer is `false` and the Windows spelling renders: a shortcut that reads "Ctrl+C" on
 * a Mac is wrong, and one that reads "⌘C" in a server render that then hydrates on Windows
 * is worse, because it is wrong AND it flickers.
 */
function isApplePlatform(): boolean {
  const agent = globalThis.navigator as
    | (Navigator & { readonly userAgentData?: { readonly platform?: string } })
    | undefined;
  if (!agent) return false;
  const declared = agent.userAgentData?.platform;
  if (typeof declared === 'string' && declared.length > 0) return APPLE_PLATFORM.test(declared);
  return APPLE_PLATFORM.test(agent.platform ?? '');
}

/** Word for the web's own Mac spelling: `Ctrl` is ⌘, `Alt` is Option. */
const APPLE_MODIFIERS: readonly (readonly [RegExp, string])[] = [
  [/\bCtrl\b/g, '⌘'],
  [/\bAlt\b/g, 'Option'],
];

/**
 * Rewrite the modifier names in a resolved shortcut string for this platform.
 *
 * A no-op everywhere except Apple platforms, and a no-op there too for a string that names
 * no modifier — so it is safe to run over every label, including the ones that are not
 * shortcuts at all (a control's plain name passes through untouched).
 *
 * @public
 */
export function platformShortcut(text: string): string {
  if (!isApplePlatform()) return text;
  let next = text;
  for (const [pattern, replacement] of APPLE_MODIFIERS) next = next.replace(pattern, replacement);
  return next;
}
