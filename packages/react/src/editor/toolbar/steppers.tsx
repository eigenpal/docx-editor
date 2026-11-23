import { usePickerKeyboard } from './usePickerKeyboard';
import type { ReactNode } from 'react';
// The stepper parts: font size and zoom as minus / value / plus clusters.
//
// Both are WIRED, not lookalikes, and both step through preset ladders, not by a fixed
// increment. Font size is a value-typed slot: the current value comes off the snapshot's
// selection formatting (`fontSizePt`). A step dispatches `increaseFontSize` or
// `decreaseFontSize`, so the engine steps each run from its own size and a selection with
// several sizes still steps. A typed or picked size dispatches
// `commandForSlotValue('font.size', halfPoints)` through the can-before-exec gate — the
// engine's own `setMarkAttr` validation (integer half-points, 2..3276) is the authority.
// The value renders as the BOXED display between the two ghost buttons. Zoom is engine-owned facade state (`Editor.setZoom` /
// `snapshot().zoom`); its middle is the "100% ▾" — a caret button opening the
// preset-level menu — flanked by − / + that walk the same levels.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  commandForSlotValue,
  FONT_SIZE_PRESETS_PT,
  listenForOutsidePress,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps, ToolbarSlotPartComponent } from './parts';
import { AUTO_ZOOM_MODE, FIT_WIDTH_ZOOM_MODE, sameZoomMode } from '@docx-editor.dev/core/editor';
import { useZoom } from '../useZoom';
import { usePlatformShortcut } from '../usePlatformShortcut';

/** Engine bounds for `w:sz`: integer half-points, 2..3276 (docx-editor-support). */
const MIN_HALF_POINTS = 2;
const MAX_HALF_POINTS = 3276;

