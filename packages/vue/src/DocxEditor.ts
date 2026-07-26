import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import type {
  Editor,
  EditorHost,
  DocumentSource,
  DocumentChange,
} from '@docx-editor.dev/core-contract/editor';
import type { InteractionIntent } from '@docx-editor.dev/core-contract/interaction';
import {
  attachAdapterEventBridge,
  createEditor,
  firstEditableGlyphTarget,
  measureInteractionHostMetrics,
  overlaysForFrame,
  type FrameOverlays,
  type GlyphClickTarget,
} from '@docx-editor.dev/engine-editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { paintDisplay } from './paintDisplay';
import type { EditorMode } from './types';

/**
 * Vue host for the DOCX editor. It supplies an `EditorHost`, constructs the
 * `Editor` through `createEditor`, and paints the positioned `DisplayPage[]`
 * the engine emits. All editing, querying, and geometry go through the facade.
 *
 * Direct editing (interactive-paginated-editing 6.3): the Vue counterpart of the
 * React host. Real pointer and keyboard events on the painted pages go to the
 * shared interaction controller through `attachAdapterEventBridge`, so the two
 * adapters cannot drift on click counting, modifier policy, or key ownership.
 * The adapter measures nothing and derives no geometry.
 */
export default defineComponent({
  name: 'DocxEditor',
  props: {
    document: {
      type: [ArrayBuffer, Uint8Array, Object] as unknown as PropType<DocumentSource>,
      default: undefined,
    },
    mode: { type: String as PropType<EditorMode>, default: 'edit' },
    zoom: { type: Number, default: undefined },
    locale: { type: String, default: undefined },
    author: { type: String, default: undefined },
  },
  emits: {
    ready: (_editor: Editor) => true,
    change: (_change: DocumentChange) => true,
  },
  setup(props, { emit, expose }) {
    const bodyEl = ref<HTMLDivElement | null>(null);
    const pagesEl = ref<HTMLDivElement | null>(null);
    const scrollEl = ref<HTMLDivElement | null>(null);
    const pages = ref<readonly DisplayPage[]>([]);
    const overlays = ref<FrameOverlays>({ caret: null, selection: [] });
    const clickTarget = ref<GlyphClickTarget | null>(null);
    let editor: Editor | null = null;
    let detachBridge: (() => void) | null = null;

    // Re-read the published frame and repaint the overlay layer, after every
    // display and selection change, so the caret cannot lag the model.
    const syncFromFrame = (): void => {
      if (!editor) return;
      const frame = editor.getInteractionFrame();
      overlays.value = overlaysForFrame(frame);
      clickTarget.value = firstEditableGlyphTarget(frame);
    };

    const host: EditorHost = {
      getBodyHostEl: () => bodyEl.value,
      getHfHostEl: () => null,
      getPagesContainer: () => pagesEl.value,
      getScrollContainer: () => scrollEl.value,
      // Measured from the PAGES stack, not the scroll container: the engine
      // publishes page boxes from content (0, 0), so the client origin it needs
      // is the origin of that stack. Measuring the viewport instead shifts every
      // hit test by the centering offset.
      getInteractionHostMetrics: () => {
        const stack = pagesEl.value;
        if (!stack) return null;
        return measureInteractionHostMetrics(stack, props.zoom ?? 1);
      },
      scheduleFrame: (cb) => {
        const id = requestAnimationFrame(cb);
        return () => cancelAnimationFrame(id);
      },
      onDisplay: (next) => {
        pages.value = next;
      },
    };

    onMounted(() => {
      editor = createEditor({
        host,
        document: props.document,
        zoom: props.zoom,
        locale: props.locale,
        author: props.author,
        mode: props.mode,
      });
      emit('ready', editor);
      editor.on('change', (change) => {
        emit('change', change);
        syncFromFrame();
      });
      editor.on('selectionChange', () => syncFromFrame());
      editor.on('display', () => syncFromFrame());
      syncFromFrame();

      const surface = scrollEl.value;
      if (surface) {
        detachBridge = attachAdapterEventBridge(surface, {
          getInteractionFrameId: () => editor?.getInteractionFrame().id ?? null,
          dispatchInteraction: (intent: InteractionIntent) => {
            const result = editor!.dispatchInteraction(intent);
            syncFromFrame();
            return result;
          },
        });
      }
    });

    // Reload on document change (does not fire on initial value — createEditor
    // already loaded it), mirroring the React adapter.
    watch(
      () => props.document,
      (doc) => {
        if (doc) editor?.load(doc);
      }
    );

    watch(
      () => props.zoom,
      () => {
        editor?.relayout();
      }
    );

    onBeforeUnmount(() => {
      detachBridge?.();
      detachBridge = null;
      editor?.destroy();
      editor = null;
    });

    expose({
      load: (...args: Parameters<Editor['load']>) => editor!.load(...args),
      save: () => editor!.save(),
      focus: (...args: Parameters<Editor['focus']>) => editor!.focus(...args),
      exec: (...args: Parameters<Editor['exec']>) => editor!.exec(...args),
      snapshot: (...args: Parameters<Editor['snapshot']>) => editor!.snapshot(...args),
      getDocumentHandle: () => editor!.getDocumentHandle(),
      getEditor: () => editor,
    });

    return () =>
      h(
        'div',
        {
          ref: scrollEl,
          'data-testid': 'docx-editor-scroll',
          // `ep-root` is the library's style scope: every --doc-* token is
          // declared under it, so without it the caret, selection, and page
          // background all paint transparent.
          class: 'ep-root ep-one-surface ep-one-surface__viewport',
        },
        [
          // Zoom scales the whole page stack from its top-left; the same factor
          // is reported through host metrics so paint and hit testing agree.
          h(
            'div',
            {
              ref: pagesEl,
              class: 'ep-one-surface__pages',
              style: { transform: `scale(${props.zoom ?? 1})`, transformOrigin: 'top left' },
            },
            paintDisplay(pages.value, overlays.value, clickTarget.value)
          ),
          h('div', {
            ref: bodyEl,
            class: 'ep-one-surface__input-host',
            style: {
              position: 'fixed',
              width: '0',
              height: '0',
              overflow: 'visible',
              pointerEvents: 'none',
            },
          }),
        ]
      );
  },
});
