// The Format shape control of the chrome (`image.formatShape`) and the pane request it sends.
// The toolbar and the context menu show it for a selected shape, text box, line, or group while
// the host can show a side panel; it opens the Format shape pane with the focus. A double press
// on a text box still edits its text, so the pane opens from these two places only.
//
// The side panel shows one pane at a time: the Chart pane for a selected chart, the Format shape
// pane for a selected shape, else the pane that was asked for last (`sidePanelPane`).

import type { Editor, EditorSnapshot, ExecResult } from '../contracts/editor.ts';
import type { ChromeSlotId } from './chrome-controls.ts';
import type { ToolbarCommandState } from './toolbar-commands.ts';
import { chartPaneAvailable, requestPane, type EditorPaneId } from './chart-chrome.ts';
import { SHAPE_NONE_REASON } from './selected-shape.ts';

/**
 * Whether the host can show the Format shape pane: a mounted side panel, or a `usePaneRequest`
 * listener. Without one, Format shape has nowhere to go, so the toolbar and the context menu
 * leave it out. @public
 */
export const shapePaneAvailable = (editor: Editor | null): boolean => chartPaneAvailable(editor);

/** The enabled state of `image.formatShape`, or null for another slot. */
export function shapeChromeState(editor: Editor, id: ChromeSlotId): ToolbarCommandState | null {
  if (id !== 'image.formatShape') return null;
  return editor.snapshot().image?.shapeFormat
    ? { id, enabled: true, disabledReason: null, active: false }
    : { id, enabled: false, disabledReason: SHAPE_NONE_REASON, active: false };
}

/**
 * Ask for the Format shape pane with the focus, for the selected shape. Returns false, and asks
 * for nothing, when no shape with a fill or outline is selected, or when `drawingNodeId` names
 * another drawing. @public
 */
export function openShapePane(editor: Editor, drawingNodeId?: string): boolean {
  const image = editor.snapshot().image;
  if (!image?.shapeFormat) return false;
  if (drawingNodeId !== undefined && image.id !== drawingNodeId) return false;
  requestPane(editor, 'shape', { focus: true });
  return true;
}

/** Run `image.formatShape`: open the Format shape pane with the focus. Null for another slot. */
export function runShapeControl(editor: Editor, id: ChromeSlotId): ExecResult | null {
  if (id !== 'image.formatShape') return null;
  return openShapePane(editor)
    ? { ok: true, changed: false }
    : { ok: false, code: 'notFound', reason: SHAPE_NONE_REASON };
}

/**
 * The pane a side panel shows: the Chart pane while a chart is selected, the Format shape pane
 * while a shape with a fill or outline is selected, else `requested`, the pane that was asked for
 * last. @public
 */
export function sidePanelPane(
  snapshot: Pick<EditorSnapshot, 'chart' | 'image'>,
  requested: EditorPaneId
): EditorPaneId {
  return selectionPane(snapshot) ?? requested;
}

/**
 * The pane that the selection picks: the Chart pane for a chart, the Format shape pane for a
 * shape with a fill or outline, or null for any other selection. @public
 */
export function selectionPane(
  snapshot: Pick<EditorSnapshot, 'chart' | 'image'>
): EditorPaneId | null {
  if (snapshot.chart) return 'chart';
  return snapshot.image?.shapeFormat ? 'shape' : null;
}

/** The i18n key of a pane's title. @public */
export const paneTitleKey = (pane: EditorPaneId): 'chart.pane.title' | 'shape.pane.title' =>
  pane === 'shape' ? 'shape.pane.title' : 'chart.pane.title';