const selectFontSizePt = (snapshot: EditorSnapshot) => snapshot.formatting?.fontSizePt ?? null;

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
  /** Tooltips for the − and + buttons, such as a label that names the shortcut. */
  readonly decreaseTitle?: string;
  readonly increaseTitle?: string;
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
        {...(props.decreaseTitle !== undefined ? { title: props.decreaseTitle } : {})}
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
        {...(props.increaseTitle !== undefined ? { title: props.increaseTitle } : {})}
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
  const shortcut = usePlatformShortcut();
  const [open, setOpen] = useState(false);
  /** The text being typed, or null when the box is showing the document's own value. */
  const [draft, setDraft] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  usePickerKeyboard(rootRef, open, () => setOpen(false));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

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

  /** One ladder step. The engine steps each run from its own size, so mixed sizes step too. */
  const step = useCallback(
    (direction: 'increase' | 'decrease') => {
      if (!editor) return;
      const command = {
        type: direction === 'increase' ? 'increaseFontSize' : 'decreaseFontSize',
      } as const;
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  /** Leave the box: drop the draft, close the list, hand the caret back to the document. */
  const dismiss = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      setDraft(null);
      inputRef.current?.blur();
      if (refocus) editor?.focus();
    },
    [editor]
  );

  // Capture pointer presses before the surface cancels compatibility mouse events.
  useEffect(() => {
    if (!open) return undefined;
    return listenForOutsidePress({
      popup: rootRef.current,
      close: () => {
        setOpen(false);
        setDraft(null);
      },
    });
  }, [open]);

  if (hidden) return null;
  // A mixed selection (`sizePt === null`) still steps: each run moves from its own size.
  const halfPoints = sizePt === null ? null : Math.round(sizePt * 2);
  const canDecrease = isEnabled && (halfPoints === null || halfPoints > MIN_HALF_POINTS);
  const canIncrease = isEnabled && (halfPoints === null || halfPoints < MAX_HALF_POINTS);
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
        decreaseTitle={shortcut(label('fontSize.decreaseShortcut'))}
        increaseTitle={shortcut(label('fontSize.increaseShortcut'))}
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
            aria-controls={open ? listId : undefined}
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
                step(event.key === 'ArrowDown' ? 'decrease' : 'increase');
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
        canDecrease={canDecrease}
        canIncrease={canIncrease}
        onDecrease={() => step('decrease')}
        onIncrease={() => step('increase')}
      />
      {open && isEnabled ? (
        <div
          className="docx-toolbar__menu docx-toolbar__font-size-menu"
          role="listbox"
          tabIndex={0}
          aria-label={label('fontSize.listLabel')}
          id={listId}
        >
          {FONT_SIZE_PRESETS_PT.map((preset) => {
            const selected = selectedPreset === preset;
            return (
              <button
                key={preset}
                type="button"
                role="option"
                tabIndex={-1}
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

/** The font-size stepper part (`DocxEditorToolbar.FontSize`): wired to `font.size`. */
export const ToolbarFontSize: ToolbarSlotPartComponent = Object.assign(ToolbarFontSizeImpl, {
  docxSlot: 'font.size' as const,
});

function ToolbarZoomImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const { zoom, isFit, mode, setZoom, setMode, zoomIn, zoomOut, canZoomIn, canZoomOut, levels } =
    useZoom();
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  usePickerKeyboard(rootRef, open, () => setOpen(false));

  // Outside pointer presses close the level menu, as in FontFamily.Content.
  useEffect(() => {
    if (!open) return undefined;
    return listenForOutsidePress({
      popup: rootRef.current,
      close: () => setOpen(false),
    });
  }, [open]);

  const apply = useCallback(
    (level: number) => {
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      setOpen(false);
      setZoom(level);
    },
    [setZoom]
  );
  const applyMode = useCallback(
    (next: 'auto' | 'fit-width') => {
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      setOpen(false);
      setMode(next === 'auto' ? 'auto' : FIT_WIDTH_ZOOM_MODE);
    },
    [setMode]
  );

  if (hidden) return null;
  const display = `${Math.round(zoom * 100)}%`;
  // Which fit, not just "a fit": `Automatic` is the capped one, `Fit width` the uncapped, and
  // ticking both would tell the reader the editor is in two modes at once.
  //
  // NEITHER, for a fit with a cap this menu cannot offer. A host may pass any bounds, and
  // treating "not Automatic" as "Fit width" ticked a row that, when clicked, silently replaced
  // the host's cap with none — the tick never moved, so the reader had no way to see that the
  // mode had changed under them. An unrepresentable mode shows the percentage and no tick.
  const autoSelected = sameZoomMode(mode, AUTO_ZOOM_MODE);
  const fitWidthSelected = sameZoomMode(mode, FIT_WIDTH_ZOOM_MODE);
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
            aria-label={`${label('zoom.zoomLevel')}: ${display}`}
            onMouseDown={guardToolbarMousedown}
            onClick={() => setOpen((current) => !current)}
          >
            {display}
            <span className="docx-toolbar__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        }
        canDecrease={canZoomOut}
        canIncrease={canZoomIn}
        onDecrease={zoomOut}
        onIncrease={zoomIn}
      />
      {open ? (
        <div
          className="docx-toolbar__menu docx-toolbar__zoom-menu"
          role="listbox"
          tabIndex={0}
          aria-label={label('zoom.zoomLevel')}
        >
          {/* The fits come FIRST and are ticked from the mode, not the percentage. Ticking
              the level that matches the resolved scale would light up "100%" while the
              editor was tracking the viewport and about to move off it. */}
          <button
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={autoSelected}
            {...(autoSelected ? { 'data-selected': '' } : {})}
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() => applyMode('auto')}
          >
            {label('zoom.automatic')}
          </button>
          <button
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={fitWidthSelected}
            {...(fitWidthSelected ? { 'data-selected': '' } : {})}
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() => applyMode('fit-width')}
          >
            {label('zoom.fitWidth')}
          </button>
          <hr className="docx-toolbar__menu-separator" role="presentation" />
          {levels.map((level) => {
            const selected = !isFit && Math.abs(level - zoom) < 0.001;
            return (
              <button
                key={level}
                type="button"
                role="option"
                tabIndex={-1}
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
