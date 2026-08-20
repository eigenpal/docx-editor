// The editing-mode pill: Editing / Suggesting / Viewing.
//
// The one control whose state is a VALUE rather than a pressed flag, which is why
// `ToolbarCommandState` grew `value` for it: "the mode is Suggesting" is not a boolean about
// one command, and reading it from anywhere but the shared state would give the toolbar a
// second opinion about the document.
//
// Suggesting is not a permission — it changes what an edit MEANS. Typing writes `w:ins`,
// deleting writes `w:del` over the words it would have removed, and both arrive in the review
// pane as proposals. Viewing is the permission one: every command is refused while it is on.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentEditingMode, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { runToolbarCommand, toolbarCommandState } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';

const selectMode = (snapshot: EditorSnapshot): DocumentEditingMode =>
  snapshot.editingMode ?? 'editing';

interface ModeOption {
  readonly mode: DocumentEditingMode;
  readonly labelKey: 'editingMode.editing' | 'editingMode.suggesting' | 'editingMode.viewing';
  readonly hintKey:
    | 'editingMode.editingHint'
    | 'editingMode.suggestingHint'
    | 'editingMode.viewingHint';
  readonly path: string;
}

// Inline SVG, like every other toolbar glyph: this package ships no icon font.
const MODE_OPTIONS: readonly ModeOption[] = [
  {
    mode: 'editing',
    labelKey: 'editingMode.editing',
    hintKey: 'editingMode.editingHint',
    path: 'M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z',
  },
  {
    mode: 'suggesting',
    labelKey: 'editingMode.suggesting',
    hintKey: 'editingMode.suggestingHint',
    path: 'M240-400h122l40-40H240v40Zm0-100h222l40-40H240v40Zm0-100h322l40-40H240v40ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v320h-80v-320H160v525l46-45h274v80H240L80-80Zm520-80v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T943-380L723-160H600Zm300-263-37-37 37 37ZM660-220h38l121-122-19-18-18-19-122 121v38Zm140-141-18-19 37 37-19-18Z',
  },
  {
    mode: 'viewing',
    labelKey: 'editingMode.viewing',
    hintKey: 'editingMode.viewingHint',
    path: 'M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Z',
  },
];

const CHECK_PATH = 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z';

/** Props for `DocxEditor.Toolbar.EditingMode`. @public */
export interface ToolbarEditingModeProps {
  className?: string;
  hidden?: boolean;
}

/**
 * The editing-mode control.
 *
 * @public
 */
export function ToolbarEditingMode({ className, hidden }: ToolbarEditingModeProps) {
  const editor = useDocxEditor();
  const mode = useEditorState(selectMode);
  const label = useToolbarLabel();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // ARIA's menu pattern: focus moves INTO the menu on open, arrows move between items, and
  // Escape puts focus back on the trigger rather than dropping the user at `<body>`.
  //
  // Onto the CHECKED item, which for a radio group is where the pattern puts it. Landing on
  // the first one drew a focus ring around "Editing" while the check sat on "Suggesting", and
  // two marks disagreeing about the current mode reads as the menu being wrong.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0] ?? undefined)?.focus();
  }, [open]);

  const onMenuKeyDown = useCallback((event: React.KeyboardEvent): void => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    // Capture, like the link popover: the surface prevents default on its own pointer
    // handling, so a bubbling listener never sees a click that lands on the pages.
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = useCallback(
    (next: DocumentEditingMode) => {
      setOpen(false);
      // Through the shared can-before-exec path, so a refusal — a document opened read-only —
      // is the engine's answer rather than this control's guess.
      runToolbarCommand(editor, 'review.editingMode', next);
      // Back to the document: the mode is about typing, so the caret is where the user
      // wants to be once they have chosen.
      editor?.focus();
    },
    [editor]
  );

  // ONE source for enabled state, the same one every other control uses.
  const state = toolbarCommandState(editor, 'review.editingMode');
  const disabledReason = localizeDisabledReason(state.disabledReason, t);

  const current = useMemo(
    () => MODE_OPTIONS.find((option) => option.mode === mode) ?? MODE_OPTIONS[0]!,
    [mode]
  );

  if (hidden) return null;
  const control = chromeControlForSlot('review.editingMode');

  return (
    <div
      ref={rootRef}
      className={`docx-toolbar__mode${className ? ` ${className}` : ''}`}
      data-slot="review.editingMode"
    >
      <button
        ref={triggerRef}
        type="button"
        className="docx-toolbar__picker"
        data-testid="editing-mode-trigger"
        data-mode={mode}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label(control?.labelKey ?? 'editingMode.label')}
        disabled={!state.enabled}
        {...(disabledReason ? { title: disabledReason } : {})}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((previous) => !previous)}
      >
        {glyph(current.path)}
        <span className="docx-toolbar__picker-value">{label(current.labelKey)}</span>
        <span className="docx-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="docx-toolbar__mode-menu"
          role="menu"
          aria-label={label(control?.labelKey ?? 'editingMode.label')}
          data-testid="editing-mode-menu"
          onKeyDown={onMenuKeyDown}
        >
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={option.mode === mode}
              className="docx-toolbar__mode-item"
              data-testid={`editing-mode-${option.mode}`}
              onMouseDown={guardToolbarMousedown}
              onClick={() => choose(option.mode)}
            >
              {glyph(option.path)}
              <span className="docx-toolbar__mode-text">
                <span className="docx-toolbar__mode-label">{label(option.labelKey)}</span>
                <span className="docx-toolbar__mode-hint">{label(option.hintKey)}</span>
              </span>
              <span className="docx-toolbar__mode-check" aria-hidden="true">
                {option.mode === mode ? glyph(CHECK_PATH) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
ToolbarEditingMode.docxSlot = 'review.editingMode' as const;

function glyph(path: string) {
  return (
    <svg viewBox="0 -960 960 960" width={18} height={18} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
