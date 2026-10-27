import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  drawingNeedsPreview,
  drawingPreviewController,
  type DrawingPreviewRender,
  type DrawingPreviewState,
  type UnsupportedElement,
  type UnsupportedElementHost,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useUnsupportedElementDeclaration } from './unsupported-element-declaration';
import { UnsupportedElementPlaceholder } from './UnsupportedElements';

/** The preview state of one occurrence, with a retry action. @public */
export interface UseDrawingPreviewReturn {
  /** `idle`, `loading`, `ready`, `unavailable`, or `error`. */
  readonly status: DrawingPreviewState['status'];
  /** The image URL, or the previous image while a changed drawing loads. */
  readonly url: string | null;
  /** Why the last request failed, when `status` is `error`. */
  readonly error: unknown;
  /** Request the preview again after `error` or `unavailable`. */
  retry(): void;
}

const IDLE: DrawingPreviewState = Object.freeze({ status: 'idle', url: null, error: null });
const noSubscription = () => () => {};

/**
 * Request and cache a preview image of a drawing from your rendering service. `render`
 * receives a small DOCX with only this drawing. Previews are cached per editor and keyed by
 * the drawing's source, so typing elsewhere reuses them, and an edited drawing keeps its
 * previous image until the new one is ready. Use it inside your own
 * `DocxEditor.UnsupportedElement` child component; `DocxEditor.DrawingPreview` uses it for you.
 *
 * @example
 * ```tsx
 * function Preview({ element }: { element: UnsupportedElement }) {
 *   const preview = useDrawingPreview(element, renderOnServer);
 *   if (preview.status === 'error') return <button onClick={preview.retry}>Retry</button>;
 *   return preview.url ? <img src={preview.url} alt="" /> : <span>Loading</span>;
 * }
 * ```
 *
 * @public
 */
export function useDrawingPreview(
  element: UnsupportedElement,
  render: DrawingPreviewRender
): UseDrawingPreviewReturn {
  const editor = useDocxEditor();
  const controller = editor ? drawingPreviewController(editor) : null;
  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
  });
  const latestRender = useCallback<DrawingPreviewRender>(
    (request) => renderRef.current(request),
    []
  );
  const subscribe = useMemo(
    () => (controller ? (listener: () => void) => controller.subscribe(listener) : noSubscription),
    [controller]
  );
  const state = useSyncExternalStore(
    subscribe,
    () => controller?.state(element) ?? IDLE,
    () => IDLE
  );
  useEffect(() => {
    if (state.status === 'idle') controller?.request(element, latestRender);
  }, [controller, element, state.status, latestRender]);
  const retry = useCallback(
    () => controller?.retry(element, latestRender),
    [controller, element, latestRender]
  );
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

/** Props for {@link DocxEditorDrawingPreview}. @public */
export interface DocxEditorDrawingPreviewProps {
  /** Your rendering service call. Resolve with an image `Blob`, an image URL, or `null`. */
  render: DrawingPreviewRender;
  /**
   * Which drawings to preview. The default, `drawingNeedsPreview`, previews placeholders,
   * saved fallbacks, and drawings with unsupported features, and keeps native drawings.
   * The function receives drawings only.
   */
  match?: (element: UnsupportedElement) => boolean;
  /** Draw the ready image yourself. The default is an `img` that fills the drawing's box. */
  children?: (props: { element: UnsupportedElement; url: string }) => ReactNode;
}

function DrawingPreviewOccurrence({
  host,
  render,
  children,
}: {
  host: UnsupportedElementHost;
  render: DrawingPreviewRender;
  children: DocxEditorDrawingPreviewProps['children'];
}) {
  const element = host.unsupported;
  const preview = useDrawingPreview(element, render);
  const label = element.drawing?.accessibility.label ?? element.label;
  // Until an image is ready, render nothing so the editor keeps its own drawing.
  const content =
    preview.url === null ? null : children ? (
      children({ element, url: preview.url })
    ) : (
      <img
        src={preview.url}
        alt={label}
        draggable={false}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    );
  return <UnsupportedElementPlaceholder host={host}>{content}</UnsupportedElementPlaceholder>;
}

/**
 * Replace drawings with images from your rendering service. By default it previews only the
 * drawings that the editor does not show in full, and keeps native drawings. The editor's own
 * drawing stays visible until the image is ready, and again if the request fails. Users can
 * still select, move, resize, and delete a previewed drawing. Previews change only the
 * editor display: saved DOCX files and PDF exports keep the original drawing.
 *
 * @example
 * ```tsx
 * <DocxEditor document={bytes}>
 *   <DocxEditor.DrawingPreview
 *     render={async ({ docx, signal }) => {
 *       const response = await fetch('/render-drawing', { method: 'POST', body: docx, signal });
 *       return response.ok ? await response.blob() : null;
 *     }}
 *   />
 * </DocxEditor>
 * ```
 *
 * @public
 */
export function DocxEditorDrawingPreview({
  render,
  match = drawingNeedsPreview,
  children,
}: DocxEditorDrawingPreviewProps) {
  // Read during render: the registry evaluates the match while it lists occurrences.
  const matchRef = useRef(match);
  matchRef.current = match;
  const drawingsOnly = useCallback(
    (element: UnsupportedElement) => element.drawing !== undefined && matchRef.current(element),
    []
  );
  const hosts = useUnsupportedElementDeclaration(
    { includeRenderedDrawings: true, match: drawingsOnly },
    'DocxEditor.DrawingPreview'
  );
  return hosts.map((host) => (
    <DrawingPreviewOccurrence key={host.key} host={host} render={render}>
      {children}
    </DrawingPreviewOccurrence>
  ));
}
