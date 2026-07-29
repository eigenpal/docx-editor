import {
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
} from 'vue';
import type {
  Editor,
  EditorFontError,
  EditorHost,
  DocumentSource,
  DocumentChange,
  FontConfiguration,
} from '@docx-editor.dev/core-contract/contracts/editor';
import type { InteractionIntent } from '@docx-editor.dev/core-contract/contracts/interaction';
import {
  attachAdapterEventBridge,
  createLayoutShaping,
  createEditor,
  disposeLayoutShaping,
  firstEditableGlyphTarget,
  installDisplayFonts,
  measureInteractionHostMetrics,
  overlaysForFrame,
  PaintEpochGate,
  toEditorFontError,
  type BrowserFontSet,
  type FrameOverlays,
  type GlyphClickTarget,
  type InstalledDisplayFonts,
} from '@docx-editor.dev/engine-editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/contracts/geometry';
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
    fonts: {
      type: Object as PropType<FontConfiguration>,
      required: true,
    },
  },
  emits: {
    ready: (_editor: Editor) => true,
    change: (_change: DocumentChange) => true,
    fontError: (_error: EditorFontError) => true,
  },
  setup(props, { emit, expose }) {
    const bodyEl = ref<HTMLDivElement | null>(null);
    const pagesEl = ref<HTMLDivElement | null>(null);
    const scrollEl = ref<HTMLDivElement | null>(null);
    const pendingPages = ref<{
      readonly epoch: number;
      readonly pages: readonly DisplayPage[];
    } | null>(null);
    const pages = ref<readonly DisplayPage[]>([]);
    const installedFonts = ref<InstalledDisplayFonts | null>(null);
    const fontError = ref<EditorFontError | null>(null);
    const overlays = ref<FrameOverlays>({ caret: null, selection: [] });
    const clickTarget = ref<GlyphClickTarget | null>(null);
    let editor: Editor | null = null;
    let detachBridge: (() => void) | null = null;
    let activeFontLease: InstalledDisplayFonts | null = null;
    let shaping: Awaited<ReturnType<typeof createLayoutShaping>> | null = null;
    let readyPublished = false;
    let disposed = false;
    const paintGate = new PaintEpochGate();

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
        paintGate.detach();
        detachBridge?.();
        detachBridge = null;
        pages.value = [];
        installedFonts.value = null;
        pendingPages.value = { epoch: paintGate.beginFrame(), pages: next };
      },
    };

    onMounted(async () => {
      try {
        shaping = await createLayoutShaping(props.fonts);
        if (disposed) {
          disposeLayoutShaping(shaping);
          shaping = null;
          return;
        }
        editor = createEditor({
          host,
          document: props.document,
          zoom: props.zoom,
          locale: props.locale,
          author: props.author,
          mode: props.mode,
          layoutShaping: shaping,
        });
        editor.on('change', (change) => {
          emit('change', change);
          syncFromFrame();
        });
        editor.on('selectionChange', () => syncFromFrame());
        editor.on('display', () => syncFromFrame());
        syncFromFrame();
      } catch (error) {
        if (editor) {
          editor.destroy();
          editor = null;
        }
        if (shaping) {
          disposeLayoutShaping(shaping);
          shaping = null;
        }
        if (disposed) return;
        const typed = toEditorFontError(error);
        fontError.value = typed;
        emit('fontError', typed);
      }
    });

    let fontGeneration = 0;
    watch(
      pendingPages,
      async (next) => {
        if (!next || !shaping) return;
        const generation = ++fontGeneration;
        detachBridge?.();
        detachBridge = null;
        pages.value = [];
        installedFonts.value = null;
        fontError.value = null;
        const ownerDocument = pagesEl.value?.ownerDocument ?? globalThis.document;
        try {
          const lease = await installDisplayFonts(
            next.pages,
            shaping.fonts,
            ownerDocument.fonts as unknown as BrowserFontSet
          );
          if (generation !== fontGeneration) {
            lease.release();
            return;
          }
          activeFontLease?.release();
          activeFontLease = lease;
          installedFonts.value = lease;
          pages.value = next.pages;
          await nextTick();
          if (generation !== fontGeneration || !paintGate.commitPaint(next.epoch)) return;
          const surface = scrollEl.value;
          if (surface) {
            detachBridge = attachAdapterEventBridge(surface, {
              getInteractionFrameId: () => editor?.getInteractionFrame().id ?? null,
              dispatchInteraction: (intent: InteractionIntent) => {
                if (!paintGate.interactionReady) {
                  return {
                    outcome: {
                      ok: false,
                      code: 'staleFrame',
                      reason: 'The matching font-backed display frame has not committed',
                    },
                    hostEffects: [],
                  };
                }
                const result = editor!.dispatchInteraction(intent);
                syncFromFrame();
                return result;
              },
            });
          }
          if (!readyPublished && editor) {
            readyPublished = true;
            emit('ready', editor);
          }
        } catch (error) {
          if (generation !== fontGeneration) return;
          activeFontLease?.release();
          activeFontLease = null;
          installedFonts.value = null;
          const typed = toEditorFontError(error);
          fontError.value = typed;
          emit('fontError', typed);
        }
      },
      { flush: 'sync' }
    );

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
      disposed = true;
      detachBridge?.();
      detachBridge = null;
      paintGate.detach();
      fontGeneration += 1;
      activeFontLease?.release();
      activeFontLease = null;
      installedFonts.value = null;
      editor?.destroy();
      editor = null;
      if (shaping) disposeLayoutShaping(shaping);
      shaping = null;
      readyPublished = false;
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
            installedFonts.value
              ? paintDisplay(pages.value, installedFonts.value, overlays.value, clickTarget.value)
              : []
          ),
          ...(fontError.value
            ? [
                h(
                  'div',
                  {
                    role: 'alert',
                    'data-testid': 'docx-editor-font-error',
                  },
                  fontError.value.message
                ),
              ]
            : []),
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
