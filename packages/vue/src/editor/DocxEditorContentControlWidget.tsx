import {
  computed,
  defineComponent,
  onBeforeUnmount,
  ref,
  toRef,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
  type VNodeChild,
} from 'vue';
import {
  contentControlPopupOpener,
  observeContentControlPopup,
  contentControlPopupKeyDown,
  type ContentControlWidgetSession,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useFormControlTranslate } from './form-control-translate';
import {
  provideContentControlWidget,
  useContentControlWidgetState,
  type UseContentControlWidgetResult,
} from './content-control-widget/context';
import {
  ContentControlWidgetNavigation,
  ContentControlWidgetMonth,
  ContentControlWidgetYear,
  ContentControlWidgetApply,
  ContentControlWidgetCalendar,
  ContentControlWidgetCancel,
  ContentControlWidgetDay,
  ContentControlWidgetError,
  ContentControlWidgetFooter,
  ContentControlWidgetGrid,
  ContentControlWidgetHeader,
  ContentControlWidgetInput,
  ContentControlWidgetItem,
  ContentControlWidgetList,
  ContentControlWidgetNextMonth,
  ContentControlWidgetPicture,
  ContentControlWidgetPreviousMonth,
  ContentControlWidgetTitle,
  ContentControlWidgetToday,
  ContentControlWidgetWeekdays,
} from './content-control-widget/parts';

/** Value-widget session and optional replacement controls. @public */
export interface DocxEditorContentControlWidgetProps {
  session: ContentControlWidgetSession;
  className?: string;
  style?: CSSProperties;
  /**
   * Replaces the packaged arrangement. Compose it from the compound's parts
   * (`DocxEditorContentControlWidget.Calendar`, `.List`, …) or from `useContentControlWidget()`.
   */
  children?: DocxEditorChildren;
}

function defaultArrangement(widget: UseContentControlWidgetResult): VNodeChild {
  const kind = widget.kind.value;
  if (kind === 'date') return <ContentControlWidgetCalendar />;
  if (kind === 'picture')
    return (
      <>
        <ContentControlWidgetPicture />
        <ContentControlWidgetError />
        <ContentControlWidgetCancel />
      </>
    );
  if (kind === 'comboBox') {
    return (
      <>
        <ContentControlWidgetInput />
        <ContentControlWidgetList />
        <ContentControlWidgetError />
        <ContentControlWidgetFooter />
      </>
    );
  }
  return (
    <>
      <ContentControlWidgetList />
      <ContentControlWidgetError />
    </>
  );
}

/**
 * The packaged value pop-up for a dropdown, combo-box, date, building block gallery,
 * checkbox or picture content control.
 *
 * Anchored below the control inside the editor's scroll container. Without children it
 * renders the same arrangement the engine paints on its own — a list, a list with free-text
 * entry, or a month calendar with a Today button — from the same stylesheet classes, so one
 * theme covers both. A checkbox session applies its toggle at once and shows nothing; a
 * picture session opens the browser's file dialog and retains a retry input and Cancel action.
 * @public
 */
