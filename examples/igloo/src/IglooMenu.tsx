// The menu bar, with a menu the library has never heard of.
//
// The default bar is DERIVED from the core registry, so it is already correct without this
// file existing. What this shows is the two things a product adds on top:
//
// - a whole menu of its own (`Menu.Menu id="igloo"`), which works because `MenuId` accepts
//   any string alongside the registry's four;
// - Help replaced outright, because the packaged Help row points at THIS project's issue
//   tracker and a product embedding the editor should point at its own.

import { DocxEditor, useDocxEditor } from '@docx-editor.dev/react';
import { useFrost } from './frost';
import { iglooT } from './labels';

export function IglooMenu() {
  const editor = useDocxEditor();
  const { freeze, thaw, enabled } = useFrost();

  return (
    <DocxEditor.Menu className="igloo-menubar" t={iglooT}>
      {/* A menu of the host's own, appended after the registry's four. `label` rather than
          `labelKey`: its name is the product's, and will never be in our catalogue. */}
      <DocxEditor.Menu.Menu id="igloo" label="Igloo" preset={false}>
        <DocxEditor.Menu.Row disabled={!enabled} onSelect={freeze}>
          Freeze this passage
        </DocxEditor.Menu.Row>
        <DocxEditor.Menu.Row disabled={!enabled} onSelect={thaw}>
          Thaw it out
        </DocxEditor.Menu.Row>
        <DocxEditor.Menu.Separator />
        <DocxEditor.Menu.Row
          onSelect={() => editor?.exec({ type: 'insertBreak', kind: 'page' })}
          shortcut="Ctrl+Enter"
        >
          Split the floe
        </DocxEditor.Menu.Row>
        <DocxEditor.Menu.Separator />
        <DocxEditor.Menu.Row
          onSelect={() => window.open('https://docx-editor.dev/docs/1.x', '_blank', 'noopener')}
        >
          About this berg
        </DocxEditor.Menu.Row>
      </DocxEditor.Menu.Menu>

      {/* Help, replaced. The packaged version's Report-issue row opens the docx-editor
          tracker, which is the wrong destination for a product that merely embeds it. */}
      <DocxEditor.Menu.Help preset={false}>
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
