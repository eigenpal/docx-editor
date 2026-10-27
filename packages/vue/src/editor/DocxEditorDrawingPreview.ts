import {
  computed,
  defineComponent,
  h,
  shallowRef,
  toValue,
  watch,
  type PropType,
  type Ref,
  type SlotsType,
  type VNodeChild,
} from 'vue';
import {
  drawingNeedsPreview,
  drawingPreviewController,
  type DrawingPreviewController,
  type DrawingPreviewRender,
  type DrawingPreviewState,
  type DrawingPreviewView,
  type UnsupportedElement,
  type UnsupportedElementHost,
} from '@docx-editor.dev/core/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';
import { useDocxEditor } from './context';
import { useUnsupportedElementDeclaration } from './unsupported-element-declaration';
import { UnsupportedElementPlaceholder } from './UnsupportedElements';

/** The preview state of one occurrence, with a retry action. @public */
export interface UseDrawingPreviewReturn {
  /** `idle`, `loading`, `ready`, `unavailable`, or `error`. */
  readonly status: Readonly<Ref<DrawingPreviewState['status']>>;
  /** The image URL, or the previous image while a changed drawing loads. */
  readonly url: Readonly<Ref<string | null>>;
  /** Why the last request failed, when `status` is `error`. */
  readonly error: Readonly<Ref<unknown>>;
  /** Request the preview again after `error` or `unavailable`. */
  retry(): void;
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
}

const IDLE: DrawingPreviewState = Object.freeze({ status: 'idle', url: null, error: null });

/**
 * Request and cache a preview image of a drawing from your rendering service. `render`
 * receives a small DOCX with only this drawing. Previews are cached per editor and keyed by
 * the drawing's source, so typing elsewhere reuses them, and an edited drawing keeps its
 * previous image until the new one is ready. `DocxEditorDrawingPreview` uses it for you.
 *
 * @public
 */
export function useDrawingPreview(
  element: MaybeRefOrGetter<UnsupportedElement>,
  render: DrawingPreviewRender
): UseDrawingPreviewReturn {
  const editor = useDocxEditor();
  const state = shallowRef<DrawingPreviewState>(IDLE);
  let controller: DrawingPreviewController | null = null;
  const read = () => {
    const current = toValue(element);
    const next = controller?.state(current) ?? IDLE;
    state.value = next;
    if (next.status === 'idle') controller?.request(current, render);
  };
  watch(
    [editor, () => toValue(element)],
    ([currentEditor], _old, onCleanup) => {
      controller = currentEditor ? drawingPreviewController(currentEditor) : null;
      if (!controller) {
        state.value = IDLE;
        return;
      }
      onCleanup(controller.subscribe(read));
      read();
    },
    { immediate: true }
  );
  return {
    status: computed(() => state.value.status),
    url: computed(() => state.value.url),
    error: computed(() => state.value.error),
    retry: () => controller?.retry(toValue(element), render),
  };
}

const DrawingPreviewOccurrence = defineComponent({
  props: {
    host: { type: Object as PropType<UnsupportedElementHost>, required: true },
    renderPreview: { type: Function as PropType<DrawingPreviewRender>, required: true },
    content: {
      type: Function as PropType<
        | ((props: { element: UnsupportedElement; preview: DrawingPreviewView }) => VNodeChild)
        | undefined
      >,
      default: undefined,
    },
  },
  setup(props) {
    const preview = useDrawingPreview(
      () => props.host.unsupported,
      (request) => props.renderPreview(request)
    );
    return () => {
      const element = props.host.unsupported;
      const url = preview.url.value;
      const label = element.drawing?.accessibility.label ?? element.label;
      return h(UnsupportedElementPlaceholder, {
        host: props.host,
        // Empty content keeps the editor's own drawing, so the default waits for an image.
        render: () => {
          if (props.content) {
            return props.content({
              element,
              preview: {
                status: preview.status.value,
                url,
                error: preview.error.value,
                retry: preview.retry,
              },
            });
          }
          return url === null
            ? null
            : h('img', {
                src: url,
                alt: label,
                draggable: false,
                style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
              });
        },
      });
    };
  },
});

/**
 * Replace drawings with images from your rendering service. By default it previews only the
 * drawings that the editor does not show in full, and keeps native drawings. The editor's own
 * drawing stays visible until the image is ready, and again if the request fails. Users can
 * still select, move, resize, and delete a previewed drawing. Previews change only the
 * editor display: saved DOCX files and PDF exports keep the original drawing.
 *
 * Use the default slot, which receives `element` and `preview`, to draw the preview yourself
 * for any `preview.status`. Empty slot content keeps the editor's drawing.
 *
 * @public
 */
export const DocxEditorDrawingPreview = defineComponent({
  name: 'DocxEditorDrawingPreview',
  props: {
    /** Your rendering service call. Resolve with an image `Blob`, an image URL, or `null`. */
    render: { type: Function as PropType<DrawingPreviewRender>, required: true },
    /** Which drawings to preview. Defaults to `drawingNeedsPreview`. Receives drawings only. */
    match: {
      type: Function as PropType<(element: UnsupportedElement) => boolean>,
      default: undefined,
    },
  },
  slots: Object as SlotsType<{
    default: (props: { element: UnsupportedElement; preview: DrawingPreviewView }) => VNodeChild;
  }>,
  setup(props, { slots }) {
    // The registry evaluates the match while it lists occurrences, so read the prop live.
    const match = (element: UnsupportedElement) =>
      element.drawing !== undefined && (props.match ?? drawingNeedsPreview)(element);
    const hosts = useUnsupportedElementDeclaration(
      () => ({ includeRenderedDrawings: true, match }),
      'DocxEditor.DrawingPreview'
    );
    return () => {
      return hosts().map((host) =>
        h(DrawingPreviewOccurrence, {
          key: host.key,
          host,
          renderPreview: props.render,
          content: slots.default,
        })
      );
    };
  },
});
