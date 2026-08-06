// The right-click menu, cut from an iceberg.
//
// Shows every way `DocxEditor.ContextMenu` composes, in one panel:
//
// - packaged rows kept as-is (`Paste`, `Delete`, `SelectAll`) — they still ask the engine
//   whether they may run, and still grey out with its reason;
// - a packaged row RE-ICONED in place (`Cut`, `Copy`) without losing that wiring;
// - a packaged row REMOVED (`review.comments`, replaced below by the demo's own version);
// - a chrome slot pulled in as a row (`Slot slot="format.clear"`);
// - the demo's OWN rows (`Item`), which the engine knows nothing about;
// - a submenu of real insert commands.
//
// The berg art is a sibling of the rows, not a wrapper around them: the panel keeps the
// library's own element (and therefore its roles, its keyboard handling and its placement),
// and the SVG sits behind at `z-index: 0` with no hit test of its own.

import { DocxEditor, useChromeTranslate, useDocxEditor } from '@docx-editor.dev/react';
import { CustomNodeContextMenu } from '@docx-editor.dev/pro/react';
import { BergPanel } from './art/Iceberg';
import { useFrost } from './useFrost';
import { useSpecimens } from './useSpecimens';
import { ICE_LABELS } from './labels';
import {
  IceBerg,
  IceCarve,
  IceCopy,
  IceCore,
  IceCut,
  IceDome,
  IceFrost,
  IceLottery,
  IceThaw,
} from './icons/menu';

export function IglooContextMenu() {
  const editor = useDocxEditor();
  // Ice vocabulary first, then the active locale catalogue — the packaged fallback chain.
  const iglooT = useChromeTranslate(ICE_LABELS);
  // The SAME hook the toolbar's Freeze action uses, so the two surfaces cannot disagree
  // about when the demo's own edit is available.
  const { freeze, thaw, enabled, disabledReason } = useFrost();
  const { compose, dropRandom, edit, editable } = useSpecimens();

  return (
    <DocxEditor.ContextMenu className="igloo-menu" t={iglooT}>
      {/* The berg the rows sit on. It is not a wrapper: an unrecognized child APPENDS, so
          this lands after the rows in DOM order and sits behind them on `z-index` instead —
          which is what keeps the library's own panel element, roles and keyboard intact. */}
      <BergPanel />

      {/* Renders only when the right-click landed on a recognized chip; `docxRowPlacement:
          'start'` puts it at the top without this file ordering it. The library resolves which
          node was pressed, the product decides what editing one looks like. */}
      <CustomNodeContextMenu onEditNode={edit} />

      {/* Packaged rows, re-iconed in place. Everything else about them is untouched:
          they still run the engine's `cut`/`copy` commands and still carry the engine's
          reason when nothing is selected. */}
      <DocxEditor.ContextMenu.Cut icon={IceCut} />
      <DocxEditor.ContextMenu.Copy icon={IceCopy} />

      {/* The packaged comment row, dropped in favour of the demo's own below. */}
      <DocxEditor.ContextMenu.Slot slot="review.comments" hidden />

      {/* The demo's own rows. No slot, no command — the host supplies the label, the
          enabled state and the action, and the engine has no opinion about any of it. */}
      <DocxEditor.ContextMenu.Item
        label="Freeze this passage"
        icon={IceFrost}
        disabled={!enabled}
        {...(disabledReason ? { disabledReason } : {})}
        onSelect={freeze}
      />
      <DocxEditor.ContextMenu.Item
        label="Thaw it out"
        icon={IceThaw}
        disabled={!enabled}
        {...(disabledReason ? { disabledReason } : {})}
        onSelect={thaw}
      />
      <DocxEditor.ContextMenu.Item
        label="Add to the ice core"
        icon={IceCore}
        onSelect={() =>
          editor?.exec({ type: 'addComment', text: 'Logged in the ice core.', author: 'Igloo' })
        }
      />

      {/* Two submenus, kept apart: engine commands the theme renamed, then the demo's own
          document nodes. Same row type and gating in both; only the origin differs. */}
      <DocxEditor.ContextMenu.Submenu labelKey="igloo.carve" paths={null}>
        <DocxEditor.ContextMenu.Item
          label="Carve a page break"
          icon={IceCarve}
          onSelect={() => editor?.exec({ type: 'insertBreak', kind: 'page' })}
        />
        <DocxEditor.ContextMenu.Item
          label="Carve a 3×3 grid"
          icon={IceCarve}
          onSelect={() => editor?.exec({ type: 'insertTable', rows: 3, cols: 3 })}
        />
      </DocxEditor.ContextMenu.Submenu>

      <DocxEditor.ContextMenu.Submenu labelKey="igloo.specimens" paths={null}>
        <DocxEditor.ContextMenu.Item
          label="Calve an iceberg…"
          icon={IceBerg}
          disabled={!editable}
          onSelect={() => compose('iceberg')}
        />
        <DocxEditor.ContextMenu.Item
          label="Build an igloo…"
          icon={IceDome}
          disabled={!editable}
          onSelect={() => compose('igloo')}
        />
        <DocxEditor.ContextMenu.Item
          label="Take whatever the water gives"
          icon={IceLottery}
          disabled={!editable}
          onSelect={dropRandom}
        />
      </DocxEditor.ContextMenu.Submenu>

      {/* A chrome slot as a row: label, icon and enabled state all from the registry, so it
          cannot disagree with its toolbar twin. */}
      <DocxEditor.ContextMenu.Slot slot="format.clear" />
    </DocxEditor.ContextMenu>
  );
}
