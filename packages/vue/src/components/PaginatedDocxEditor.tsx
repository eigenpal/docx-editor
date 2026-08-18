import {
  defineComponent,
  computed,
  h,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type PropType,
  type Ref,
  type VNode,
} from 'vue';
import {
  mountPaginatedSurface,
  type NavigationCommand,
  type PaginatedSurface,
  type PaginatedSurfaceState,
  type SectionProperties,
  type SurfaceFormatting,
  type TextMeasurer,
} from '@docx-editor.dev/core/editor';

/** @public */
export interface PaginatedDocxEditorProps {
  readonly source: Uint8Array;
  readonly scale?: number;
  readonly measurer?: TextMeasurer;
  readonly onStateChange?: (state: PaginatedSurfaceState) => void;
  readonly onError?: (reason: string, detail?: string) => void;
  readonly className?: string;
  readonly documentFontFamily?: string;
  readonly ref?: Ref<PaginatedDocxEditorHandle>;
}

/** @public */
export interface PaginatedDocxEditorHandle {
  focus(): void;
  type(text: string): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  navigate(command: NavigationCommand, extend?: boolean): void;
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  setRunProperty(localName: string, attributes?: Record<string, string>): void;
  setParagraphProperty(localName: string, attributes?: Record<string, string>): void;
  formatting(): SurfaceFormatting | null;
  sectionProperties(): SectionProperties | null;
  save(): Uint8Array | null;
}

/** Vue name for the same contract React exports as `PaginatedDocxEditorExpose`. @public */
export type PaginatedDocxEditorExpose = PaginatedDocxEditorHandle;

/** @public */
export const PaginatedDocxEditor = defineComponent({
  name: 'PaginatedDocxEditor',
  props: {
    source: { type: Object as PropType<Uint8Array>, required: true },
    scale: { type: Number, default: undefined },
    measurer: { type: Object as PropType<TextMeasurer>, default: undefined },
    onStateChange: {
      type: Function as PropType<(state: PaginatedSurfaceState) => void>,
      default: undefined,
    },
    onError: {
      type: Function as PropType<(reason: string, detail?: string) => void>,
      default: undefined,
    },
    className: { type: String, default: undefined },
    documentFontFamily: { type: String, default: undefined },
  },
  setup(props, { expose }) {
    const containerRef = ref<HTMLDivElement | null>(null);
    const surfaceRef = shallowRef<PaginatedSurface | null>(null);
    const state = shallowRef<PaginatedSurfaceState | null>(null);

    const onStateChangeRef = shallowRef(props.onStateChange);
    const onErrorRef = shallowRef(props.onError);
    watch(
      () => props.onStateChange,
      (next) => {
        onStateChangeRef.value = next;
      }
    );
    watch(
      () => props.onError,
      (next) => {
        onErrorRef.value = next;
      }
    );

    const mountSurface = () => {
      const container = containerRef.value;
      if (!container) return undefined;
      const result = mountPaginatedSurface(container, props.source, {
        ...(props.scale === undefined ? {} : { scale: props.scale }),
        ...(props.measurer ? { measurer: props.measurer } : {}),
        onChange: (next) => {
          state.value = next;
          onStateChangeRef.value?.(next);
        },
      });
      if (!result.ok) {
        onErrorRef.value?.(result.reason, result.detail);
        return undefined;
      }
      surfaceRef.value = result.surface;
      const initial = result.surface.state();
      state.value = initial;
      onStateChangeRef.value?.(initial);
      return () => {
        result.surface.destroy();
        surfaceRef.value = null;
      };
    };

    const pageCount = computed(() => state.value?.pageCount ?? 0);
    const revision = computed(() => state.value?.revision ?? 0);

    let cleanup: (() => void) | undefined;
    const remount = () => {
      cleanup?.();
      cleanup = mountSurface();
    };

    watch(
      () => [props.source, props.measurer] as const,
      () => {
        if (containerRef.value) remount();
      }
    );
    onUnmounted(() => {
      cleanup?.();
    });

    expose({
      focus: () => surfaceRef.value?.focus(),
      type: (text: string) => surfaceRef.value?.type(text),
      undo: () => surfaceRef.value?.undo(),
      redo: () => surfaceRef.value?.redo(),
      selectAll: () => surfaceRef.value?.selectAll(),
      navigate: (command: NavigationCommand, extend?: boolean) =>
        surfaceRef.value?.navigate(command, extend),
      toggleRunProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.value?.toggleRunProperty(localName, attributes),
      setRunProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.value?.setRunProperty(localName, attributes),
      setParagraphProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.value?.setParagraphProperty(localName, attributes),
      formatting: () => surfaceRef.value?.formatting() ?? null,
      sectionProperties: () => surfaceRef.value?.sectionProperties() ?? null,
      save: () => {
        const surface = surfaceRef.value;
        if (!surface) return null;
        surface.flushPendingInput();
        return surface.session.save();
      },
    } satisfies PaginatedDocxEditorHandle);

    return (): VNode =>
      h('div', {
        onVnodeMounted: (vnode) => {
          containerRef.value = vnode.el as HTMLDivElement;
          remount();
        },
        onVnodeBeforeUnmount: () => {
          cleanup?.();
          cleanup = undefined;
        },
        class: props.className
          ? `docx-paginated-surface ${props.className}`
          : 'docx-paginated-surface',
        style: {
          margin: '24px auto',
          ...(props.documentFontFamily ? { fontFamily: props.documentFontFamily } : {}),
        },
        'data-revision': revision.value,
        'data-page-count': pageCount.value,
      });
  },
});
