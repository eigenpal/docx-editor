import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { isoDateOf, parseIsoDate, type CalendarDay } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { Slot } from '../toolbar/Slot';
import { useFormControlTranslate } from '../form-control-translate';
import { useContentControlWidget, type ContentControlWidgetEntry } from './context';

/**
 * Presentation overrides for a value pop-up part. @public
 *
 * Anything beyond these members reaches the rendered element, so a part takes an `id`, an
 * `aria-*` label or a `data-*` test hook. The part's own wiring wins every collision. Pass
 * `asChild` to own the element outright and keep its behavior.
 */
export interface DocxEditorContentControlWidgetPartProps {
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

type Wiring = Record<string, unknown> & { className: string; style?: CSSProperties };

/**
 * Render a part as its packaged element or, with `asChild`, through the host's element.
 *
 * `wiring` (handlers, roles, packaged classes) is spread first and the host's presentation
 * last, except that the packaged class is dropped under `asChild` so a design-system
 * element is not outranked by it.
 */
function part(
  tag: 'div' | 'button' | 'input',
  props: DocxEditorContentControlWidgetPartProps,
  wiring: Wiring,
  defaultChildren: ReactNode
): ReactNode {
  if (props.hidden) return null;
  const { children, asChild, className, style, hidden: _hidden, ...rest } = props;
  const content = children === undefined ? defaultChildren : children;
  if (asChild) {
    const { className: _packaged, style: packagedStyle, ...handlers } = wiring;
    return (
      <Slot
        {...rest}
        {...handlers}
        {...(className ? { className } : {})}
        style={{ ...packagedStyle, ...style }}
      >
        {content}
      </Slot>
    );
  }
  const Tag = tag as 'div';
  return (
    <Tag
      {...rest}
      {...wiring}
      className={[wiring.className, className].filter(Boolean).join(' ')}
      style={{ ...wiring.style, ...style }}
    >
      {content}
    </Tag>
  );
}

const stopPress = (event: { stopPropagation(): void }) => event.stopPropagation();

/** Month navigation row: previous, title, next. @public */
export function ContentControlWidgetHeader(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar-header', 'data-docx-part': 'header' },
    <>
      <ContentControlWidgetPreviousMonth />
      <ContentControlWidgetTitle />
      <ContentControlWidgetNextMonth />
    </>
  );
}

/** Steps the calendar back one month. @public */
export function ContentControlWidgetPreviousMonth(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-nav',
      'data-docx-part': 'previousMonth',
      'aria-label': t('contentControl.calendar.previousMonth'),
      onMouseDown: stopPress,
      onClick: widget.previousMonth,
    },
    '‹'
  );
}

/** Steps the calendar forward one month. @public */
export function ContentControlWidgetNextMonth(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-nav',
      'data-docx-part': 'nextMonth',
      'aria-label': t('contentControl.calendar.nextMonth'),
      onMouseDown: stopPress,
      onClick: widget.nextMonth,
    },
    '›'
  );
}

/** The month and year in view. @public */
export function ContentControlWidgetTitle(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  return part(
    'div',
    props,
    {
      className: 'docx-content-control-calendar-title',
      'data-docx-part': 'title',
      'aria-live': 'polite',
    },
    widget.calendar.title
  );
}

/** Seven weekday labels in the locale's order. @public */
export function ContentControlWidgetWeekdays(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar-weekdays', 'data-docx-part': 'weekdays' },
    widget.calendar.weekdays.map((label, index) => <span key={index}>{label}</span>)
  );
}

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
export function ContentControlWidgetDay({ day, ...props }: ContentControlWidgetDayProps) {
  const widget = useContentControlWidget();
  const roam = (event: KeyboardEvent<HTMLElement>) => {
    const step = ARROW_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const from = parseIsoDate(day.iso);
    if (!from) return;
    widget.focusDay(
      isoDateOf(new Date(from.getFullYear(), from.getMonth(), from.getDate() + step))
    );
  };
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-day',
      'data-docx-part': 'day',
      'data-iso': day.iso,
      role: 'gridcell',
      'aria-label': day.label,
      ...(day.selected ? { 'data-selected': '', 'aria-selected': true } : {}),
      ...(day.today ? { 'data-today': '' } : {}),
      ...(day.otherMonth ? { 'data-other-month': '' } : {}),
      disabled: !widget.isEnabled,
      onMouseDown: stopPress,
      onClick: () => widget.selectDay(day.iso),
      onKeyDown: roam,
    },
    String(day.day)
  );
}

