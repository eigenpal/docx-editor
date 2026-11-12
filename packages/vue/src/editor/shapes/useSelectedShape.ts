// `useSelectedShape`: the selected shape for a host's own Format shape controls, the Vue twin of
// the React hook (`packages/react/src/editor/shapes/useSelectedShape.ts`). The reads and the
// commands come from core (`selected-shape.ts`).

import { computed, type ComputedRef } from 'vue';
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
  readonly drawingNodeId: ComputedRef<string | null>;
  /** The fill and outline, or null when no shape with a fill or outline is selected. */
  readonly format: ComputedRef<ShapeFormatState | null>;
  /** Whether `setShapeFill` can run now. */
  readonly canEditFill: ComputedRef<boolean>;
  /** Whether the transparency of a solid fill can change now. */
  readonly canEditTransparency: ComputedRef<boolean>;
  /** Whether `setShapeOutline` can run now. */
  readonly canEditOutline: ComputedRef<boolean>;
  /** Why the fill cannot change, translated, or null when it can. */
  readonly fillDisabledReason: ComputedRef<string | null>;
  /** Why the transparency cannot change, translated, or null when it can. */
  readonly transparencyDisabledReason: ComputedRef<string | null>;
  /** Why the outline cannot change, translated, or null when it can. */
  readonly outlineDisabledReason: ComputedRef<string | null>;
  /**
   * Run a fill or outline edit on the shape this composable shows, as `editor.exec` does,
   * without the `drawingNodeId`: `execute({ type: 'setShapeOutline', color: '0070C0',
   * widthPt: 3 })`.
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
 * shape commands. Use it inside `DocxEditor.Root` to build a Format shape pane of your own.
 * @public
 */
export function useSelectedShape(): UseSelectedShapeReturn {
  const editorRef = useDocxEditor();
  const { t } = useTranslation();
  const image = useEditorState(selectImage);
  const editable = useEditorState(selectEditable);
  const editingMode = useEditorState(selectMode);
  const view = computed(() => {
    // The editing mode is a dependency: the enabled state is the engine's `can` answer.
    void editable.value;
    void editingMode.value;
    return readSelectedShape(editorRef.value, image.value);
  });
  return {
    drawingNodeId: computed(() => view.value.drawingNodeId),
    format: computed(() => view.value.format),
    canEditFill: computed(() => view.value.canEditFill),
    canEditTransparency: computed(() => view.value.canEditTransparency),
    canEditOutline: computed(() => view.value.canEditOutline),
    fillDisabledReason: computed(() => localizeDisabledReason(view.value.fillDisabledReason, t)),
    transparencyDisabledReason: computed(() =>
      localizeDisabledReason(view.value.transparencyDisabledReason, t)
    ),
    outlineDisabledReason: computed(() =>
      localizeDisabledReason(view.value.outlineDisabledReason, t)
    ),
    execute: (command) => execSelectedShape(editorRef.value, image.value, command),
    edit: (change) => editSelectedShape(editorRef.value, image.value, change),
  };
}