const ContentControlWidgetRoot = defineComponent({
  name: 'DocxEditorContentControlWidget',
  props: {
    session: { type: Object as PropType<ContentControlWidgetSession>, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: [Object, Array, String] as PropType<DocxEditorChildren>,
  },
  setup(props, { slots }) {
    const t = useFormControlTranslate();
    const session = toRef(props, 'session');
    const widget = useContentControlWidgetState(session);
    provideContentControlWidget(widget);
    const closed = ref(props.session.signal.aborted);
    const panel = ref<HTMLDivElement | null>(null);
    // A checkbox has no pop-up: the packaged arrangement IS the toggle, so configuring this
    // popup for a restyled dropdown never makes checkboxes stop working. A host that renders
    // its own children owns the decision instead.
    const immediate = computed(
      () => props.session.kind === 'checkbox' && !slots.default && props.children === undefined
    );
    let opener = contentControlPopupOpener(props.session.anchor);
    let focusPanel: HTMLDivElement | null = null;
    const restoreFocus = () => {
      const previous = opener;
      const element = focusPanel;
      opener = null;
      focusPanel = null;
      if (!previous?.isConnected || !element) return;
      const active = element.ownerDocument.activeElement;
      if (active === element.ownerDocument.body || (active && element.contains(active)))
        previous.focus({ preventScroll: true });
    };
    onBeforeUnmount(restoreFocus);
    watch(
      session,
      (current, _old, onCleanup) => {
        closed.value = current.signal.aborted;
        const abort = () => {
          closed.value = true;
        };
        current.signal.addEventListener('abort', abort, { once: true });
        onCleanup(() => current.signal.removeEventListener('abort', abort));
        if (immediate.value && !current.signal.aborted) {
          current.apply(current.value === 'true' ? 'false' : 'true');
        }
      },
      { immediate: true }
    );
    watch(
      [panel, session],
      ([element, current], _old, onCleanup) => {
        if (!element) {
          restoreFocus();
          return;
        }
        if (focusPanel) {
          restoreFocus();
          opener = contentControlPopupOpener(current.anchor);
        }
        focusPanel = element;
        if (current.anchor) onCleanup(observeContentControlPopup(element, current.anchor));
        // The calendar grid places its own roving focus; everything else takes the first control.
        if (!element.querySelector('[data-docx-part="grid"]')) {
          (
            element.querySelector<HTMLElement>('input') ??
            element.querySelector<HTMLElement>('[role=option][tabindex="0"]') ??
            element.querySelector<HTMLElement>('select,button,[data-docx-part=empty]')
          )?.focus({ preventScroll: true });
        }
      },
      { flush: 'post' }
    );
    watch(
      [panel, closed],
      ([element, isClosed], _old, onCleanup) => {
        if (!element || isClosed) return;
        const dismiss = (event: Event) => {
          if (!element.contains(event.target as Node)) props.session.cancel();
        };
        element.ownerDocument.addEventListener('pointerdown', dismiss, true);
        onCleanup(() => element.ownerDocument.removeEventListener('pointerdown', dismiss, true));
      },
      { flush: 'post' }
    );
    return () => {
      if (closed.value || immediate.value) return null;
      const current = props.session;
      const label = t(`contentControl.types.${current.kind}`);
      return (
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          class={['docx-content-control-widget-popup', props.className]}
          style={props.style}
          data-docx-popup="contentControlWidget"
          data-docx-part="popup"
          data-kind={current.kind}
          onPointerdown={(event) => event.stopPropagation()}
          onKeydown={(event) => {
            contentControlPopupKeyDown(event.currentTarget as HTMLElement, event, current.cancel);
            widget.listNavigation.keyDown(event, event.currentTarget as HTMLElement);
          }}
        >
          {slots.default?.() ?? props.children ?? defaultArrangement(widget)}
        </div>
      );
    };
  },
});

/** The compound pop-up with its parts attached as statics. @public */
export interface DocxEditorContentControlWidgetNamespace {
  (props: DocxEditorContentControlWidgetProps): VNode | null;
  readonly Navigation: typeof ContentControlWidgetNavigation;
  readonly Month: typeof ContentControlWidgetMonth;
  readonly Year: typeof ContentControlWidgetYear;
  readonly Calendar: typeof ContentControlWidgetCalendar;
  readonly Header: typeof ContentControlWidgetHeader;
  readonly PreviousMonth: typeof ContentControlWidgetPreviousMonth;
  readonly Title: typeof ContentControlWidgetTitle;
  readonly NextMonth: typeof ContentControlWidgetNextMonth;
  readonly Weekdays: typeof ContentControlWidgetWeekdays;
  readonly Grid: typeof ContentControlWidgetGrid;
  readonly Day: typeof ContentControlWidgetDay;
  readonly Today: typeof ContentControlWidgetToday;
  readonly List: typeof ContentControlWidgetList;
  readonly Item: typeof ContentControlWidgetItem;
  readonly Input: typeof ContentControlWidgetInput;
  readonly Picture: typeof ContentControlWidgetPicture;
  readonly Error: typeof ContentControlWidgetError;
  readonly Footer: typeof ContentControlWidgetFooter;
  readonly Apply: typeof ContentControlWidgetApply;
  readonly Cancel: typeof ContentControlWidgetCancel;
}

/** Compact value editor for a configured content-control popup. @public */
export const DocxEditorContentControlWidget = Object.assign(ContentControlWidgetRoot, {
  Navigation: ContentControlWidgetNavigation,
  Month: ContentControlWidgetMonth,
  Year: ContentControlWidgetYear,
  Calendar: ContentControlWidgetCalendar,
  Header: ContentControlWidgetHeader,
  PreviousMonth: ContentControlWidgetPreviousMonth,
  Title: ContentControlWidgetTitle,
  NextMonth: ContentControlWidgetNextMonth,
  Weekdays: ContentControlWidgetWeekdays,
  Grid: ContentControlWidgetGrid,
  Day: ContentControlWidgetDay,
  Today: ContentControlWidgetToday,
  List: ContentControlWidgetList,
  Item: ContentControlWidgetItem,
  Input: ContentControlWidgetInput,
  Picture: ContentControlWidgetPicture,
  Error: ContentControlWidgetError,
  Footer: ContentControlWidgetFooter,
  Apply: ContentControlWidgetApply,
  Cancel: ContentControlWidgetCancel,
}) as unknown as DocxEditorContentControlWidgetNamespace;
