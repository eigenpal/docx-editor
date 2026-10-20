import {
  defineComponent,
  h,
  onMounted,
  ref,
  watch,
  type CSSProperties,
  type PropType,
  type VNodeChild,
} from 'vue';
import {
  calendarMonthNames,
  calendarDateForKey,
  calendarDateText,
  type CalendarDay,
} from '@docx-editor.dev/core/editor';
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
  [attribute: `aria-${string}`]: unknown;
}

const partProps = {
  class: { type: String, default: undefined },
  className: { type: String, default: undefined },
  style: { type: Object as PropType<CSSProperties>, default: undefined },
  hidden: { type: Boolean, default: undefined },
  asChild: { type: Boolean, default: undefined },
  children: { type: [Object, Array, String] as PropType<DocxEditorChildren>, default: undefined },
} as const;

type Wiring = Record<string, unknown> & {
  class: string;
  style?: CSSProperties;
};

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
  tag: 'div' | 'button' | 'input' | 'select',
  props: DocxEditorContentControlWidgetPartProps,
  attrs: Record<string, unknown>,
  slotContent: VNodeChild | undefined,
  render: PartRender
): VNodeChild {
  if (props.hidden) return null;
  const body = slotContent ?? props.children ?? render.content();
  const hostClass = [props.class, props.className].filter(Boolean).join(' ') || undefined;
  // Presentation attributes the props type advertises win over the packaged defaults;
  // handlers, roles and state stay the part's own.
  const presentation = Object.fromEntries(
    ['id', 'title', 'aria-label']
      .filter((name) => attrs[name] !== undefined)
      .map((name) => [name, attrs[name]])
  );
  if (props.asChild) {
    const { class: _packaged, style: packagedStyle, ...handlers } = render.wiring;
    return h(
      Slot,
      {
        ...attrs,
        ...handlers,
        ...presentation,
        class: hostClass,
        style: { ...packagedStyle, ...props.style },
      },
      () => body
    );
  }
  return h(
    tag,
    {
      ...attrs,
      ...render.wiring,
      ...presentation,
      class: mergeHostClass(render.wiring.class, hostClass),
      style: { ...render.wiring.style, ...props.style },
    },
    tag === 'input' ? undefined : (body ?? undefined)
  );
}

