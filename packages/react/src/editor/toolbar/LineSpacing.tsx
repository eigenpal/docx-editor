// The line-spacing dropdown: Word's control, which is a line-spacing menu AND the
// paragraph space-before/after commands under one caret.
//
// Both halves are engine commands, and both write the SAME `w:spacing` element — the line
// rule, the space before and the space after are three independent settings in one
// attribute set, which is why the writes merge rather than replace (see
// `setParagraphProperty`'s `mergeAttributes`). The ticked row and the add/remove wording
// come off the snapshot, so the menu reflects the paragraph the caret is in rather than
// showing a fixed list of things to apply.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxEditorParagraphDialog } from '../DocxEditorParagraphDialog';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps, ToolbarSlotPartComponent } from './parts';

/** Word's line-spacing menu, in lines. */
const LINE_SPACING_PRESETS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];

/**
 * What Word's "Add space before/after paragraph" writes: a flat 10pt.
 *
 * The ribbon command's own constant, not a value read from the document — a paragraph given
 * space this way lands on 10pt whatever its style states, so the pair is not a round trip
 * back to a Normal that states 8pt.
 */
const DEFAULT_PARAGRAPH_SPACE_PT = 10;

/**
 * Word's "Remove space before/after paragraph" writes an explicit ZERO, not nothing.
 *
 * The two are different answers, and the command draws the same distinction: dropping the
 * attribute lets the paragraph inherit again, so on a paragraph whose SPACE CAME FROM ITS
 * STYLE — every Word default document, whose Normal states 8pt after — Remove gave the space
 * straight back and the row went on offering to remove it. A zero blocks the cascade, which
 * is what the row says it does.
 */
const REMOVED_PARAGRAPH_SPACE_PT = 0;

const selectSpacing = (snapshot: EditorSnapshot) => ({
  lineSpacing: snapshot.formatting?.lineSpacing ?? null,
  spaceBeforePt: snapshot.formatting?.spaceBeforePt ?? null,
  spaceAfterPt: snapshot.formatting?.spaceAfterPt ?? null,
});

const sameSpacing = (a: ReturnType<typeof selectSpacing>, b: ReturnType<typeof selectSpacing>) =>
  a.spaceBeforePt === b.spaceBeforePt &&
  a.spaceAfterPt === b.spaceAfterPt &&
  a.lineSpacing?.rule === b.lineSpacing?.rule &&
  a.lineSpacing?.value === b.lineSpacing?.value;

function ToolbarLineSpacingImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const spacing = useEditorState(selectSpacing, sameSpacing);
  const { isEnabled, disabledReason } = useEditorCommand('list.lineSpacing');
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const applyLines = useCallback(
    (lines: number) => {
      setOpen(false);
      if (!editor) return;
      const command = commandForSlotValue('list.lineSpacing', lines);
      if (command && editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  const applySpace = useCallback(
    (field: 'beforePt' | 'afterPt', points: number | null) => {
      setOpen(false);
      if (!editor) return;
      const command = { type: 'setParagraphSpacing' as const, [field]: points };
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  if (hidden) return null;
  const control = chromeControlForSlot('list.lineSpacing');
  // Word's rows flip between Add and Remove on what the paragraph actually has, so the menu
  // never offers to add space that is already there.
  const hasBefore = (spacing.spaceBeforePt ?? 0) > 0;
  const hasAfter = (spacing.spaceAfterPt ?? 0) > 0;
  // Only a MULTIPLE can tick a row: `exact`/`atLeast` are real spacings this menu cannot
  // express, and ticking the nearest multiple would claim the menu set them.
  const ticked =
    spacing.lineSpacing?.rule === 'multiple' ? (spacing.lineSpacing?.value ?? null) : null;

  return (
    <span ref={rootRef} className="docx-toolbar__line-spacing" data-slot="list.lineSpacing">
      <button
        type="button"
        className={`docx-toolbar__button docx-toolbar__line-spacing-trigger${className ? ` ${className}` : ''}`}
        disabled={!isEnabled}
        {...(!isEnabled ? { 'data-disabled': '' } : {})}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label('lineSpacing.label')}
        title={disabledReason ?? label('lineSpacing.label')}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((current) => !current)}
      >
        {chromeIcon(control?.paths)}
        <span className="docx-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && isEnabled ? (
        <div className="docx-toolbar__menu docx-toolbar__line-spacing-menu" role="menu">
          {LINE_SPACING_PRESETS.map((lines) => {
            const selected = ticked === lines;
            return (
              <button
                key={lines}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                {...(selected ? { 'data-selected': '' } : {})}
                className="docx-toolbar__menu-item"
                onMouseDown={guardToolbarMousedown}
                onClick={() => applyLines(lines)}
              >
                {/* Word's own labels: 1.0, 1.15, 1.5, 2.0 — one decimal unless the
                    preset needs two. */}
                {Number.isInteger(lines * 10) ? lines.toFixed(1) : lines.toFixed(2)}
              </button>
            );
          })}
          <div className="docx-toolbar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() => {
              setOpen(false);
              setDialogOpen(true);
            }}
          >
            {label('lineSpacing.options')}
          </button>
          <div className="docx-toolbar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() =>
              applySpace(
                'beforePt',
                hasBefore ? REMOVED_PARAGRAPH_SPACE_PT : DEFAULT_PARAGRAPH_SPACE_PT
              )
            }
          >
            {label(hasBefore ? 'lineSpacing.removeSpaceBefore' : 'lineSpacing.addSpaceBefore')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() =>
              applySpace(
                'afterPt',
                hasAfter ? REMOVED_PARAGRAPH_SPACE_PT : DEFAULT_PARAGRAPH_SPACE_PT
              )
            }
          >
            {label(hasAfter ? 'lineSpacing.removeSpaceAfter' : 'lineSpacing.addSpaceAfter')}
          </button>
        </div>
      ) : null}
      {/* The rows above are Word's shortcuts — a fixed Add, a zeroing Remove. The dialog is
          the escape hatch for an exact value, which is what "Line spacing options…" opens
          in Word and what this menu had no answer for. */}
      <DocxEditorParagraphDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </span>
  );
}

/** The line-spacing part (`DocxEditorToolbar.LineSpacing`): wired to `list.lineSpacing`. */
export const ToolbarLineSpacing: ToolbarSlotPartComponent = Object.assign(ToolbarLineSpacingImpl, {
  docxSlot: 'list.lineSpacing' as const,
});
