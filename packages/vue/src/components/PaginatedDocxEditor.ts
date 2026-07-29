// A Vue host for the engine-owned paginated surface (task 11.1).
//
// The PAIR of the React host, and deliberately the same shape: a container, the surface's
// lifetime, and engine state exposed to the framework. Everything a user can do is decided
// by the engine, so the two adapters cannot drift into two behaviours — only the lifecycle
// glue differs, because that is the part the frameworks genuinely disagree about.

import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceState,
} from '@docx-editor.dev/engine-editor';
import type { NavigationCommand, TextMeasurer } from '@docx-editor.dev/engine-layout';

/** The imperative surface a template ref exposes, paired with the React handle. */
export interface PaginatedDocxEditorExpose {
  focus(): void;
  type(text: string): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  navigate(command: NavigationCommand, extend?: boolean): void;
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  save(): Uint8Array | null;
}

export const PaginatedDocxEditor = defineComponent({
  name: 'PaginatedDocxEditor',
  props: {
    source: { type: Object as PropType<Uint8Array>, required: true },
    scale: { type: Number, default: undefined },
    measurer: { type: Object as PropType<TextMeasurer>, default: undefined },
    className: { type: String, default: 'docx-paginated-surface' },
  },
  emits: {
    stateChange: (state: PaginatedSurfaceState) => Boolean(state),
    error: (reason: string, _detail?: string) => Boolean(reason),
  },
  setup(props, { emit, expose }) {
    const container = ref<HTMLDivElement | null>(null);
    // `shallowRef`: the surface owns a live DOM tree and a store. Making it deeply reactive
    // would have Vue walk the whole engine on every mutation.
    const surface = shallowRef<PaginatedSurface | null>(null);
    const state = shallowRef<PaginatedSurfaceState | null>(null);

    const teardown = (): void => {
      surface.value?.destroy();
      surface.value = null;
    };

    const mount = (): void => {
      teardown();
      const element = container.value;
      if (!element) return;
      const result = mountPaginatedSurface(element, props.source, {
        ...(props.scale === undefined ? {} : { scale: props.scale }),
        ...(props.measurer ? { measurer: props.measurer } : {}),
        onChange: (next) => {
          state.value = next;
          emit('stateChange', next);
        },
      });
      if (!result.ok) {
        // Reported, not thrown — the same contract the React host holds.
        emit('error', result.reason, result.detail);
        return;
      }
      surface.value = result.surface;
      state.value = result.surface.state();
    };

    // `onMounted` for the FIRST mount, not an immediate watcher: the element does not exist
    // until the component has rendered, and a post-flush watcher would not have run by the
    // time a caller synchronously asks what was painted. This is the Vue counterpart of the
    // React effect, and it runs at the same point in the lifecycle.
    onMounted(mount);
    // Re-open only when the document or how it is measured actually changes.
    watch(() => [props.source, props.scale, props.measurer] as const, mount, { flush: 'post' });

    onBeforeUnmount(teardown);

    const api: PaginatedDocxEditorExpose = {
      focus: () => surface.value?.focus(),
      type: (text) => surface.value?.type(text),
      undo: () => surface.value?.undo(),
      redo: () => surface.value?.redo(),
      selectAll: () => surface.value?.selectAll(),
      navigate: (command, extend) => surface.value?.navigate(command, extend),
      toggleRunProperty: (localName, attributes) =>
        surface.value?.toggleRunProperty(localName, attributes),
      save: () => surface.value?.session.save() ?? null,
    };
    expose(api);

    return () =>
      h('div', {
        ref: container,
        class: props.className,
        'data-revision': state.value?.revision ?? 0,
        'data-page-count': state.value?.pageCount ?? 0,
      });
  },
});

export default PaginatedDocxEditor;
