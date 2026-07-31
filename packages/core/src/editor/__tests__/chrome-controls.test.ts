// Legacy chrome descriptor contract (interactive-paginated-editing M6V.1).
//
// M6V.1 is a visual-parity gate with two rules that are easy to break silently:
// every legacy control must remain PRESENT, and only undo/redo/bold/italic/save may
// be actionable. A dropped control understates the parity gap; an extra enabled one
// claims a capability the engine does not have. Both adapters render from this
// descriptor, so asserting it here covers React and Vue at once.

import { describe, expect, test } from 'bun:test';
import {
  CHROME_GROUPS,
  CHROME_MENUS,
  CHROME_UNAVAILABLE_KEY,
  chromeControlCount,
} from '../chrome-controls.ts';

/** The ten legacy toolbar groups, from Toolbar.tsx at ref 9bb06c38, plus file/save. */
const EXPECTED_GROUPS = [
  'history',
  'zoom',
  'styles',
  'font',
  'textFormatting',
  'script',
  'alignment',
  'listFormatting',
  'image',
  'table',
  'review',
  'file',
];

describe('legacy chrome descriptor', () => {
  test('carries every legacy toolbar group, in legacy order', () => {
    expect(CHROME_GROUPS.map((g) => g.id)).toEqual(EXPECTED_GROUPS);
  });

  test('only undo, redo, bold, italic may be commands, and only save may save', () => {
    const commands = CHROME_GROUPS.flatMap((g) =>
      g.controls
        .filter((c) => c.state.kind === 'command')
        .map((c) => (c.state as { command: string }).command)
    );
    // Exactly the four M6V.1 permits — no more, and none missing.
    expect([...commands].sort()).toEqual(['bold', 'italic', 'redo', 'undo']);

    const saves = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'save')
    );
    expect(saves).toHaveLength(1);
  });

  test('underline is present but NOT actionable', () => {
    // Underline is the trap: it looks like bold and italic, but `RunProps.underline`
    // is a boolean while `w:u` carries a style, so enabling it would either throw on
    // save or silently downgrade a double underline. It must be visible and inert.
    const underline = CHROME_GROUPS.flatMap((g) => g.controls).find(
      (c) => c.id === 'underline'
    );
    expect(underline).toBeDefined();
    expect(underline!.state.kind).toBe('parityOnly');
  });

  test('every control has a label key and no control hardcodes English', () => {
    for (const group of CHROME_GROUPS) {
      expect(group.labelKey).toMatch(/^[a-z][a-zA-Z]*\./);
      for (const c of group.controls) {
        expect(c.labelKey, `${c.id} labelKey`).toMatch(/^[a-z][a-zA-Z]*\./);
        // A key, never a display string: keys have no spaces.
        expect(c.labelKey).not.toContain(' ');
        if (c.valueKey) expect(c.valueKey).not.toContain(' ');
      }
    }
    expect(CHROME_UNAVAILABLE_KEY).toBe('formattingBar.unavailableInPreview');
  });

  test('control ids are unique, so a testid cannot collide', () => {
    const ids = CHROME_GROUPS.flatMap((g) => g.controls.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('icon controls carry at least one path, pickers carry none', () => {
    for (const c of CHROME_GROUPS.flatMap((g) => g.controls)) {
      if (c.paths === null) {
        // A picker must say what value it displays, or it renders as an empty box.
        expect(c.valueKey, `${c.id} needs a valueKey`).toBeDefined();
        continue;
      }
      expect(c.paths.length, `${c.id} paths`).toBeGreaterThan(0);
      for (const d of c.paths) {
        // Material Symbols path data, lifted verbatim from the reference commit.
        // A truncated or retyped path is a silent visual regression.
        expect(d.length, `${c.id} path length`).toBeGreaterThan(20);
        expect(d).toMatch(/^[Mm]/);
      }
    }
  });

  test('the count is stable, so a dropped control fails rather than passing quietly', () => {
    expect(chromeControlCount()).toBe(31);
  });

  test('the menu region carries the legacy menus', () => {
    expect(CHROME_MENUS.map((m) => m.id)).toEqual(['file', 'format', 'insert', 'help']);
  });
});
