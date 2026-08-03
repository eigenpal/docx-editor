// The stepper parts: font size and zoom as minus / value / plus clusters.
//
// Both are WIRED, not lookalikes, and both step through the chrome spec's preset
// ladders, not by a fixed increment. Font size is a value-typed slot: the current value comes off the
// snapshot's selection formatting (`fontSizePt`), and a step dispatches
// `commandForSlotValue('font.size', halfPoints)` through the can-before-exec gate —
// the engine's own `setMarkAttr` validation (integer half-points, 2..3276) is the
// authority, this component only clamps the step so a click can never build an
// out-of-range command. The value renders as the BOXED display between the
// two ghost buttons. Zoom is engine-owned facade state (`Editor.setZoom` /
// `snapshot().zoom`); its middle is the "100% ▾" — a caret button opening the
// preset-level menu — flanked by − / + that walk the same levels.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import {
  commandForSlotValue,
  TWIPS_PER_CM as RULER_TWIPS_PER_CM,
  TWIPS_PER_INCH as RULER_TWIPS_PER_INCH,
} from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps, ToolbarSlotPartComponent } from './parts';

/** Engine bounds for `w:sz`: integer half-points, 2..3276 (docx-editor-support). */
const MIN_HALF_POINTS = 2;
const MAX_HALF_POINTS = 3276;

/** The preset ladder the − / + buttons walk, in points. */
const FONT_SIZE_PRESETS_PT: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72,
];

/** The zoom levels: the − / + endpoints and the ▾ menu entries. */
const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

const selectFontSizePt = (snapshot: EditorSnapshot) => snapshot.formatting?.fontSizePt ?? null;
const selectZoom = (snapshot: EditorSnapshot) => snapshot.zoom;

/** The next preset above `current`, or `current + 1` beyond the ladder. */
function nextPreset(current: number, presets: readonly number[], max: number): number {
  for (const preset of presets) if (preset > current) return preset;
  return Math.min(current + 1, max);
}

/** The nearest preset below `current`, or `current - 1` below the ladder. */
function prevPreset(current: number, presets: readonly number[], min: number): number {
  for (let index = presets.length - 1; index >= 0; index -= 1) {
    if (presets[index]! < current) return presets[index]!;
  }
  return Math.max(current - 1, min);
}

interface StepperShellProps {
  /**
   * The slot marker for the cluster. The font-size part's shell IS its top-level
   * element, so it carries the marker; zoom's shell sits INSIDE the part's positioning
   * root (which owns the marker), so it passes none — a slot id must appear exactly
   * once, on the element the toolbar arrangement addresses.
   */
  readonly slot?: string;
  readonly groupLabel: string;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  /** The middle of the cluster: the boxed value, or the zoom caret button. */
  readonly middle: ReactNode;
  readonly canDecrease: boolean;
  readonly canIncrease: boolean;
  readonly onDecrease: () => void;
  readonly onIncrease: () => void;
  readonly title?: string;
  readonly className?: string;
}

/** The shared minus / middle / plus cluster. */
function StepperShell(props: StepperShellProps) {
  return (
    <span
      className={`docx-toolbar__stepper${props.className ? ` ${props.className}` : ''}`}
      {...(props.slot !== undefined ? { 'data-slot': props.slot } : {})}
      role="group"
      aria-label={props.groupLabel}
      title={props.title ?? props.groupLabel}
    >
      <button
        type="button"
        className="docx-toolbar__stepper-button"
        disabled={!props.canDecrease}
        aria-label={props.decreaseLabel}
        onMouseDown={guardToolbarMousedown}
        onClick={props.onDecrease}
      >
        −
      </button>
      {props.middle}
      <button
        type="button"
        className="docx-toolbar__stepper-button"
        disabled={!props.canIncrease}
        aria-label={props.increaseLabel}
        onMouseDown={guardToolbarMousedown}
        onClick={props.onIncrease}
      >
        +
      </button>
    </span>
  );
}

/**
 * The typed value, or null when it is not a size the engine would accept.
 *
 * Deliberately permissive about SHAPE and strict about RANGE: a user typing `10.5` means
 * 21 half-points, and one typing `10.7` means the nearest the unit can express. Anything
 * that is not a finite number, or falls outside `w:sz`'s bounds, is not a size at all and
 * reverts rather than being clamped silently into one the user did not ask for.
 */
function parseTypedSize(text: string): number | null {
  const trimmed = text.trim().replace(/pt$/i, '').trim();
  if (trimmed === '') return null;
  const points = Number(trimmed);
  if (!Number.isFinite(points)) return null;
  const halfPoints = Math.round(points * 2);
  if (halfPoints < MIN_HALF_POINTS || halfPoints > MAX_HALF_POINTS) return null;
  return halfPoints;
}

function ToolbarFontSizeImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const sizePt = useEditorState(selectFontSizePt);
  const { isEnabled, disabledReason } = useEditorCommand('font.size');
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  /** The text being typed, or null when the box is showing the document's own value. */
  const [draft, setDraft] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const applyHalfPoints = useCallback(
    (halfPoints: number) => {
      if (!editor) return;
      const command = commandForSlotValue('font.size', halfPoints);
      if (!command) return;
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  const apply = useCallback(
    (points: number) => {
      applyHalfPoints(Math.min(MAX_HALF_POINTS, Math.max(MIN_HALF_POINTS, Math.round(points * 2))));
    },
    [applyHalfPoints]
  );

  /** Leave the box: drop the draft, close the list, hand the caret back to the document. */
  const dismiss = useCallback((refocus: boolean) => {
    setOpen(false);
    setDraft(null);
    inputRef.current?.blur();
    if (refocus) editorFocus(rootRef.current);
  }, []);

  // Outside mousedown closes the list, the same pattern the zoom menu uses.
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
      setDraft(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  if (hidden) return null;
  const canStep = isEnabled && sizePt !== null;
  // No agreed size (mixed selection / no selection formatting) shows an em-dash, matching
  // the FontFamily trigger — never an invented number. A draft in progress wins over both:
  // the box must show what the user is typing, not what the document still says.
  const documentValue = sizePt === null ? '—' : String(Math.round(sizePt * 2) / 2);
  const shown = draft ?? documentValue;
  const selectedPreset = sizePt === null ? null : Math.round(sizePt * 2) / 2;

  const commitDraft = () => {
    if (draft === null) return;
    const halfPoints = parseTypedSize(draft);
    if (halfPoints !== null) applyHalfPoints(halfPoints);
  };

  return (
    <span
      ref={rootRef}
      className="docx-toolbar__font-size"
      data-slot="font.size"
      title={disabledReason ?? undefined}
    >
      <StepperShell
        className={className}
        groupLabel={label('fontSize.label')}
        decreaseLabel={label('fontSize.decrease')}
        increaseLabel={label('fontSize.increase')}
        middle={
          // A combobox, not a readout: Word's size box takes a typed value as readily as a
          // picked one, and 13pt is not on any preset ladder.
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="docx-toolbar__stepper-value docx-toolbar__stepper-value--boxed docx-toolbar__font-size-input"
            value={shown}
            disabled={!isEnabled}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={label('fontSize.label')}
            autoComplete="off"
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
            }}
            onFocus={(event) => {
              // Selected on entry, so typing REPLACES the size rather than appending to it.
              event.target.select();
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitDraft();
                dismiss(true);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                dismiss(true);
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                // Word's box steps with the arrows; opening the list on the way is what a
                // combobox is expected to do.
                event.preventDefault();
                setOpen(true);
                if (sizePt !== null) {
                  apply(
                    event.key === 'ArrowDown'
                      ? prevPreset(sizePt, FONT_SIZE_PRESETS_PT, MIN_HALF_POINTS / 2)
                      : nextPreset(sizePt, FONT_SIZE_PRESETS_PT, MAX_HALF_POINTS / 2)
                  );
                }
              }
            }}
            onBlur={() => {
              // Committing on blur is what Word does, and it is the only way a click
              // straight back into the document keeps the size that was typed. Preset rows
              // suppress their own mousedown, so picking one never reaches this path.
              commitDraft();
              setDraft(null);
            }}
          />
        }
        canDecrease={canStep && Math.round(sizePt! * 2) > MIN_HALF_POINTS}
        canIncrease={canStep && Math.round(sizePt! * 2) < MAX_HALF_POINTS}
        onDecrease={() => apply(prevPreset(sizePt ?? 0, FONT_SIZE_PRESETS_PT, MIN_HALF_POINTS / 2))}
        onIncrease={() => apply(nextPreset(sizePt ?? 0, FONT_SIZE_PRESETS_PT, MAX_HALF_POINTS / 2))}
      />
      {open && isEnabled ? (
        <div
          className="docx-toolbar__menu docx-toolbar__font-size-menu"
          role="listbox"
          aria-label={label('fontSize.listLabel')}
        >
          {FONT_SIZE_PRESETS_PT.map((preset) => {
            const selected = selectedPreset === preset;
            return (
              <button
                key={preset}
                type="button"
                role="option"
                aria-selected={selected}
                {...(selected ? { 'data-selected': '' } : {})}
                className="docx-toolbar__menu-item"
                // Suppressed so the input keeps focus and `onBlur` never fires between the
                // press and the click — a blur here would commit the draft first and this
                // pick second, against a size the user had already abandoned.
                onMouseDown={guardToolbarMousedown}
                onClick={() => {
                  apply(preset);
                  dismiss(true);
                }}
              >
                {preset}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

/**
 * Hand the caret back to the document after a toolbar control is done with it.
 *
 * The pages layer is the focusable surface; without this a picked or typed size left focus
 * in the toolbar, so the next keystroke went to the box rather than the document.
 */
function editorFocus(from: HTMLElement | null): void {
  const root = from?.closest('.ep-root') ?? from?.ownerDocument?.body;
  const pages = root?.querySelector<HTMLElement>('.docx-pages');
  pages?.focus();
}

/** The font-size stepper part (`DocxEditorToolbar.FontSize`): wired to `font.size`. */
export const ToolbarFontSize: ToolbarSlotPartComponent = Object.assign(ToolbarFontSizeImpl, {
  docxSlot: 'font.size' as const,
});

function ToolbarZoomImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const zoom = useEditorState(selectZoom);
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // Outside mousedown closes the level menu (same pattern as FontFamily.Content).
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

  const apply = useCallback(
    (level: number) => {
      setOpen(false);
      editor?.setZoom(level);
    },
    [editor]
  );

  if (hidden) return null;
  const epsilon = 0.001;
  const prevLevel = [...ZOOM_LEVELS].reverse().find((level) => level < zoom - epsilon);
  const nextLevel = ZOOM_LEVELS.find((level) => level > zoom + epsilon);
  const display = `${Math.round(zoom * 100)}%`;
  return (
    <span ref={rootRef} className="docx-toolbar__zoom" data-slot="zoom.level">
      <StepperShell
        className={className}
        groupLabel={label('zoom.zoomLevel')}
        decreaseLabel={label('zoom.zoomOut')}
        increaseLabel={label('zoom.zoomIn')}
        middle={
          // The middle: the current % with a caret, opening the level menu.
          <button
            type="button"
            className="docx-toolbar__stepper-value docx-toolbar__stepper-value--menu"
            disabled={!editor}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label('zoom.zoomLevel')}
            onMouseDown={guardToolbarMousedown}
            onClick={() => setOpen((current) => !current)}
          >
            {display}
            <span className="docx-toolbar__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        }
        canDecrease={!!editor && prevLevel !== undefined}
        canIncrease={!!editor && nextLevel !== undefined}
        onDecrease={() => prevLevel !== undefined && apply(prevLevel)}
        onIncrease={() => nextLevel !== undefined && apply(nextLevel)}
      />
      {open ? (
        <div className="docx-toolbar__menu docx-toolbar__zoom-menu" role="listbox">
          {ZOOM_LEVELS.map((level) => {
            const selected = Math.abs(level - zoom) < epsilon;
            return (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={selected}
                {...(selected ? { 'data-selected': '' } : {})}
                className="docx-toolbar__menu-item"
                onMouseDown={guardToolbarMousedown}
                onClick={() => apply(level)}
              >
                {`${Math.round(level * 100)}%`}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

/** The zoom stepper part (`DocxEditorToolbar.Zoom`): wired to `Editor.setZoom`. */
export const ToolbarZoom: ToolbarSlotPartComponent = Object.assign(ToolbarZoomImpl, {
  docxSlot: 'zoom.level' as const,
});

// ---------------------------------------------------------------------------------------
// Indent steppers.
//
// `list.indent` / `list.outdent` STEP by a tab stop (or demote a list item). These set an
// EXACT value, which is what the ruler's drag produces and what Word's paragraph dialog
// offers — a drag can express 0.63" and no ladder can, so the box takes a typed value too.
// ---------------------------------------------------------------------------------------

/** Word's paragraph dialog steps a tenth of an inch, not the 720-twip Increase Indent. */
const INDENT_STEP_INCH = Math.round(RULER_TWIPS_PER_INCH / 10);
const INDENT_STEP_CM = Math.round(RULER_TWIPS_PER_CM / 10);

/** Props for the indent steppers: the slot part's, plus the unit the value reads in. */
export interface ToolbarIndentProps extends ToolbarSlotPartProps {
  /** Must match the ruler's unit — an inch box beside a centimetre ruler is a bug. */
  readonly unit?: 'inch' | 'cm';
}

export interface ToolbarIndentComponent {
  (props: ToolbarIndentProps): ReactNode;
  readonly docxSlot: 'indent.left' | 'indent.right';
}

const selectIndentLeft = (snapshot: EditorSnapshot) => snapshot.formatting?.indent?.left ?? null;
const selectIndentRight = (snapshot: EditorSnapshot) => snapshot.formatting?.indent?.right ?? null;
const selectMixedLeft = (snapshot: EditorSnapshot) =>
  snapshot.formatting?.indent?.mixed.left ?? false;
const selectMixedRight = (snapshot: EditorSnapshot) =>
  snapshot.formatting?.indent?.mixed.right ?? false;

/** Twips as the box shows them: at most two decimals, no trailing zeros. */
function formatIndent(twips: number, unit: 'inch' | 'cm'): string {
  const per = unit === 'cm' ? RULER_TWIPS_PER_CM : RULER_TWIPS_PER_INCH;
  const value = Math.round((twips / per) * 100) / 100;
  return `${value}${unit === 'cm' ? ' cm' : '"'}`;
}

/**
 * A typed indent, or null when it is not one the engine would take.
 *
 * Permissive about shape (a stray `"` or `cm` is what a user retypes over the box's own
 * display) and strict about range, like `parseTypedSize`.
 */
function parseTypedIndent(text: string, unit: 'inch' | 'cm'): number | null {
  const trimmed = text
    .trim()
    .replace(/["”]|cm$/i, '')
    .trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const twips = Math.round(value * (unit === 'cm' ? RULER_TWIPS_PER_CM : RULER_TWIPS_PER_INCH));
  return Math.abs(twips) > MAX_INDENT_TWIPS ? null : twips;
}

/** The engine's own bound, mirrored so a click can never build an out-of-range command. */
const MAX_INDENT_TWIPS = 31_680;

function IndentStepper({
  side,
  slot,
  className,
  hidden,
  unit = 'inch',
}: ToolbarIndentProps & { side: 'left' | 'right'; slot: 'indent.left' | 'indent.right' }) {
  const editor = useDocxEditor();
  const value = useEditorState(side === 'left' ? selectIndentLeft : selectIndentRight);
  const mixed = useEditorState(side === 'left' ? selectMixedLeft : selectMixedRight);
  const { isEnabled, disabledReason } = useEditorCommand(slot);
  const label = useToolbarLabel();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const apply = useCallback(
    (twips: number) => {
      if (!editor) return;
      const clamped = Math.max(-MAX_INDENT_TWIPS, Math.min(MAX_INDENT_TWIPS, Math.round(twips)));
      const command = commandForSlotValue(slot, clamped);
      if (!command) return;
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor, slot]
  );

  if (hidden) return null;

  const step = unit === 'cm' ? INDENT_STEP_CM : INDENT_STEP_INCH;
  // No document indent (no selection, or a caret in a table) is the only dead state. A
  // MIXED selection stays live and shows the first paragraph's value, as Word's does —
  // disabling there would kill the control exactly where it is most useful.
  const canStep = isEnabled && value !== null;
  const shown = draft ?? (value === null ? '—' : formatIndent(value, unit));
  const groupLabel = label(side === 'left' ? 'indent.left' : 'indent.right');

  const commitDraft = () => {
    if (draft === null) return;
    const twips = parseTypedIndent(draft, unit);
    if (twips !== null) apply(twips);
  };

  return (
    <span
      className={`docx-toolbar__indent${className ? ` ${className}` : ''}`}
      data-slot={slot}
      {...(mixed ? { 'data-mixed': '' } : {})}
      title={disabledReason ?? (mixed ? label('indent.mixed') : groupLabel)}
    >
      <StepperShell
        groupLabel={groupLabel}
        decreaseLabel={label(side === 'left' ? 'indent.decreaseLeft' : 'indent.decreaseRight')}
        increaseLabel={label(side === 'left' ? 'indent.increaseLeft' : 'indent.increaseRight')}
        middle={
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="docx-toolbar__stepper-value docx-toolbar__stepper-value--boxed docx-toolbar__indent-input"
            value={shown}
            disabled={!isEnabled}
            aria-label={groupLabel}
            // The value shown is one paragraph's, so an accessible name that claimed it
            // spoke for the whole selection would be a lie.
            {...(mixed ? { 'aria-description': label('indent.mixed') } : {})}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitDraft();
                setDraft(null);
                inputRef.current?.blur();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setDraft(null);
                inputRef.current?.blur();
              } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && value !== null) {
                event.preventDefault();
                apply(value + (event.key === 'ArrowUp' ? step : -step));
              }
            }}
            onBlur={() => {
              commitDraft();
              setDraft(null);
            }}
          />
        }
        canDecrease={canStep}
        canIncrease={canStep}
        onDecrease={() => value !== null && apply(value - step)}
        onIncrease={() => value !== null && apply(value + step)}
      />
    </span>
  );
}

/** The left-indent stepper (`DocxEditorToolbar.IndentLeft`): wired to `setIndent`. */
export const ToolbarIndentLeft: ToolbarIndentComponent = Object.assign(
  (props: ToolbarIndentProps) => <IndentStepper {...props} side="left" slot="indent.left" />,
  { docxSlot: 'indent.left' as const }
);

/** The right-indent stepper (`DocxEditorToolbar.IndentRight`): wired to `setIndent`. */
export const ToolbarIndentRight: ToolbarIndentComponent = Object.assign(
  (props: ToolbarIndentProps) => <IndentStepper {...props} side="right" slot="indent.right" />,
  { docxSlot: 'indent.right' as const }
);
