// The stepper parts: font size and zoom as minus / value / plus clusters.
//
// Both are WIRED, not lookalikes. Font size is a value-typed slot: the current value
// comes off the snapshot's selection formatting (`fontSizePt`), and a step dispatches
// `commandForSlotValue('font.size', halfPoints)` through the can-before-exec gate —
// the engine's own `setMarkAttr` validation (integer half-points, 2..3276) is the
// authority, this component only clamps the step so a click can never build an
// out-of-range command. Zoom is engine-owned facade state (`Editor.setZoom` /
// `snapshot().zoom`), stepped in 10% increments within the sane UI range.

import { useCallback } from 'react';
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

/** UI zoom bounds — inside the facade's accepted 0.1..5, per the chrome spec. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

const selectFontSizePt = (snapshot: EditorSnapshot) => snapshot.formatting?.fontSizePt ?? null;
const selectZoom = (snapshot: EditorSnapshot) => snapshot.zoom;

interface StepperShellProps {
  readonly slot: string;
  readonly groupLabel: string;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  readonly value: string;
  readonly canDecrease: boolean;
  readonly canIncrease: boolean;
  readonly onDecrease: () => void;
  readonly onIncrease: () => void;
  readonly title?: string;
  readonly className?: string;
}

/** The shared minus / value / plus cluster. */
function StepperShell(props: StepperShellProps) {
  return (
    <span
      className={`docx-toolbar__stepper${props.className ? ` ${props.className}` : ''}`}
      data-slot={props.slot}
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
      <span className="docx-toolbar__stepper-value">{props.value}</span>
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
    (halfPoints: number) => {
      if (!editor) return;
      const clamped = Math.min(
        MAX_HALF_POINTS,
        Math.max(MIN_HALF_POINTS, Math.round(halfPoints))
      );
      const command = commandForSlotValue('font.size', clamped);
      if (!command) return;
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  if (hidden) return null;
  // Whole points step by 2 half-points; a half-point size (11.5pt) steps to the next
  // whole point rather than accumulating fractions.
  const currentHalf = sizePt === null ? null : Math.round(sizePt * 2);
  const canStep = isEnabled && currentHalf !== null;
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
      value={display}
      canDecrease={canStep && currentHalf! > MIN_HALF_POINTS}
      canIncrease={canStep && currentHalf! < MAX_HALF_POINTS}
      onDecrease={() => apply((currentHalf ?? 0) - 2)}
      onIncrease={() => apply((currentHalf ?? 0) + 2)}
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

  const apply = useCallback(
    (next: number) => {
      if (!editor) return;
      // Rounded to the step grid so repeated float steps cannot drift (0.30000000004).
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 10));
      editor.setZoom(clamped);
    },
    [editor]
  );

  if (hidden) return null;
  return (
    <StepperShell
      slot="zoom.level"
      className={className}
      groupLabel={label('zoom.zoomLevel')}
      decreaseLabel={label('zoom.zoomOut')}
      increaseLabel={label('zoom.zoomIn')}
      value={`${Math.round(zoom * 100)}%`}
      canDecrease={!!editor && zoom > MIN_ZOOM}
      canIncrease={!!editor && zoom < MAX_ZOOM}
      onDecrease={() => apply(zoom - ZOOM_STEP)}
      onIncrease={() => apply(zoom + ZOOM_STEP)}
    />
  );
}

/** The zoom stepper part (`DocxEditorToolbar.Zoom`): wired to `Editor.setZoom`. */
export const ToolbarZoom: ToolbarSlotPartComponent = Object.assign(ToolbarZoomImpl, {
  docxSlot: 'zoom.level' as const,
});