function definePart(
  name: string,
  tag: 'div' | 'button' | 'input' | 'select',
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

/** Month navigation row with month and year controls. @public */
export const ContentControlWidgetHeader = definePart(
  'DocxEditorContentControlWidgetHeader',
  'div',
  () => ({
    wiring: { class: 'docx-content-control-calendar-header', 'data-docx-part': 'header' },
    content: () => [
      h(ContentControlWidgetPreviousMonth),
      h(ContentControlWidgetNavigation),
      h(ContentControlWidgetNextMonth),
      h(ContentControlWidgetTitle, { className: 'docx-content-control-calendar-announcement' }),
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

/** One calendar cell; a press commits that date, arrow keys roam the grid. @public */
export const ContentControlWidgetDay = defineComponent({
  name: 'DocxEditorContentControlWidgetDay',
  inheritAttrs: false,
  props: { ...partProps, day: { type: Object as PropType<CalendarDay>, required: true } },
  setup(props, { slots, attrs }) {
    const widget = useContentControlWidget();
    const roam = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const next = calendarDateForKey(
        props.day.iso,
        event.key,
        widget.session.value.locale,
        event.shiftKey
      );
      if (!next) return;
      event.preventDefault();
      widget.focusDay(next);
    };
    return () => {
      const day = props.day;
      const focused =
        widget.calendar.value.days.find((cell) => cell.iso === widget.focusIso.value) ??
        widget.calendar.value.days.find((cell) => cell.selected) ??
        widget.calendar.value.days.find((cell) => cell.today && !cell.otherMonth) ??
        widget.calendar.value.days.find((cell) => !cell.otherMonth);
      return renderPart('button', props, attrs, slots.default?.(), {
        wiring: {
          type: 'button',
          class: 'docx-content-control-calendar-day',
          'data-docx-part': 'day',
          'data-iso': day.iso,
          role: 'gridcell',
          tabindex: day.iso === focused?.iso ? 0 : -1,
          'aria-label': day.label,
          ...(day.selected ? { 'data-selected': '', 'aria-selected': 'true' } : {}),
          'aria-current': day.today ? 'date' : undefined,
          'aria-selected': day.selected,
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
      // Month navigation keeps focus on its button, so repeated Enter presses keep paging.
      if (
        element.ownerDocument.activeElement?.closest(
          '[data-docx-part=previousMonth],[data-docx-part=nextMonth],[data-docx-part=month],[data-docx-part=year]'
        )
      )
        return;
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
          'aria-label': widget.calendar.value.title,
        },
        content: () =>
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} role="row" class="docx-content-control-calendar-week">
              {widget.calendar.value.days
                .slice(index * 7, index * 7 + 7)
                .map((day) => h(ContentControlWidgetDay, { key: day.iso, day }))}
            </div>
          )),
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

/** The whole date picker, including regional date entry and actions. @public */
export const ContentControlWidgetCalendar = definePart(
  'DocxEditorContentControlWidgetCalendar',
  'div',
  () => ({
    wiring: { class: 'docx-content-control-calendar', 'data-docx-part': 'calendar' },
    content: () => [
      h(ContentControlWidgetHeader),
      h(ContentControlWidgetWeekdays),
      h(ContentControlWidgetGrid),
      h('div', { class: 'docx-content-control-calendar-entry', 'data-docx-part': 'dateEntry' }, [
        h(ContentControlWidgetToday),
        h(ContentControlWidgetInput),
      ]),
      h(ContentControlWidgetError),
      h(ContentControlWidgetFooter),
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
          tabindex:
            widget.items.value.findIndex((entry) => entry.value === widget.value.value) < 0
              ? widget.items.value[0] === props.item
                ? 0
                : -1
              : widget.value.value === props.item.value
                ? 0
                : -1,
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
  (widget, t) => ({
    wiring: {
      class: 'docx-content-control-menu-list',
      'data-docx-part': 'list',
      role: 'listbox',
      id: widget.listId,
      'aria-label': t(`contentControl.types.${widget.kind.value}`),
    },
    content: () =>
      widget.kind.value === 'buildingBlockGallery' && widget.items.value.length === 0 ? (
        <div
          class="docx-content-control-menu-empty"
          data-docx-part="empty"
          role="note"
          tabindex={0}
        >
          {t('contentControl.gallery.empty')}
        </div>
      ) : (
        widget.items.value.map((item, index) => h(ContentControlWidgetItem, { key: index, item }))
      ),
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
      value: widget.kind.value === 'date' ? widget.dateText.value : widget.value.value,
      placeholder:
        widget.kind.value === 'date'
          ? calendarDateText('2006-11-22', widget.session.value.locale)
          : undefined,
      'aria-invalid': widget.refused.value || undefined,
      role: widget.kind.value === 'comboBox' ? 'combobox' : undefined,
      'aria-expanded': widget.kind.value === 'comboBox' ? true : undefined,
      'aria-controls': widget.kind.value === 'comboBox' ? widget.listId : undefined,
      'aria-autocomplete': widget.kind.value === 'comboBox' ? 'list' : undefined,
      onKeydown: (event: KeyboardEvent) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (widget.kind.value === 'date') widget.applyDateText();
        else widget.apply();
      },
      onMousedown: stopPress,
      onInput: (event: Event) =>
        (widget.kind.value === 'date' ? widget.setDateText : widget.setValue)(
          (event.target as HTMLInputElement).value
        ),
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
      onClick: () => (widget.kind.value === 'date' ? widget.applyDateText() : widget.apply()),
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

/** Month selector and numeric year entry. @public */
export const ContentControlWidgetNavigation = definePart(
  'DocxEditorContentControlWidgetNavigation',
  'div',
  () => ({
    wiring: { class: 'docx-content-control-calendar-navigation', 'data-docx-part': 'navigation' },
    content: () => [h(ContentControlWidgetMonth), h(ContentControlWidgetYear)],
  })
);
/** Jump directly to a month. @public */
export const ContentControlWidgetMonth = definePart(
  'DocxEditorContentControlWidgetMonth',
  'select',
  (widget, t) => ({
    wiring: {
      class: 'docx-content-control-calendar-month',
      'data-docx-part': 'month',
      'aria-label': t('contentControl.calendar.month'),
      value: widget.calendar.value.month,
      onChange: (event: Event) =>
        widget.showMonth(
          widget.calendar.value.year,
          Number((event.target as HTMLSelectElement).value)
        ),
    },
    content: () =>
      calendarMonthNames(widget.session.value.locale).map((label, index) =>
        h('option', { value: index }, label)
      ),
  })
);
/** Jump directly to a four-digit year. @public */
export const ContentControlWidgetYear = definePart(
  'DocxEditorContentControlWidgetYear',
  'input',
  (widget, t) => ({
    wiring: {
      type: 'number',
      min: 100,
      max: 9999,
      class: 'docx-content-control-calendar-year',
      'data-docx-part': 'year',
      'aria-label': t('contentControl.calendar.year'),
      key: widget.calendar.value.year,
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          (event.currentTarget as HTMLInputElement).blur();
        }
      },
      value: widget.calendar.value.year,
      onChange: (event: Event) => {
        const input = event.target as HTMLInputElement;
        const year = Number(input.value);
        // A refused year snaps the field back to the month in view, as the engine menu does,
        // so the box never shows a year the grid is not on.
        if (!Number.isInteger(year) || year < 100 || year > 9999) {
          input.value = String(widget.calendar.value.year);
          return;
        }
        widget.showMonth(year, widget.calendar.value.month);
      },
    },
    content: () => null,
  })
);

/** Props for the picture file input. @public */
export interface ContentControlWidgetPictureProps extends DocxEditorContentControlWidgetPartProps {
  /** Open the browser's file dialog as soon as the part mounts. Defaults to true. */
  autoOpen?: boolean;
}

/**
 * The file input of a picture session. A chosen file replaces the control's image through
 * the session; closing the dialog without a file cancels the session. @public
 */
export const ContentControlWidgetPicture = defineComponent({
  name: 'DocxEditorContentControlWidgetPicture',
  inheritAttrs: false,
  props: { ...partProps, autoOpen: { type: Boolean, default: undefined } },
  setup(props, { slots, attrs }) {
    const widget = useContentControlWidget();
    const t = useFormControlTranslate();
    const input = ref<HTMLInputElement | null>(null);
    onMounted(() => {
      if (props.autoOpen !== false) input.value?.click();
    });
    return () =>
      renderPart('input', props, attrs, slots.default?.(), {
        wiring: {
          ref: input,
          type: 'file',
          accept: widget.accept,
          class: 'docx-content-control-picture-input',
          'data-docx-part': 'picture',
          'aria-label': t('contentControl.types.picture'),
          'aria-invalid': widget.refused.value || undefined,
          onMousedown: stopPress,
          onCancel: () => widget.cancel(),
          onChange: (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            (event.target as HTMLInputElement).value = '';
            if (file) void widget.replaceImage(file);
          },
        },
        content: () => null,
      });
  },
});
