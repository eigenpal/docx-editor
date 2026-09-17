import {
  defineComponent,
  h,
  ref,
  watch,
  type CSSProperties,
  type PropType,
  type VNodeChild,
} from 'vue';
import { isoDateOf, parseIsoDate, type CalendarDay } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { Slot } from '../toolbar/Slot';
import { mergeHostClass } from '../../lib/mergeHostClass';
import { useFormControlTranslate } from '../form-control-translate';
import {
  useContentControlWidget,
  type ContentControlWidgetEntry,
  type UseContentControlWidgetResult,
} from './context';

/**
 * Presentation overrides for a value pop-up part. @public
 *
 * Anything beyond these members reaches the rendered element, so a part takes an `id`, an
 * `aria-*` label or a `data-*` test hook. The part's own wiring wins every collision. Pass
 * `asChild` to own the element outright and keep its behavior.
 */
export interface DocxEditorContentControlWidgetPartProps {
  class?: string;
  className?: string;
  style?: CSSProperties;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
  id?: string;
  title?: string;
  'aria-label'?: string;
  [attribute: `data-${string}`]: unknown;
}

const partProps = {
  class: { type: String, default: undefined },
  className: { type: String, default: undefined },
  style: { type: Object as PropType<CSSProperties>, default: undefined },
  hidden: { type: Boolean, default: undefined },
  asChild: { type: Boolean, default: undefined },
  children: { type: [Object, Array, String] as PropType<DocxEditorChildren>, default: undefined },
} as const;

type Wiring = Record<string, unknown> & { class: string; style?: CSSProperties };

interface PartRender {
  readonly wiring: Wiring;
  readonly content: () => VNodeChild;
}

type Translate = ReturnType<typeof useFormControlTranslate>;

/**
 * Render a part as its packaged element or, with `asChild`, through the host's element.
 *
 * `wiring` (handlers, roles, packaged classes) is applied first and the host's presentation
 * last, except that the packaged class is dropped under `asChild` so a design-system
 * element is not outranked by it.
 */
function renderPart(
  tag: 'div' | 'button' | 'input',
  props: DocxEditorContentControlWidgetPartProps,
  attrs: Record<string, unknown>,
  slotContent: VNodeChild | undefined,
  render: PartRender
): VNodeChild {
  if (props.hidden) return null;
  const body = slotContent ?? props.children ?? render.content();
  const hostClass = [props.class, props.className].filter(Boolean).join(' ') || undefined;
  if (props.asChild) {
    const { class: _packaged, style: packagedStyle, ...handlers } = render.wiring;
    return h(
      Slot,
      { ...attrs, ...handlers, class: hostClass, style: { ...packagedStyle, ...props.style } },
      () => body
    );
  }
  return h(
    tag,
    {
      ...attrs,
      ...render.wiring,
      class: mergeHostClass(render.wiring.class, hostClass),
      style: { ...render.wiring.style, ...props.style },
    },
    tag === 'input' ? undefined : (body ?? undefined)
  );
}

function definePart(
  name: string,
  tag: 'div' | 'button' | 'input',
  build: (widget: UseContentControlWidgetResult, t: Translate) => PartRender
) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: partProps,
    setup(props, { slots, attrs }) {
      const widget = useContentControlWidget();
      const t = useFormControlTranslate();
      return () => renderPart(tag, props, attrs, slots.default?.(), build(widget, t));
    },
  });
}

const stopPress = (event: Event) => event.stopPropagation();

/** Steps the calendar back one month. @public */
export const ContentControlWidgetPreviousMonth = definePart(
  'DocxEditorContentControlWidgetPreviousMonth',
  'button',
  (widget, t) => ({
    wiring: {
      type: 'button',
      class: 'docx-content-control-calendar-nav',
      'data-docx-part': 'previousMonth',
      'aria-label': t('contentControl.calendar.previousMonth'),
      onMousedown: stopPress,
      onClick: () => widget.previousMonth(),
    },
    content: () => '‹',
  })
);

/** Steps the calendar forward one month. @public */
export const ContentControlWidgetNextMonth = definePart(
  'DocxEditorContentControlWidgetNextMonth',
  'button',
  (widget, t) => ({
    wiring: {
      type: 'button',
      class: 'docx-content-control-calendar-nav',
      'data-docx-part': 'nextMonth',
      'aria-label': t('contentControl.calendar.nextMonth'),
      onMousedown: stopPress,
      onClick: () => widget.nextMonth(),
    },
    content: () => '›',
  })
);

