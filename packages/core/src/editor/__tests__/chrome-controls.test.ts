// Legacy chrome descriptor contract (interactive-paginated-editing M6V.1).
//
// M6V.1 is a visual-parity gate whose first rule is easy to break silently: every
// legacy control must remain PRESENT, because a dropped control understates the parity
// gap. Its second rule — which controls may ACT — is no longer the descriptor's to
// state: enabled state is `Editor.can`'s answer, so the descriptor only says HOW a
// control reaches the engine, and the assertions below hold it to the command table
// rather than to a pinned list of "permitted" controls. Both adapters render from this
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
import { commandForSlot, commandForSlotValue } from '../toolbar-commands.ts';

/**
 * The toolbar groups in the chrome spec's bar order: history, zoom, styles, font,
 * then the text group carrying colour and highlight (B I U S · A · pen · link),
 * script, the merged-rendering alignment group, the list group carrying line
 * spacing, standalone clear, and the trailing review controls — with the
 * contextual image/table/file groups (not in the default bar) closing the
 * registry.
 */
const EXPECTED_GROUPS = [
  'history',
  'zoom',
  'styles',
  'font',
  'text',
  'script',
  'alignment',
  'list',
  'format',
  'review',
  'image',
  'table',
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
  'text.bold',
  'text.italic',
  'text.underline',
  'text.strike',
  'text.color',
  'text.highlight',
  'text.link',
  'script.super',
  'script.sub',
  'alignment.left',
  'alignment.center',
  'alignment.right',
  'alignment.justify',
  'list.bullet',
  'list.numbered',
  'list.outdent',
  'list.indent',
  'list.lineSpacing',
  'format.clear',
  'review.comments',
  'review.editingMode',
  'image.insert',
  'image.properties',
  'table.insert',
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

  test('every slot the engine wires is declared as a command, and only save may save', () => {
    const commandSlots = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'command').map((c) => chromeSlotId(g, c))
    );
    // The descriptor may not UNDER-claim: a slot the command table wires must be
    // declared 'command', or an adapter that trusts the descriptor renders a working
    // command permanently disabled — which is exactly what Vue did for twelve slots
    // while React ran them.
    for (const slot of allSlots()) {
      if (commandForSlot(slot) === null) continue;
      expect(commandSlots, `${slot} is wired but not declared a command`).toContain(slot);
    }

    const saves = CHROME_GROUPS.flatMap((g) => g.controls.filter((c) => c.state.kind === 'save'));
    expect(saves).toHaveLength(1);
  });

  test('the value-typed slots are declared as values, not commands', () => {
    // These four take a PICKED value through `commandForSlotValue`; there is no fixed
    // command to hand `Editor.can`, so a bare click has nothing to send and chrome must
    // produce a value first.
    const valueSlots = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'value').map((c) => chromeSlotId(g, c))
    );
    expect([...valueSlots].sort()).toEqual([
      'font.family',
      'font.size',
      'text.color',
      'text.highlight',
    ]);
    for (const slot of valueSlots) {
      // No fixed command, but a well-formed value resolves to one.
      expect(commandForSlot(slot)).toBeNull();
      expect(commandForSlotValue(slot, 'Arial')).not.toBeNull();
    }
  });

  test('underline is wired, and the descriptor says so', () => {
    // The regression this pins: underline carried a "permanently disabled" descriptor
    // long after `commandForSlot('text.underline')` started answering. A registry
    // constant cannot be a second, staler answer to what `Editor.can` decides.
    const underline = CHROME_GROUPS.flatMap((g) => g.controls).find((c) => c.id === 'underline');
    expect(underline).toBeDefined();
    expect(underline!.state.kind).toBe('command');
    expect(commandForSlot('text.underline')).not.toBeNull();
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
