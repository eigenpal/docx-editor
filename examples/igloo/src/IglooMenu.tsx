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
// WHERE A ROW BELONGS is the rule this file follows, and it is worth stating because it is
// easy to get wrong: a command the editor already has goes where a Word user expects to find
// it — a page break lives under Insert, not under the product's own menu. The product's menu
// is for what the product ADDED, and here that is exactly one thing: the custom document
// nodes, under a heading that says so.

import { DocxEditor, useDocxEditor } from '@docx-editor.dev/react';
import type { ReactNode } from 'react';
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

/**
 * A section heading inside a panel.
 *
 * The demo's OWN element — the menu parts are rows, separators and submenus, with no group
 * or heading among them, and an unrecognized child renders verbatim. `role="presentation"`
 * because a bare `div` inside `role="menu"` would break the ownership a screen reader
 * derives its "x of y" counts from; this is a visual grouping and says so.
 */
function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="igloo-menu__heading" role="presentation">
      {children}
    </div>
  );
}

export function IglooMenu() {
  const editor = useDocxEditor();
  const { freeze, thaw, enabled, disabledReason } = useFrost();
  // The demo's own document nodes. `editable` is the ENGINE's answer, not a guess: a
  // view-only document greys these rows out for the same reason it greys out Bold.
  const { compose, dropRandom, editable, disabledReason: nodeReason } = useSpecimens();
  // Spread once: three rows share the same gate and the same explanation for it.
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

      {/* Insert, with the preset KEPT and one row appended. A page break is an ordinary
          insert command, so it belongs here beside the packaged ones rather than in the
          product's own menu — the theme renames it, it does not relocate it. `preset`
          defaults to true, which is what appends rather than replaces. */}
      <DocxEditor.Menu.Insert icon={IceInsert}>
        <DocxEditor.Menu.Row
          icon={IceCarve}
          shortcut="Ctrl+Enter"
          onSelect={() => editor?.exec({ type: 'insertBreak', kind: 'page' })}
        >
          Split the floe
        </DocxEditor.Menu.Row>
      </DocxEditor.Menu.Insert>

      {/* THE PRODUCT'S OWN MENU, appended after the registry's, and named for what it is.
          `label` rather than `labelKey`: its name is the product's and will never be in our
          catalogue. It reads as the odd one out in a bar of File / Format / Insert / Help
          BECAUSE those four keep their conventional names — see `labels.ts`. Everything in
          here is something the library does not have, which is the reason it is a separate
          menu instead of rows sprinkled through the packaged ones. */}
      <DocxEditor.Menu.Menu id="igloo" label="Custom Actions" icon={IceIgloo} preset={false}>
        <Heading>Custom elements</Heading>
        {/* Each row authors a run-level content control whose `w:tag` carries the node's
            identity — a real, saveable document node that Word and the free tier both open
            as ordinary text. `defineCustomNode` in `specimens.ts` is what makes them typed
            again on the way back in. */}
        <DocxEditor.Menu.Row icon={IceBerg} {...nodeGate} onSelect={() => compose('iceberg')}>
          Calve an iceberg…
        </DocxEditor.Menu.Row>
        <DocxEditor.Menu.Row icon={IceDome} {...nodeGate} onSelect={() => compose('igloo')}>
          Build an igloo…
        </DocxEditor.Menu.Row>
        <DocxEditor.Menu.Row icon={IceLottery} {...nodeGate} onSelect={dropRandom}>
          Take whatever the water gives
        </DocxEditor.Menu.Row>

        <DocxEditor.Menu.Separator />
        <Heading>This passage</Heading>
        {/* Not a custom node — a host action over a real engine command, gated on
            `Editor.can`. Grouped apart so the distinction is visible. */}
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
      </DocxEditor.Menu.Menu>

      {/* Help, with its one packaged row REMOVED BY NAME rather than by `preset={false}`.
          Help injects `Menu.ReportIssue` as a child of its own so the ordinary merge rules
          can reach it, which means `preset={false}` renders it too — the row survived and
          sat above these two. `hidden` is the documented way to drop it, and it is the right
          one anyway: the packaged row opens THIS project's issue tracker, which is the wrong
          destination for a product that merely embeds the editor. */}
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
