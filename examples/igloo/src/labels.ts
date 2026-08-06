// The demo's own label overrides.
//
// Every packaged part takes a `t`, and `useChromeTranslate(ICE_LABELS)` builds the one a
// host passes: overrides first, then the active locale catalogue (bundled English by
// default). A host that renamed six things should not have to restate the other four
// hundred, and a key that falls through to its own name is a visible bug rather than a
// blank control — both of which the hook already guarantees, so this file is left holding
// only the theme's actual vocabulary.

/**
 * Just the labels the Igloo theme renames — ROWS and CONTROLS, never the menu bar itself.
 * Everything else falls through to the catalogue.
 *
 * A `Map`, not an object literal, because the key is CALLER input: an object answers
 * `constructor` and `toString` off the prototype chain, so `t('constructor')` would
 * return a function rather than a string. `useChromeTranslate` takes a `ReadonlyMap` for
 * exactly that reason; an example that teaches the API should teach that too.
 */
export const ICE_LABELS = new Map<string, string>(Object.entries({
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

