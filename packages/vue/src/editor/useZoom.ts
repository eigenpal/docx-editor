import { computed, type ComputedRef } from 'vue';
import type { EditorSnapshot, ZoomMode } from '@docx-editor.dev/core/contracts/editor';
import { FIT_WIDTH_ZOOM_MODE } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { ZOOM_LEVELS, stepZoomLevel } from './zoom-levels';

interface ZoomSlice {
  readonly zoom: number;
  readonly mode: ZoomMode | undefined;
}

const selectZoom = (snapshot: EditorSnapshot): ZoomSlice => ({
  zoom: snapshot.zoom,
  mode: snapshot.zoomMode,
});

const sameZoom = (a: ZoomSlice, b: ZoomSlice) => a.zoom === b.zoom && a.mode === b.mode;

/** @public */
export interface UseZoomResult {
  readonly zoom: ComputedRef<number>;
  readonly mode: ComputedRef<ZoomMode>;
  readonly isFit: ComputedRef<boolean>;
  readonly setZoom: (zoom: number) => void;
  readonly setMode: (mode: ZoomMode | 'auto') => void;
  readonly fitToWidth: () => void;
  readonly auto: () => void;
  readonly reset: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly canZoomIn: ComputedRef<boolean>;
  readonly canZoomOut: ComputedRef<boolean>;
  readonly levels: readonly number[];
}

const FIXED: ZoomMode = { type: 'fixed' };

/** @public */
export function useZoom(): UseZoomResult {
  const editorRef = useDocxEditor();
  const slice = useEditorState(selectZoom, sameZoom);

  const setZoom = (next: number) => void editorRef.value?.setZoom(next);
  const setMode = (next: ZoomMode | 'auto') => void editorRef.value?.setZoomMode(next);

  const resolved = computed(() => slice.value.mode ?? FIXED);
  const previous = computed(() => stepZoomLevel(slice.value.zoom, 'out'));
  const next = computed(() => stepZoomLevel(slice.value.zoom, 'in'));

  return {
    zoom: computed(() => slice.value.zoom),
    mode: resolved,
    isFit: computed(() => resolved.value.type === 'fit'),
    setZoom,
    setMode,
    fitToWidth: () => setMode(FIT_WIDTH_ZOOM_MODE),
    auto: () => setMode('auto'),
    reset: () => {
      setMode(FIXED);
      setZoom(1);
    },
    zoomIn: () => next.value !== null && setZoom(next.value),
    zoomOut: () => previous.value !== null && setZoom(previous.value),
    canZoomIn: computed(() => !!editorRef.value && next.value !== null),
    canZoomOut: computed(() => !!editorRef.value && previous.value !== null),
    levels: ZOOM_LEVELS,
  };
}
