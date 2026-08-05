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
 * Just the labels the Igloo theme renames — ROWS and CONTROLS, never the menu bar itself.
 * Everything else falls through to English.
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

  // The review rail. It takes a `t` like every other compound, so the decisions get the
  // theme's words while the buttons keep the library's accessible names.
  'review.accept': 'Let it melt',
  'review.reject': 'Refreeze it',
  'review.empty': 'Nothing in the core yet.',
  'review.reply': 'Log it',
  'comments.replyPlaceholder': 'Add to the record…',

  // The demo's own keys, resolved the same way the packaged ones are.
  'igloo.carve': 'Carve…',
  'igloo.specimens': 'Custom elements…',

  // NOT RENAMED, on purpose: `toolbar.file`, `toolbar.format`, `toolbar.insert` and
  // `toolbar.help`.
  //
  // An earlier pass called them Expedition, Sculpt, Deposit and Survival guide, and it was a
  // mistake. A menu BAR is navigation, and the names on it are the one part of an editor a
  // user arrives already knowing — renaming File to Expedition costs a person the map and
  // buys the product nothing. Rows inside a menu are fair game (this file renames plenty),
  // because by then the user has already found the menu they wanted.
  //
  // It also destroyed the signal this demo exists to show. With every trigger renamed, the
  // product's OWN menu was just a fifth invented word in a row of invented words; with the
  // four standing as File / Format / Insert / Help, `Custom Actions` is visibly the odd one
  // out, which is exactly what it is.
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
