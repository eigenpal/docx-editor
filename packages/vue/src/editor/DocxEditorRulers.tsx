import {
  computed,
  defineComponent,
  ref,
  watch,
  type ComputedRef,
  type CSSProperties,
  type PropType,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { RulerIndent } from '@docx-editor.dev/core/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
import { useDocxEditor } from './context';
import { selectDocumentAbsent } from './document-presence';
import { useEditorState } from './useEditorState';
import { usePageSetup } from './usePageSetup';
import { useParagraphIndent } from './useParagraphIndent';
import { useNavigationShift, useNavigationViewportElement } from './navigation/navigation-layout';
import { useReviewGutter, useViewportClientWidth } from './review-gutter';
import { formatPx, twipsToPixels } from '../lib/units';

const selectZoom = (snapshot: EditorSnapshot): number => snapshot.zoom;
const selectOpening = (snapshot: EditorSnapshot): boolean => snapshot.isOpening === true;

/** @public */
export interface DocxEditorRulerProps {
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
}

type PendingMargins = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;

function previewed(
  pageSetup: RulerPageSetup | null,
  pending: PendingMargins
): RulerPageSetup | null {
  if (!pageSetup || Object.keys(pending).length === 0) return pageSetup;
  return { ...pageSetup, marginsTwips: { ...pageSetup.marginsTwips, ...pending } };
}

function useMarginDrag() {
  const { apply } = usePageSetup();
  const pending = ref<PendingMargins>({});
  const pendingRef = ref<PendingMargins>({});
  const preview = (side: keyof PendingMargins) => (twips: number) => {
    pendingRef.value = { ...pendingRef.value, [side]: Math.round(twips) };
    pending.value = { ...pendingRef.value };
  };
  const commit = () => {
    const current = pendingRef.value;
    pendingRef.value = {};
    pending.value = {};
    if (Object.keys(current).length === 0) return;
    apply({
      ...(current.top !== undefined ? { marginTopTwips: current.top } : {}),
      ...(current.right !== undefined ? { marginRightTwips: current.right } : {}),
      ...(current.bottom !== undefined ? { marginBottomTwips: current.bottom } : {}),
      ...(current.left !== undefined ? { marginLeftTwips: current.left } : {}),
      scope: 'section',
    });
  };
  return { pending, preview, commit };
}

interface IndentDrag {
  readonly indent: ComputedRef<RulerIndent | null>;
  readonly isEnabled: ReturnType<typeof useParagraphIndent>['isEnabled'];
  readonly preview: (next: RulerIndent) => void;
  readonly commit: () => void;
}

function useIndentDrag(): IndentDrag {
  const editorRef = useDocxEditor();
  const { indent: stored, isEnabled, apply } = useParagraphIndent();
  const pending = ref<RulerIndent | null>(null);
  const pendingRef = ref<RulerIndent | null>(null);
  const anchorRef = ref<string | null>(null);

  const preview = (next: RulerIndent) => {
    if (anchorRef.value === null) anchorRef.value = selectionKey(editorRef.value);
    pendingRef.value = next;
    pending.value = next;
  };

  const commit = () => {
    const next = pendingRef.value;
    const anchor = anchorRef.value;
    pendingRef.value = null;
    anchorRef.value = null;
    pending.value = null;
    if (!next) return;
    if (anchor !== null && anchor !== selectionKey(editorRef.value)) return;
    apply({ left: next.left, right: next.right, firstLine: next.firstLine });
  };

  const indent = computed(
    () =>
      pending.value ??
      (stored.value
        ? { left: stored.value.left, right: stored.value.right, firstLine: stored.value.firstLine }
        : null)
  );

  return { indent, isEnabled, preview, commit };
}

function selectionKey(editor: ReturnType<typeof useDocxEditor>['value']): string {
  const selection = editor?.snapshot().selection ?? null;
  return selection ? JSON.stringify(selection) : '';
}

/** @public */
export const DocxEditorHorizontalRuler = defineComponent({
  name: 'DocxEditorHorizontalRuler',
  props: {
    unit: { type: String as PropType<'inch' | 'cm'>, default: undefined },
    className: { type: String, default: undefined },
    style: { type: null as unknown as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const opening = useEditorState(selectOpening);
    const { pageSetup, isEnabled } = usePageSetup();
    const zoom = useEditorState(selectZoom);
    const marginDrag = useMarginDrag();
    const indentDrag = useIndentDrag();
    const shift = useNavigationShift();
    const reserved = useReviewGutter();
    const scrollLeft = ref(0);
    const viewport = useNavigationViewportElement();
    watch(
      viewport,
      (element, _, onCleanup) => {
        if (!element) {
          scrollLeft.value = 0;
          return;
        }
        const sync = () => {
          scrollLeft.value = element.scrollLeft;
        };
        sync();
        element.addEventListener('scroll', sync, { passive: true });
        onCleanup(() => element.removeEventListener('scroll', sync));
      },
      { flush: 'post', immediate: true }
    );

    return () => {
      if (documentAbsent.value) return null;
      return (
        <div
          class={`docx-ruler-frame${opening.value ? ' docx-ruler-frame--opening' : ''}`}
          style={{
            paddingInlineStart: formatPx(shift.value + reserved.value.inlineStart),
            paddingRight: formatPx(reserved.value.inlineEnd),
          }}
        >
          <HorizontalRuler
            pageSetup={previewed(pageSetup.value, marginDrag.pending.value)}
            zoom={zoom.value}
            editable={isEnabled.value}
            onLeftMarginChange={marginDrag.preview('left')}
            onRightMarginChange={marginDrag.preview('right')}
            onMarginDragEnd={marginDrag.commit}
            showIndentHandles={indentDrag.indent.value !== null}
            indent={indentDrag.indent.value}
            indentEditable={indentDrag.isEnabled.value}
            onIndentChange={indentDrag.preview}
            onIndentDragEnd={indentDrag.commit}
            unit={props.unit ?? 'inch'}
            className={props.className ?? ''}
            style={{
              ...props.style,
              transform: `${props.style?.transform ? `${props.style.transform} ` : ''}translateX(${-scrollLeft.value}px)`,
              clipPath:
                shift.value > 0 && scrollLeft.value > 0
                  ? `inset(0 0 0 ${scrollLeft.value}px)`
                  : props.style?.clipPath,
            }}
          />
        </div>
      );
    };
  },
});

/** @public */
export const DocxEditorVerticalRuler = defineComponent({
  name: 'DocxEditorVerticalRuler',
  props: {
    unit: { type: String as PropType<'inch' | 'cm'>, default: undefined },
    className: { type: String, default: undefined },
    style: { type: null as unknown as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const { pageSetup, isEnabled } = usePageSetup();
    const zoom = useEditorState(selectZoom);
    const marginDrag = useMarginDrag();
    const shift = useNavigationShift();
    const reserved = useReviewGutter();
    const viewportWidth = useViewportClientWidth();

    return () => {
      if (documentAbsent.value) return null;
      if (viewportWidth.value !== null && viewportWidth.value > 0 && pageSetup.value) {
        const pageWidthPx = twipsToPixels(pageSetup.value.pageWidthTwips) * zoom.value;
        if (
          pageWidthPx >
          viewportWidth.value - shift.value - reserved.value.inlineStart - reserved.value.inlineEnd
        ) {
          return null;
        }
      }
      return (
        <VerticalRuler
          pageSetup={previewed(pageSetup.value, marginDrag.pending.value)}
          zoom={zoom.value}
          editable={isEnabled.value}
          onTopMarginChange={marginDrag.preview('top')}
          onBottomMarginChange={marginDrag.preview('bottom')}
          onMarginDragEnd={marginDrag.commit}
          unit={props.unit ?? 'inch'}
          className={props.className ?? ''}
          style={props.style}
        />
      );
    };
  },
});
