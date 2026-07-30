// Legacy chrome descriptor contract (interactive-paginated-editing M6V.1).
//
// M6V.1 is a visual-parity gate with two rules that are easy to break silently:
// every legacy control must remain PRESENT, and only undo/redo/bold/italic/save may
// be actionable. A dropped control understates the parity gap; an extra enabled one
// claims a capability the engine does not have. Both adapters render from this
// descriptor, so asserting it here covers React and Vue at once.
//
// The slot-id vocabulary (`${groupId}.${controlId}`) is public API forever; the
// pinned lists below are the breaking-change tripwire.

import { describe, expect, test } from 'bun:test';
import {
  CHROME_GROUPS,
  CHROME_MENUS,
  CHROME_UNAVAILABLE_KEY,
  chromeControlCount,
  chromeSlotId,
  type ChromeSlotId,
} from '../chrome-controls.ts';
import { commandForSlot } from '../toolbar-commands.ts';

/** The ten legacy toolbar groups, from Toolbar.tsx at ref 9bb06c38, plus file/save. */
const EXPECTED_GROUPS = [
  'history',
  'zoom',
  'styles',
  'font',
  'text',
  'script',
  'alignment',
  'list',
  'image',
  'table',
  'review',
  'file',
];

/** THE public slot taxonomy. A change here is a breaking API change — rename knowingly. */
const EXPECTED_SLOTS: readonly ChromeSlotId[] = [
  'history.undo',
  'history.redo',
  'zoom.level',
  'styles.style',
  'font.family',
  'font.size',
  'font.color',
  'text.bold',
  'text.italic',
  'text.underline',
  'text.strike',
  'text.highlight',
  'text.link',
  'text.clear',
  'script.super',
  'script.sub',
  'alignment.left',
  'alignment.center',
  'alignment.right',
  'alignment.justify',
  'alignment.lineSpacing',
  'list.bullet',
  'list.numbered',
  'list.outdent',
  'list.indent',
  'image.insert',
  'image.properties',
  'table.insert',
  'review.comments',
  'review.editingMode',
  'file.save',
];

const allSlots = (): ChromeSlotId[] =>
  CHROME_GROUPS.flatMap((g) => g.controls.map((c) => chromeSlotId(g, c)));

describe('legacy chrome descriptor', () => {
  test('carries every legacy toolbar group, in legacy order', () => {
    expect(CHROME_GROUPS.map((g) => g.id)).toEqual(EXPECTED_GROUPS);
  });

  test('the slot taxonomy is exactly the pinned public vocabulary, in order', () => {
    expect(allSlots()).toEqual([...EXPECTED_SLOTS]);
  });

  test('only undo, redo, bold, italic may be commands, and only save may save', () => {
    const commandSlots = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'command').map((c) => chromeSlotId(g, c))
    );
    // Exactly the four M6V.1 permits — no more, and none missing.
    expect([...commandSlots].sort()).toEqual([
      'history.redo',
      'history.undo',
      'text.bold',
      'text.italic',
    ]);
    // Every actionable chrome control resolves to a real engine command.
    for (const slot of commandSlots) expect(commandForSlot(slot)).not.toBeNull();

    const saves = CHROME_GROUPS.flatMap((g) => g.controls.filter((c) => c.state.kind === 'save'));
    expect(saves).toHaveLength(1);
  });

  test('underline is present but NOT actionable in the chrome', () => {
    // Underline stays visible and inert in the M6V.1 chrome. The COMMAND exists
    // (`commandForSlot('text.underline')` is wired), but enabling the chrome control is a
    // deliberate product decision the descriptor has not taken.
    const underline = CHROME_GROUPS.flatMap((g) => g.controls).find((c) => c.id === 'underline');
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

  test('slot ids are unique, so a testid cannot collide', () => {
    // Control ids alone are NOT globally unique (`image.insert` / `table.insert`);
    // uniqueness — and every consumer key — lives at the slot level.
    const slots = allSlots();
    expect(new Set(slots).size).toBe(slots.length);
  });

  test('control ids are unique within their group', () => {
    for (const group of CHROME_GROUPS) {
      const ids = group.controls.map((c) => c.id);
      expect(new Set(ids).size, `group ${group.id}`).toBe(ids.length);
    }
  });

  test('ids are short lowercaseCamel and never repeat their group name', () => {
    for (const group of CHROME_GROUPS) {
      expect(group.id).toMatch(/^[a-z][a-zA-Z]*$/);
      for (const c of group.controls) {
        expect(c.id, `${group.id}.${c.id}`).toMatch(/^[a-z][a-zA-Z]*$/);
        expect(
          c.id.toLowerCase().includes(group.id.toLowerCase()),
          `${group.id}.${c.id} repeats its group name`
        ).toBe(false);
      }
    }
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
