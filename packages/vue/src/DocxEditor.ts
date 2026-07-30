import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
} from 'vue';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  EditorFontError,
  EditorSnapshot,
  FontConfiguration,
} from '@docx-editor.dev/core-contract/contracts/editor';
import { createTreeEditor } from '@docx-editor.dev/core-contract/editor';
import type { DocxEditorRef, EditorMode } from './types';

/**
 * Vue host for the tree-lane editor (phase 3 of the legacy-lane retirement).
 *
 * The PAIR of the React host, and deliberately the same shape: a container element, the
 * facade's lifetime, and prop-to-facade forwarding — nothing else. `createTreeEditor`
 * implements the full `Editor` contract over the engine-owned paginated surface, which
 * paints its own pages into the container and owns caret, selection, and hit testing
 * internally, so the adapter measures nothing, paints nothing, and derives no geometry.
 * Only the lifecycle glue differs from React, because that is the part the frameworks
 * genuinely disagree about.
 *
 * chrome re-integration: phase 4 follow-up (task 10V.1 ports the React title bar/chrome).
 */

/**
 * What `snapshot()` reports before an editor exists: loading, not editable, nothing
 * selected — never invented state. Mirrors the React adapter's pre-mount snapshot.
 */
const PRE_MOUNT_SNAPSHOT: EditorSnapshot = {
  scope: { kind: 'body' },
  isLoading: true,
  parseError: null,
  editable: false,
  zoom: 1,
  selection: null,
  formatting: null,
  table: null,
  image: null,
  page: { current: 0, total: 0 },
};

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
    const container = ref<HTMLDivElement | null>(null);
    let editor: Editor | null = null;
    let offChange: (() => void) | null = null;

    const teardown = (): void => {
      offChange?.();
      offChange = null;
      editor?.destroy();
      editor = null;
    };

    // Create the facade once per document/fonts identity, mirroring the React effect:
    // `mode`, `locale`, `author`, and the initial `zoom` are sampled at mount; later
    // zoom changes flow through `setZoom` below rather than a teardown, so undo history
    // and the caret survive re-renders.
    const mount = (): void => {
      teardown();
      const element = container.value;
      if (!element) return;
      const created = createTreeEditor({
        container: element,
        ...(props.document !== undefined ? { document: props.document } : {}),
        fonts: props.fonts,
        ...(props.author !== undefined ? { author: props.author } : {}),
        ...(props.locale !== undefined ? { locale: props.locale } : {}),
        ...(props.mode !== undefined ? { mode: props.mode } : {}),
        ...(props.zoom !== undefined ? { zoom: props.zoom } : {}),
        onFontError: (error) => emit('fontError', error),
      });
      editor = created;
      offChange = created.on('change', (change) => emit('change', change));
      emit('ready', created);
    };

    // `onMounted` for the first mount — the element does not exist until the component
    // has rendered. Re-mount only when the document or how it is measured changes, NOT
    // on zoom: it is a facade parameter, and remounting on it would reopen the document
    // and discard every edit along with the caret and undo history.
    onMounted(mount);
    watch(() => [props.document, props.fonts] as const, mount, { flush: 'post' });
    watch(
      () => props.zoom,
      (zoom) => {
        if (zoom !== undefined) editor?.setZoom(zoom);
      }
    );

    onBeforeUnmount(teardown);

    // The seven-member handle, identical to the React ref: each member forwards to the
    // facade and is safe to call before mount.
    const api: DocxEditorRef = {
      load: (document) => editor?.load(document),
      save: () => editor?.save() ?? Promise.resolve(null),
      getDocumentHandle: () => editor?.getDocumentHandle() ?? null,
      getEditor: () => editor,
      focus: () => {
        editor?.focus();
      },
      exec: (command, options) =>
        editor?.exec(command, options) ?? {
          ok: false,
          code: 'notFound',
          reason: 'no editor is mounted',
        },
      snapshot: (options) => editor?.snapshot(options) ?? PRE_MOUNT_SNAPSHOT,
    };
    expose(api);

    // `ep-root` scopes every --doc-* token; the viewport is the sole scroll container;
    // `docx-paginated-surface` carries the engine surface's paper styling. The facade
    // mounts its pages inside the inner element and owns that subtree.
    return () =>
      h(
        'div',
        {
          'data-testid': 'docx-editor-scroll',
          class: 'ep-root ep-one-surface ep-one-surface__viewport',
        },
        [
          h('div', {
            ref: container,
            class: 'docx-paginated-surface',
            style: { margin: '24px auto' },
          }),
        ]
      );
  },
});
