// The demo's own label catalogue.
//
// Every packaged part takes a `t`, and this is what a host passes it. The mechanism is
// exactly the one a real product uses for a real locale — resolve a key to a string — so
// exercising it with ice vocabulary proves the same path a French catalogue would take.
//
// It DELEGATES rather than replaces: overrides come first, then the bundled English
// catalogue, then the key itself. A host that renamed six things should not have to restate
// the other four hundred, and a key that falls through to its own name is a visible bug
// rather than a blank control.

import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';

const english = createT(en);

/**
 * Just the labels the Igloo theme renames. Everything else falls through to English.
 *
 * A `Map`, not an object literal, because the key is CALLER input: an object answers
 * `constructor` and `toString` off the prototype chain, so `iglooT('constructor')` would
 * return a function rather than a string. Core spells `MARKS` and `HIGHLIGHT_NAMES` this way
 * for exactly that reason; an example that teaches the API should teach that too.
 */
const ICE_LABELS = new Map<string, string>(Object.entries({
  // The clipboard rows, in the theme's own vocabulary.
  'contextMenu.cut': 'Carve out',
  'contextMenu.copy': 'Cast a replica',
  'contextMenu.paste': 'Graft on',
  'contextMenu.delete': 'Melt away',
  'contextMenu.selectAll': 'Take the whole floe',

  // Toolbar controls.
  'toolbar.bold': 'Pack ice',
  'toolbar.italic': 'Drift',
  'toolbar.underline': 'Waterline',
  'toolbar.strikethrough': 'Crevasse',
  'toolbar.undo': 'Refreeze',
  'toolbar.redo': 'Thaw forward',
  'toolbar.clearFormatting': 'Smooth over',
  'toolbar.insertLink': 'Tether',
  'toolbar.bulletList': 'Floes',
  'toolbar.numberedList': 'Strata',
  'formattingBar.insertLink': 'Tether',
  'formattingBar.clearFormatting': 'Smooth over',
  'comments.addComment': 'Log an observation…',

  // The demo's own keys, resolved the same way the packaged ones are.
  'igloo.carve': 'Carve…',

  // Menus. The registry's own keys — `toolbar.*`, shared with the toolbar controls for the
  // same capabilities, which is exactly why renaming one renames both.
  'toolbar.file': 'Expedition',
  'toolbar.format': 'Sculpt',
  'toolbar.insert': 'Deposit',
  'toolbar.help': 'Survival guide',
}));

/**
 * The resolver handed to every packaged part.
 *
 * Typed as `(key: string) => string` because that is what the parts take — a host's
 * catalogue is its own, and the library does not require it to be keyed by our union.
 */
export function iglooT(key: string): string {
  return ICE_LABELS.get(key) ?? english(key as TranslationKey);
}
