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
  chromeMenuSlots,
  chromeSlotId,
  type ChromeMenuEntry,
  type ChromeSlotId,
} from '../chrome-controls.ts';
import {
  chromeProbeForSlot,
  commandForSlot,
  commandForSlotValue,
  toolbarCommandState,
} from '../toolbar-commands.ts';

/**
 * The toolbar groups in the chrome spec's bar order: history, zoom, styles, font,
 * then the text group carrying colour and highlight (B I U S · A · pen · link),
 * script, the merged-rendering alignment group, the list group carrying line
 * spacing, standalone clear, and the trailing review controls — with the
 * contextual image/table/file/insert groups (not in the default bar) closing the
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
  'insert',
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
  'file.open',
  'file.save',
  'file.pageSetup',
  'insert.footnote',
  'insert.endnote',
  'insert.pageNumber',
  'insert.totalPages',
  'insert.sectionPages',
  'insert.pageXofY',
  'insert.pageBreak',
  'insert.sectionBreakNextPage',
  'insert.sectionBreakContinuous',
  'insert.toc',
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
    // These take a PICKED value through `commandForSlotValue`; there is no fixed
    // command to hand `Editor.can`, so a bare click has nothing to send and chrome must
    // produce a value first.
    const valueSlots = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'value').map((c) => chromeSlotId(g, c))
    );
    expect([...valueSlots].sort()).toEqual([
      'font.family',
      'font.size',
      'styles.style',
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
    expect(chromeControlCount()).toBe(43);
  });

  test('the menu region carries the chrome menus, in bar order', () => {
    expect(CHROME_MENUS.map((m) => m.id)).toEqual(['file', 'format', 'insert', 'help']);
  });

  test('every menu row names a real slot, so a menu cannot describe a control twice', () => {
    // The whole point of arrangement-over-slots: a row's label, icon, command and enabled
    // state come from the registry entry it names. A slot that does not exist would leave
    // the row unlabelled and its enabled state unanswerable.
    const slots = new Set<string>(allSlots());
    for (const slot of chromeMenuSlots()) {
      expect(slots, `menu row ${slot}`).toContain(slot);
    }
  });

  test('menu rows are unique, so no capability appears twice in the bar', () => {
    const rows = chromeMenuSlots();
    expect(new Set(rows).size).toBe(rows.length);
  });

  test('submenu parents carry a label key and an icon, never a slot', () => {
    // A parent row opens a panel; it has no command, so giving it a slot would mint a
    // public id for a control `Editor.can` could never answer about.
    const walk = (entries: readonly ChromeMenuEntry[]): void => {
      for (const entry of entries) {
        if (entry.kind !== 'submenu') continue;
        expect(entry.labelKey).toMatch(/^[a-z][a-zA-Z]*\./);
        expect(entry.labelKey).not.toContain(' ');
        expect(entry.paths?.length ?? 0).toBeGreaterThan(0);
        expect(entry.items.length).toBeGreaterThan(0);
        walk(entry.items);
      }
    };
    for (const menu of CHROME_MENUS) walk(menu.entries);
  });

  test('the File menu offers open, save and page setup — and no print', () => {
    const file = CHROME_MENUS.find((m) => m.id === 'file');
    expect(file).toBeDefined();
    const rows = file!.entries.flatMap((e) => (e.kind === 'item' ? [e.slot] : []));
    expect(rows).toEqual(['file.open', 'file.save', 'file.pageSetup']);
  });

  test('the Insert menu reaches the two break kinds the engine wires', () => {
    // `insert.pageBreak` and `insert.sectionBreakNextPage` are live commands; the
    // continuous break is present and refused, so the menu shows Word's three choices
    // without faking the one layout cannot do.
    expect(commandForSlot('insert.pageBreak')).toEqual({ type: 'insertBreak', kind: 'page' });
    expect(commandForSlot('insert.sectionBreakNextPage')).toEqual({
      type: 'insertBreak',
      kind: 'section',
    });
    expect(commandForSlot('insert.sectionBreakContinuous')).toBeNull();
  });

  test('open and save each report which of the two they are missing', () => {
    // Both capabilities EXIST — what neither has is a command. Reporting the generic "not
    // wired to an editor command" would tell a host the capability is missing.
    expect(toolbarCommandState(null, 'file.open').disabledReason).toBe('editor is not ready');
    const stub = {
      can: () => ({ ok: false as const, code: 'unsupported' as const, reason: 'no' }),
      exec: () => ({ ok: false as const, code: 'unsupported' as const, reason: 'no' }),
    } as unknown as Parameters<typeof toolbarCommandState>[0];
    expect(toolbarCommandState(stub, 'file.open').disabledReason).toContain('editor.load(bytes)');
    expect(toolbarCommandState(stub, 'file.save').disabledReason).toContain('runSave(editor)');
  });

  test('page setup is probe-driven, like the link control', () => {
    // The dialog supplies the values, so there is no fixed command — but the capability is
    // real, and the probe is how chrome that owns a dialog asks whether it is honoured.
    expect(commandForSlot('file.pageSetup')).toBeNull();
    expect(chromeProbeForSlot('file.pageSetup')).toEqual({
      type: 'setPageSetup',
      orientation: 'portrait',
    });
  });
});