/** The month and year in view. @public */
export const ContentControlWidgetTitle = definePart(
  'DocxEditorContentControlWidgetTitle',
  'div',
  (widget) => ({
    wiring: {
      class: 'docx-content-control-calendar-title',
      'data-docx-part': 'title',
      'aria-live': 'polite',
    },
    content: () => widget.calendar.value.title,
  })
);

/** Month navigation row: previous, title, next. @public */
export const ContentControlWidgetHeader = definePart(
  'DocxEditorContentControlWidgetHeader',
  'div',
  () => ({
    wiring: { class: 'docx-content-control-calendar-header', 'data-docx-part': 'header' },
    content: () => [
      h(ContentControlWidgetPreviousMonth),
      h(ContentControlWidgetTitle),
      h(ContentControlWidgetNextMonth),
    ],
  })
);

/** Seven weekday labels in the locale's order. @public */
export const ContentControlWidgetWeekdays = definePart(
  'DocxEditorContentControlWidgetWeekdays',
  'div',
  (widget) => ({
    wiring: { class: 'docx-content-control-calendar-weekdays', 'data-docx-part': 'weekdays' },
    content: () => widget.calendar.value.weekdays.map((label) => h('span', label)),
  })
);

/** Props for one calendar cell. @public */
export interface ContentControlWidgetDayProps extends DocxEditorContentControlWidgetPartProps {
  day: CalendarDay;
}

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** One calendar cell; a press commits that date, arrow keys roam the grid. @public */
export const ContentControlWidgetDay = defineComponent({
  name: 'DocxEditorContentControlWidgetDay',
  inheritAttrs: false,
  props: { ...partProps, day: { type: Object as PropType<CalendarDay>, required: true } },
  setup(props, { slots, attrs }) {
    const widget = useContentControlWidget();
    const roam = (event: KeyboardEvent) => {
      const step = ARROW_STEPS[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const from = parseIsoDate(props.day.iso);
      if (!from) return;
      widget.focusDay(
        isoDateOf(new Date(from.getFullYear(), from.getMonth(), from.getDate() + step))
      );
    };
    return () => {
      const day = props.day;
      return renderPart('button', props, attrs, slots.default?.(), {
        wiring: {
          type: 'button',
          class: 'docx-content-control-calendar-day',
          'data-docx-part': 'day',
          'data-iso': day.iso,
          role: 'gridcell',
          'aria-label': day.label,
          ...(day.selected ? { 'data-selected': '', 'aria-selected': 'true' } : {}),
          ...(day.today ? { 'data-today': '' } : {}),
          ...(day.otherMonth ? { 'data-other-month': '' } : {}),
          disabled: !widget.isEnabled.value,
          onMousedown: stopPress,
          onClick: () => widget.selectDay(day.iso),
          onKeydown: roam,
        },
        content: () => String(day.day),
      });
    };
  },
});

/** The six-week grid of `Day` cells. @public */
export const ContentControlWidgetGrid = defineComponent({
  name: 'DocxEditorContentControlWidgetGrid',
  inheritAttrs: false,
  props: partProps,
  setup(props, { slots, attrs }) {
    const widget = useContentControlWidget();
    const grid = ref<HTMLElement | null>(null);
    // Roving focus: after the grid renders (possibly a new month), land on the roamed-to day,
    // else the selected day, else today, else the first day of the month.
    const focusDay = () => {
      const element = grid.value;
      if (!element) return;
      const focusIso = widget.focusIso.value;
      const target =
        (focusIso ? element.querySelector<HTMLElement>(`[data-iso="${focusIso}"]`) : null) ??
        element.querySelector<HTMLElement>('[data-selected]') ??
        element.querySelector<HTMLElement>('[data-today]:not([data-other-month])') ??
        element.querySelector<HTMLElement>('[data-docx-part="day"]:not([data-other-month])');
      target?.focus({ preventScroll: true });
    };
    // Post-flush, so the new cells exist; synchronous, so a later focus move by the reader
    // is never undone by a queued one.
    watch([grid, widget.focusIso, widget.calendar], focusDay, { flush: 'post' });
    return () =>
      renderPart('div', props, attrs, slots.default?.(), {
        wiring: {
          ref: grid,
          class: 'docx-content-control-calendar-grid',
          'data-docx-part': 'grid',
          role: 'grid',
        },
        content: () =>
          widget.calendar.value.days.map((day) =>
            h(ContentControlWidgetDay, { key: day.iso, day })
          ),
      });
  },
});

/** Commits the current local date. @public */
export const ContentControlWidgetToday = definePart(
  'DocxEditorContentControlWidgetToday',
  'button',
  (widget, t) => ({
    wiring: {
      type: 'button',
      class: 'docx-content-control-calendar-today',
      'data-docx-part': 'today',
      disabled: !widget.isEnabled.value,
      onMousedown: stopPress,
      onClick: () => widget.selectToday(),
    },
    content: () => t('contentControl.calendar.today'),
  })
);

/** The whole date picker: header, weekdays, grid and Today. @public */
export const ContentControlWidgetCalendar = definePart(
  'DocxEditorContentControlWidgetCalendar',
  'div',
  () => ({
    wiring: { class: 'docx-content-control-calendar', 'data-docx-part': 'calendar' },
    content: () => [
      h(ContentControlWidgetHeader),
      h(ContentControlWidgetWeekdays),
      h(ContentControlWidgetGrid),
      h('div', { class: 'docx-content-control-calendar-footer' }, [h(ContentControlWidgetToday)]),
    ],
  })
);

/** Props for one list entry. @public */
export interface ContentControlWidgetItemProps extends DocxEditorContentControlWidgetPartProps {
  item: ContentControlWidgetEntry;
}

/** One dropdown or combo-box entry; a press commits its value. @public */
export const ContentControlWidgetItem = defineComponent({
  name: 'DocxEditorContentControlWidgetItem',
  inheritAttrs: false,
  props: {
    ...partProps,
    item: { type: Object as PropType<ContentControlWidgetEntry>, required: true },
  },
  setup(props, { slots, attrs }) {
    const widget = useContentControlWidget();
    return () =>
      renderPart('button', props, attrs, slots.default?.(), {
        wiring: {
          type: 'button',
          class: 'docx-content-control-menu-item',
          'data-docx-part': 'item',
          'data-value': props.item.value,
          role: 'option',
          'aria-selected': widget.value.value === props.item.value ? 'true' : 'false',
          disabled: !widget.isEnabled.value,
          onMousedown: stopPress,
          onClick: () => widget.apply(props.item.value),
        },
        content: () => props.item.displayText,
      });
  },
});

/** The list of `Item` entries the control declares. @public */
export const ContentControlWidgetList = definePart(
  'DocxEditorContentControlWidgetList',
  'div',
  (widget) => ({
    wiring: { class: 'docx-content-control-menu-list', 'data-docx-part': 'list', role: 'listbox' },
    content: () =>
      widget.items.value.map((item, index) => h(ContentControlWidgetItem, { key: index, item })),
  })
);

/** Free-text entry for a combo box; Enter commits. @public */
export const ContentControlWidgetInput = definePart(
  'DocxEditorContentControlWidgetInput',
  'input',
  (widget, t) => ({
    wiring: {
      type: 'text',
      class: 'docx-content-control-menu-input',
      'data-docx-part': 'input',
      'aria-label': t(`contentControl.types.${widget.kind.value}`),
      value: widget.value.value,
      onMousedown: stopPress,
      onInput: (event: Event) => widget.setValue((event.target as HTMLInputElement).value),
    },
    content: () => null,
  })
);

/** The engine refused the last value. @public */
export const ContentControlWidgetError = defineComponent({
  name: 'DocxEditorContentControlWidgetError',
  inheritAttrs: false,
  props: partProps,
  setup(props, { slots, attrs }) {
    const widget = useContentControlWidget();
    const t = useFormControlTranslate();
    return () =>
      widget.refused.value
        ? renderPart('div', props, attrs, slots.default?.(), {
            wiring: {
              class: 'docx-content-control-widget-error',
              'data-docx-part': 'error',
              role: 'alert',
            },
            content: () => t('disabledReason.invalidValue'),
          })
        : null;
  },
});

/** Commits the draft value. @public */
export const ContentControlWidgetApply = definePart(
  'DocxEditorContentControlWidgetApply',
  'button',
  (widget, t) => ({
    wiring: {
      type: 'button',
      class: 'docx-dialog__button docx-dialog__button--primary',
      'data-docx-part': 'apply',
      disabled: !widget.isEnabled.value,
      onClick: () => widget.apply(),
    },
    content: () => t('common.apply'),
  })
);

/** Closes without a write. @public */
export const ContentControlWidgetCancel = definePart(
  'DocxEditorContentControlWidgetCancel',
  'button',
  (widget, t) => ({
    wiring: {
      type: 'button',
      class: 'docx-dialog__button',
      'data-docx-part': 'cancel',
      onClick: () => widget.cancel(),
    },
    content: () => t('common.cancel'),
  })
);

/** Cancel and Apply row. @public */
export const ContentControlWidgetFooter = definePart(
  'DocxEditorContentControlWidgetFooter',
  'div',
  () => ({
    wiring: { class: 'docx-dialog__footer', 'data-docx-part': 'footer' },
    content: () => [h(ContentControlWidgetCancel), h(ContentControlWidgetApply)],
  })
);
