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
import { commandForSlotValue } from '@docx-editor.dev/core-contract/editor';
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

function ToolbarFontSizeImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const sizePt = useEditorState(selectFontSizePt);
  const { isEnabled, disabledReason } = useEditorCommand('font.size');
  const label = useToolbarLabel();

  const apply = useCallback(
    (points: number) => {
      if (!editor) return;
      const halfPoints = Math.min(
        MAX_HALF_POINTS,
        Math.max(MIN_HALF_POINTS, Math.round(points * 2))
      );
      const command = commandForSlotValue('font.size', halfPoints);
      if (!command) return;
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  if (hidden) return null;
  const canStep = isEnabled && sizePt !== null;
  // No agreed size (mixed selection / no selection formatting) shows an em-dash,
  // matching the FontFamily trigger — never an invented number.
  const display = sizePt === null ? '—' : String(Math.round(sizePt * 2) / 2);
  return (
    <StepperShell
      slot="font.size"
      className={className}
      groupLabel={label('fontSize.label')}
      decreaseLabel={label('fontSize.decrease')}
      increaseLabel={label('fontSize.increase')}
      middle={
        // The boxed value between the ghost − / + halves.
        <span className="docx-toolbar__stepper-value docx-toolbar__stepper-value--boxed">
          {display}
        </span>
      }
      canDecrease={canStep && Math.round(sizePt! * 2) > MIN_HALF_POINTS}
      canIncrease={canStep && Math.round(sizePt! * 2) < MAX_HALF_POINTS}
      onDecrease={() => apply(prevPreset(sizePt ?? 0, FONT_SIZE_PRESETS_PT, MIN_HALF_POINTS / 2))}
      onIncrease={() => apply(nextPreset(sizePt ?? 0, FONT_SIZE_PRESETS_PT, MAX_HALF_POINTS / 2))}
      title={disabledReason ?? undefined}
    />
  );
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
