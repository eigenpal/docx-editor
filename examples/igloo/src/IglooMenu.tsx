// The menu bar, with a menu the library has never heard of.
//
// The default bar is DERIVED from the core registry, so it is already correct without this
// file existing. What this shows is the three things a product adds on top:
//
// - a whole menu of its own (`Menu.Menu id="igloo"`), which works because `MenuId` accepts
//   any string alongside the registry's four;
// - one extra row APPENDED to a registry menu, keeping every packaged row above it;
// - Help replaced outright, because the packaged Help row points at THIS project's issue
//   tracker and a product embedding the editor should point at its own.
//
// Placement follows origin: a command the editor already has goes where a Word user expects
// it (a page break belongs under Insert), and the product's own menu is for what the product
// added.

import { DocxEditor, useDocxEditor } from '@docx-editor.dev/react';
import { useFrost } from './useFrost';
import { useSpecimens } from './useSpecimens';
import { iglooT } from './labels';
import {
  IceBerg,
  IceCarve,
  IceDome,
  IceFile,
  IceFormat,
  IceFrost,
  IceGuide,
  IceIgloo,
  IceInsert,
  IceLottery,
  IceThaw,
} from './icons/menu';

export function IglooMenu() {
  const editor = useDocxEditor();
  const { freeze, thaw, enabled, disabledReason } = useFrost();
  // `editable` is the engine's answer: a view-only document greys these out like it does Bold.
  const { compose, dropRandom, editable, disabledReason: nodeReason } = useSpecimens();
  // Three rows share one gate and one explanation for it.
  const nodeGate = {
    disabled: !editable,
    ...(nodeReason ? { title: nodeReason } : {}),
  };

  return (
    <DocxEditor.Menu className="igloo-menubar" t={iglooT}>
      {/* The registry's menus, re-iconed IN PLACE. Nothing else about them changes — each
          still derives its rows from `CHROME_MENUS`, so a row added to the registry still
          appears here. The packaged bar has no icons at all (neither Word nor Docs does),
          which is exactly why this is worth showing: it is opt-in, per trigger. */}
      <DocxEditor.Menu.File icon={IceFile} />
      <DocxEditor.Menu.Format icon={IceFormat} />

      {/* Preset kept, one row appended: `preset` defaults to true. The theme renames a page
          break, it does not relocate it. */}
      <DocxEditor.Menu.Insert icon={IceInsert}>
        <DocxEditor.Menu.Row
          icon={IceCarve}
          shortcut="Ctrl+Enter"
          onSelect={() => editor?.exec({ type: 'insertBreak', kind: 'page' })}
        >
          Split the floe
        </DocxEditor.Menu.Row>
      </DocxEditor.Menu.Insert>

      {/* The product's own menu, named for what it is. `label` rather than `labelKey`: its
          name will never be in our catalogue. It reads as the odd one out precisely because
          the other four keep their conventional names — see `labels.ts`. */}
      <DocxEditor.Menu.Menu id="igloo" label="Custom Actions" icon={IceIgloo} preset={false}>
        {/* `Menu.Group` is a real `role="group"` taking its heading as the accessible name.
            Each row authors a run-level content control whose `w:tag` carries the node's
            identity — a saveable document node Word opens as ordinary text. */}
        <DocxEditor.Menu.Group label="Custom elements">
          <DocxEditor.Menu.Row icon={IceBerg} {...nodeGate} onSelect={() => compose('iceberg')}>
            Calve an iceberg…
          </DocxEditor.Menu.Row>
          <DocxEditor.Menu.Row icon={IceDome} {...nodeGate} onSelect={() => compose('igloo')}>
            Build an igloo…
          </DocxEditor.Menu.Row>
          <DocxEditor.Menu.Row icon={IceLottery} {...nodeGate} onSelect={dropRandom}>
            Take whatever the water gives
          </DocxEditor.Menu.Row>
        </DocxEditor.Menu.Group>

        <DocxEditor.Menu.Separator />

        {/* Not custom nodes: host actions over engine commands, gated on `Editor.can`. */}
        <DocxEditor.Menu.Group label="This passage">
          <DocxEditor.Menu.Row
            icon={IceFrost}
            disabled={!enabled}
            {...(disabledReason ? { title: disabledReason } : {})}
            onSelect={freeze}
          >
            Freeze this passage
          </DocxEditor.Menu.Row>
          <DocxEditor.Menu.Row
            icon={IceThaw}
            disabled={!enabled}
            {...(disabledReason ? { title: disabledReason } : {})}
            onSelect={thaw}
          >
            Thaw it out
          </DocxEditor.Menu.Row>
        </DocxEditor.Menu.Group>
      </DocxEditor.Menu.Menu>

      {/* Help's packaged row removed BY NAME, not by `preset={false}` — Help passes it as a
          child of its own, so `preset={false}` renders it anyway. It points at this project's
          tracker, which is the wrong destination for a product that embeds the editor. */}
      <DocxEditor.Menu.Help icon={IceGuide}>
        <DocxEditor.Menu.ReportIssue hidden />
        <DocxEditor.Menu.Row
          onSelect={() => window.open('https://docx-editor.dev/docs/1.x', '_blank', 'noopener')}
        >
          Expedition handbook
        </DocxEditor.Menu.Row>
        <DocxEditor.Menu.Row onSelect={() => window.alert('Igloo Editor — a customization demo.')}>
          About Igloo
        </DocxEditor.Menu.Row>
      </DocxEditor.Menu.Help>
    </DocxEditor.Menu>
  );
}
