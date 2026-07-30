// The named simple toolbar parts, plus the separator.
//
// Each part is `ToolbarButton` pinned to one slot, carrying that slot as a STATIC
// (`docxSlot`) so the toolbar root can recognize it among children and replace the
// matching entry of the default arrangement in place. The static is the marker on
// purpose — displayName is stripped by minifiers and was never identity.

import type { ChromeSlotId } from '@docx-editor.dev/core-contract/editor';
import { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';

/** Props for the named parts (`DocxEditorToolbar.Bold`, ...): the slot is pinned. @public */
export type ToolbarPartProps = Omit<ToolbarButtonProps, 'slot'>;

export interface ToolbarPartComponent {
  (props: ToolbarPartProps): ReturnType<typeof ToolbarButton>;
  readonly docxSlot: ChromeSlotId;
}

function definePart(slot: ChromeSlotId): ToolbarPartComponent {
  const Part = (props: ToolbarPartProps) => <ToolbarButton slot={slot} {...props} />;
  return Object.assign(Part, { docxSlot: slot });
}

export const ToolbarUndo = definePart('history.undo');
export const ToolbarRedo = definePart('history.redo');
export const ToolbarBold = definePart('text.bold');
export const ToolbarItalic = definePart('text.italic');
export const ToolbarUnderline = definePart('text.underline');
export const ToolbarStrike = definePart('text.strike');
export const ToolbarAlignLeft = definePart('alignment.left');
export const ToolbarAlignCenter = definePart('alignment.center');
export const ToolbarAlignRight = definePart('alignment.right');
export const ToolbarAlignJustify = definePart('alignment.justify');

/** Props for `DocxEditorToolbar.Separator`. @public */
export interface ToolbarSeparatorProps {
  className?: string;
}

/** A vertical rule between toolbar groups. @public */
export function ToolbarSeparator({ className }: ToolbarSeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`docx-toolbar__separator${className ? ` ${className}` : ''}`}
    />
  );
}
