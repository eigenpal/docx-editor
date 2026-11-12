// `useSelectedShape`: the selected shape for a host's own Format shape controls. The reads and
// the commands come from core (`selected-shape.ts`), so the Vue composable returns the same
// thing (`packages/vue/src/editor/shapes/useSelectedShape.ts`).

import { useMemo } from 'react';
import {
  editSelectedShape,
  execSelectedShape,
  readSelectedShape,
  type SelectedShapeCommand,
  type ShapeFormatState,
  type ShapePaneChange,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** What `useSelectedShape` returns. @public */
export interface UseSelectedShapeReturn {
  /** The drawing node id of the selected shape, text box, line, or group, or null. */
  readonly drawingNodeId: string | null;
  /** The fill and outline, or null when no shape with a fill or outline is selected. */
  readonly format: ShapeFormatState | null;
  /** Whether `setShapeFill` can run now. */
  readonly canEditFill: boolean;
  /** Whether the transparency of a solid fill can change now. */
  readonly canEditTransparency: boolean;
  /** Whether `setShapeOutline` can run now. */
  readonly canEditOutline: boolean;
  /** Why the fill cannot change, translated, or null when it can. */
  readonly fillDisabledReason: string | null;
  /** Why the transparency cannot change, translated, or null when it can. */
  readonly transparencyDisabledReason: string | null;
  /** Why the outline cannot change, translated, or null when it can. */
  readonly outlineDisabledReason: string | null;
  /**
   * Run a fill or outline edit on the shape this hook shows, as `editor.exec` does, without the
   * `drawingNodeId`: `execute({ type: 'setShapeOutline', color: '0070C0', widthPt: 3 })`.
   */
  readonly execute: (command: SelectedShapeCommand) => ExecResult;
  /**
   * Apply one checked change, as the packaged pane does: `edit({ type: 'fillColor',
   * color: 'accent1' })` or `edit({ type: 'outlineWidth', text: '3' })`. A theme color resolves
   * through the document's theme. Text the pane cannot read refuses, with the reason as a
   * translation key. One undo step.
   */
  readonly edit: (change: ShapePaneChange) => ExecResult;
}

const selectImage = (snapshot: EditorSnapshot) => snapshot.image;
const selectEditable = (snapshot: EditorSnapshot) => snapshot.editable;
const selectMode = (snapshot: EditorSnapshot) => snapshot.editingMode;

/**
 * The selected shape, its fill and outline, whether each can change, and `execute` for the
 * shape commands. Use it inside `DocxEditor.Root` to build a Format shape pane of your own. The
 * value changes only when the selected drawing or the editing mode changes. @public
 */
export function useSelectedShape(): UseSelectedShapeReturn {
  const editor = useDocxEditor();
  const image = useEditorState(selectImage);
  const editable = useEditorState(selectEditable);
  const editingMode = useEditorState(selectMode);
  const { t } = useTranslation();
  return useMemo(() => {
    // The editing mode is a dependency: the enabled state is the engine's `can` answer.
    void editable;
    void editingMode;
    const view = readSelectedShape(editor, image);
    return {
      ...view,
      fillDisabledReason: localizeDisabledReason(view.fillDisabledReason, t),
      transparencyDisabledReason: localizeDisabledReason(view.transparencyDisabledReason, t),
      outlineDisabledReason: localizeDisabledReason(view.outlineDisabledReason, t),
      execute: (command: SelectedShapeCommand) => execSelectedShape(editor, image, command),
      edit: (change: ShapePaneChange) => editSelectedShape(editor, image, change),
    };
  }, [editor, image, editable, editingMode, t]);
}
