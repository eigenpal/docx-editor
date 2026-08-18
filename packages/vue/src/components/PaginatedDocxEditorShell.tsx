import { defineComponent, h, type PropType, type Ref, type VNode } from 'vue';
import type { PaginatedSurfaceState, TextMeasurer } from '@docx-editor.dev/core/editor';
import type { PaginatedDocxEditorHandle } from './PaginatedDocxEditor';

/** @public */
export interface PaginatedDocxEditorShellProps {
  readonly source: Uint8Array;
  readonly documentName?: string;
  readonly scale?: number;
  readonly measurer?: TextMeasurer;
  readonly onStateChange?: (state: PaginatedSurfaceState) => void;
  readonly onError?: (reason: string, detail?: string) => void;
  readonly onSave?: (bytes: Uint8Array) => void;
  readonly renderTitleBarLeft?: () => VNode;
  readonly renderTitleBarRight?: () => VNode;
  readonly colorMode?: 'light' | 'dark';
  readonly onZoomChange?: (zoom: number) => void;
  readonly documentFontFamily?: string;
  readonly className?: string;
  readonly ref?: Ref<PaginatedDocxEditorHandle | null>;
}

/**
 * @deprecated Use `<DocxEditor>` from the composition layer instead.
 * @public
 */
export const PaginatedDocxEditorShell = defineComponent({
  name: 'PaginatedDocxEditorShell',
  props: {
    source: { type: Object as PropType<Uint8Array>, required: true },
    documentName: { type: String, default: undefined },
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
    onSave: { type: Function as PropType<(bytes: Uint8Array) => void>, default: undefined },
    colorMode: { type: String as PropType<'light' | 'dark'>, default: undefined },
    onZoomChange: { type: Function as PropType<(zoom: number) => void>, default: undefined },
    documentFontFamily: { type: String, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { expose, slots }) {
    expose({} as PaginatedDocxEditorHandle);
    return () =>
      h(
        'div',
        {
          class: [
            'docx-editor docx-paginated-shell',
            props.colorMode === 'dark' ? 'dark' : '',
            props.className ?? '',
          ]
            .filter(Boolean)
            .join(' '),
          'data-testid': 'paginated-shell',
        },
        slots.default?.()
      );
  },
});
