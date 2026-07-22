import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import { createEditor, type Editor, type EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import type { DocxDocument } from '@docx-editor.dev/core-contract/types';
import { paintDisplay } from './paintDisplay';
import type { EditorMode } from './types';

/**
 * Vue host for the DOCX editor. It supplies an `EditorHost`, constructs the
 * `Editor` through `createEditor`, and paints the positioned `DisplayPage[]`
 * the engine emits. All editing, querying, and geometry go through the facade.
 */
export default defineComponent({
  name: 'DocxEditor',
  props: {
    document: { type: Object as PropType<DocxDocument>, default: undefined },
    mode: { type: String as PropType<EditorMode>, default: 'edit' },
    zoom: { type: Number, default: undefined },
    locale: { type: String, default: undefined },
  },
  emits: {
    ready: (_editor: Editor) => true,
    change: (_document: DocxDocument) => true,
  },
  setup(props, { emit, expose }) {
    const bodyEl = ref<HTMLDivElement | null>(null);
    const pagesEl = ref<HTMLDivElement | null>(null);
    const scrollEl = ref<HTMLDivElement | null>(null);
    const pages = ref<readonly DisplayPage[]>([]);
    let editor: Editor | null = null;

    const host: EditorHost = {
      getBodyHostEl: () => bodyEl.value,
      getHfHostEl: () => null,
      getPagesContainer: () => pagesEl.value,
      getScrollContainer: () => scrollEl.value,
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
      });
      emit('ready', editor);
      editor.on('change', (doc) => emit('change', doc));
    });

    // Reload on document change (does not fire on initial value — createEditor
    // already loaded it), mirroring the React adapter.
    watch(
      () => props.document,
      (doc) => {
        if (doc) editor?.load(doc);
      }
    );

    onBeforeUnmount(() => {
      editor?.destroy();
      editor = null;
    });

    expose({
      exec: (...args: Parameters<Editor['exec']>) => editor!.exec(...args),
      snapshot: (...args: Parameters<Editor['snapshot']>) => editor!.snapshot(...args),
      save: () => editor!.save(),
      focus: (...args: Parameters<Editor['focus']>) => editor!.focus(...args),
      getEditor: () => editor,
    });

    return () =>
      h('div', { ref: scrollEl, style: { overflow: 'auto' } }, [
        h('div', { ref: pagesEl }, paintDisplay(pages.value)),
        h('div', { ref: bodyEl, style: { position: 'absolute', left: '-9999px', top: '0' } }),
      ]);
  },
});
