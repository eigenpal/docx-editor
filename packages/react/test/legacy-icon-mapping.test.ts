// M6V.4 — the toolbar's icon names must all exist in the real registry.
//
// The chrome shipped with hand-authored `d` strings: approximations of Material Symbols
// that render as plausible-but-wrong glyphs, which no screenshot review reliably catches.
// The fix is to name icons and resolve them through the registry ported verbatim from the
// legacy adapter. This test pins the id → name mapping against the registry's actual
// exports, so the swap in `legacy-chrome.ts` is mechanical and a typo fails here rather
// than rendering an empty box.

import { describe, expect, test } from 'bun:test';
import * as Icons from '../src/components/ui/Icons';
import { LEGACY_CHROME_GROUPS } from '@docx-editor.dev/engine-editor';

/** control id → registry export name (minus the `Icon` prefix). */
const ICON_FOR_CONTROL: Record<string, string> = {
  undo: 'Undo',
  redo: 'Redo',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  superscript: 'Superscript',
  subscript: 'Subscript',
  fontColor: 'TextColor',
  highlightColor: 'Highlight',
  insertLink: 'Link',
  clearFormatting: 'FormatClear',
  alignLeft: 'AlignLeft',
  alignCenter: 'AlignCenter',
  alignRight: 'AlignRight',
  alignJustify: 'AlignJustify',
  lineSpacing: 'LineSpacing',
  bulletList: 'ListBulleted',
  numberedList: 'ListNumbered',
  decreaseIndent: 'IndentDecrease',
  increaseIndent: 'IndentIncrease',
  insertImage: 'Image',
  imageProperties: 'Tune',
  insertTable: 'Table',
  comments: 'Comment',
  save: 'FileDownload',
};

describe('legacy icon mapping (M6V.4)', () => {
  test('every mapped name is a real export of the ported registry', () => {
    const missing = Object.entries(ICON_FOR_CONTROL)
      .filter(([, name]) => typeof (Icons as Record<string, unknown>)[`Icon${name}`] !== 'function')
      .map(([id, name]) => `${id} → Icon${name}`);
    expect(missing).toEqual([]);
  });

  test('every icon-bearing control has a mapping, so none is left hand-drawn', () => {
    const unmapped = LEGACY_CHROME_GROUPS.flatMap((g) => g.controls)
      .filter((c) => c.paths !== null && !ICON_FOR_CONTROL[c.id])
      .map((c) => c.id);
    expect(unmapped, 'controls still without a registry icon').toEqual([]);
  });

  test('the mapping names no control that does not exist', () => {
    const ids = new Set(LEGACY_CHROME_GROUPS.flatMap((g) => g.controls).map((c) => c.id));
    expect(Object.keys(ICON_FOR_CONTROL).filter((id) => !ids.has(id))).toEqual([]);
  });
});