/** The six-week grid of `Day` cells. @public */
export function ContentControlWidgetGrid(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Roving focus: after the grid renders (possibly a new month), land on the roamed-to day,
  // else the selected day, else today, else the first day of the month.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const target =
      (widget.focusIso
        ? grid.querySelector<HTMLElement>(`[data-iso="${widget.focusIso}"]`)
        : null) ??
      grid.querySelector<HTMLElement>('[data-selected]') ??
      grid.querySelector<HTMLElement>('[data-today]:not([data-other-month])') ??
      grid.querySelector<HTMLElement>('[data-docx-part="day"]:not([data-other-month])');
    target?.focus({ preventScroll: true });
  }, [widget.focusIso, widget.calendar]);
  return part(
    'div',
    props,
    {
      ref: gridRef,
      className: 'docx-content-control-calendar-grid',
      'data-docx-part': 'grid',
      role: 'grid',
    },
    widget.calendar.days.map((day) => <ContentControlWidgetDay key={day.iso} day={day} />)
  );
}

/** Commits the current local date. @public */
export function ContentControlWidgetToday(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-calendar-today',
      'data-docx-part': 'today',
      disabled: !widget.isEnabled,
      onMouseDown: stopPress,
      onClick: widget.selectToday,
    },
    t('contentControl.calendar.today')
  );
}

/** The whole date picker: header, weekdays, grid and Today. @public */
export function ContentControlWidgetCalendar(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-content-control-calendar', 'data-docx-part': 'calendar' },
    <>
      <ContentControlWidgetHeader />
      <ContentControlWidgetWeekdays />
      <ContentControlWidgetGrid />
      <div className="docx-content-control-calendar-footer">
        <ContentControlWidgetToday />
      </div>
    </>
  );
}

/** Props for one list entry. @public */
export interface ContentControlWidgetItemProps extends DocxEditorContentControlWidgetPartProps {
  item: ContentControlWidgetEntry;
}

/** One dropdown or combo-box entry; a press commits its value. @public */
export function ContentControlWidgetItem({ item, ...props }: ContentControlWidgetItemProps) {
  const widget = useContentControlWidget();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-content-control-menu-item',
      'data-docx-part': 'item',
      'data-value': item.value,
      role: 'option',
      'aria-selected': widget.value === item.value,
      disabled: !widget.isEnabled,
      onMouseDown: stopPress,
      onClick: () => widget.apply(item.value),
    },
    item.displayText
  );
}

/** The list of `Item` entries the control declares. @public */
export function ContentControlWidgetList(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  return part(
    'div',
    props,
    { className: 'docx-content-control-menu-list', 'data-docx-part': 'list', role: 'listbox' },
    widget.items.map((item, index) => <ContentControlWidgetItem key={index} item={item} />)
  );
}

/** Free-text entry for a combo box; Enter commits. @public */
export function ContentControlWidgetInput(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'input',
    props,
    {
      type: 'text',
      className: 'docx-content-control-menu-input',
      'data-docx-part': 'input',
      'aria-label': t(`contentControl.types.${widget.kind}`),
      value: widget.value,
      onMouseDown: stopPress,
      onChange: (event: { target: { value: string } }) => widget.setValue(event.target.value),
    },
    undefined
  );
}

/** The engine refused the last value. @public */
export function ContentControlWidgetError(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  if (!widget.refused) return null;
  return part(
    'div',
    props,
    { className: 'docx-content-control-widget-error', 'data-docx-part': 'error', role: 'alert' },
    t('disabledReason.invalidValue')
  );
}

/** Commits the draft value. @public */
export function ContentControlWidgetApply(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-dialog__button docx-dialog__button--primary',
      'data-docx-part': 'apply',
      disabled: !widget.isEnabled,
      onClick: () => widget.apply(),
    },
    t('common.apply')
  );
}

/** Closes without a write. @public */
export function ContentControlWidgetCancel(props: DocxEditorContentControlWidgetPartProps) {
  const widget = useContentControlWidget();
  const t = useFormControlTranslate();
  return part(
    'button',
    props,
    {
      type: 'button',
      className: 'docx-dialog__button',
      'data-docx-part': 'cancel',
      onClick: widget.cancel,
    },
    t('common.cancel')
  );
}

/** Cancel and Apply row. @public */
export function ContentControlWidgetFooter(props: DocxEditorContentControlWidgetPartProps) {
  return part(
    'div',
    props,
    { className: 'docx-dialog__footer', 'data-docx-part': 'footer' },
    <>
      <ContentControlWidgetCancel />
      <ContentControlWidgetApply />
    </>
  );
}
