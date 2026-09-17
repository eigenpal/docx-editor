// The engine's own value pop-ups for dropdown, combo-box and date controls: what a control
// gets when no host renderer took the widget session. Framework-free DOM over the shared
// calendar model, styled by the `docx-content-control-menu` / `-calendar` rules in the core
// stylesheet, which is also what the adapter defaults reuse so one theme covers both.

import type { TranslationKey } from '@docx-editor.dev/i18n';
import {
  calendarMonth,
  isoDateOf,
  parseIsoDate,
  shiftMonth,
  type CalendarDay,
} from './content-control-calendar.ts';
import { textFormTranslate } from './text-form-field-translations.ts';

/** Where a pop-up anchors, in pages-layer pixels. */
export interface ContentControlMenuAnchor {
  /** Left edge of the control's first fragment — the pop-up lines up under it, like Word. */
  readonly left: number;
  /** Bottom edge of that fragment. */
  readonly top: number;
  /** Horizontal extent of the page sheet the control sits on; the pop-up stays inside it. */
  readonly sheetLeft: number;
  readonly sheetRight: number;
}

export interface ContentControlMenuHost {
  readonly document: Document;
  readonly locale: () => string;
  readonly translate: ((key: TranslationKey) => string) | undefined;
  /** Commit a value and close; the surface owns the write and the refusal path. */
  readonly setValue: (controlId: string, value: string) => void;
  /** Remove the menu and clear the widget's open state. */
  readonly close: (menu: HTMLElement) => void;
}

function menuShell(host: ContentControlMenuHost, controlId: string): HTMLElement {
  const menu = host.document.createElement('div');
  menu.className = 'docx-content-control-menu';
  menu.dataset.docxMarker = '';
  menu.dataset.docxCcId = controlId;
  menu.setAttribute('contenteditable', 'false');
  menu.style.position = 'absolute';
  menu.style.zIndex = '20';
  menu.style.pointerEvents = 'auto';
  // A press inside the pop-up is the pop-up's: the pages layer must not treat it as a caret
  // press (which prevents the default and swallows the compatibility mouse events).
  menu.addEventListener('pointerdown', (event) => event.stopPropagation());
  // Inputs and buttons live inside the editable pages layer. Their events belong to the
  // pop-up: Enter must not split a paragraph, and typing must not edit the document.
  for (const type of [
    'keydown',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'copy',
    'cut',
    'paste',
  ]) {
    menu.addEventListener(type, (event) => event.stopPropagation());
  }
  return menu;
}

/**
 * Place a pop-up under its control's left edge and keep it on the sheet.
 *
 * Right-aligning to the widget hung the calendar off the page's left margin for any control
 * near the start of a line. The pop-up is appended first so its width can be read back;
 * an environment that reports no width simply leaves it at the anchor.
 */
export function placeContentControlMenu(
  menu: HTMLElement,
  layer: HTMLElement,
  anchor: ContentControlMenuAnchor | null
): void {
  if (!anchor) {
    layer.append(menu);
    return;
  }
  menu.style.left = `${anchor.left}px`;
  menu.style.top = `${anchor.top}px`;
  layer.append(menu);
  const width = menu.offsetWidth;
  if (width <= 0) return;
  const overflow = anchor.left + width - anchor.sheetRight;
  if (overflow > 0) {
    menu.style.left = `${Math.max(anchor.sheetLeft, anchor.left - overflow)}px`;
  }
}

/** A dropdown / combo-box list; `items` come from the file's `w:listItem` entries. */
export function buildContentControlListMenu(
  host: ContentControlMenuHost,
  controlId: string,
  kind: 'dropdown' | 'comboBox',
  items: readonly { readonly displayText: string; readonly value: string }[],
  alias: string | undefined
): HTMLElement {
  const menu = menuShell(host, controlId);
  menu.setAttribute('role', 'listbox');
  if (alias) menu.setAttribute('aria-label', alias);
  menu.addEventListener('keydown', (event) => {
    if (event.isComposing || event.target instanceof HTMLInputElement) return;
    const options = [...menu.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const index = options.indexOf(host.document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % options.length
        : event.key === 'ArrowUp'
          ? (index - 1 + options.length) % options.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    options[next]?.focus();
  });
  for (const item of items) {
    const option = host.document.createElement('button');
    option.type = 'button';
    option.className = 'docx-content-control-menu-item';
    option.dataset.docxMarker = '';
    option.setAttribute('contenteditable', 'false');
    option.setAttribute('role', 'option');
    option.textContent = item.displayText;
    option.addEventListener('mousedown', (event) => event.stopPropagation());
    option.addEventListener('click', () => {
      host.close(menu);
      host.setValue(controlId, item.value);
    });
    menu.append(option);
  }
  if (kind === 'comboBox') {
    const free = host.document.createElement('input');
    free.type = 'text';
    free.className = 'docx-content-control-menu-input';
    free.dataset.docxMarker = '';
    free.setAttribute('contenteditable', 'false');
    if (alias) free.setAttribute('aria-label', alias);
    free.addEventListener('mousedown', (event) => event.stopPropagation());
    free.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      host.close(menu);
      host.setValue(controlId, free.value);
    });
    menu.append(free);
  }
  return menu;
}

/**
 * Move keyboard focus into a calendar: the roamed-to day, else the selected day, else today,
 * else the first day of the month. Safe to call before the menu is attached (no-op then), so
 * the surface calls it again once the pop-up is placed.
 */
export function focusContentControlCalendar(menu: HTMLElement, focusIso?: string | null): void {
  const target =
    (focusIso ? menu.querySelector<HTMLElement>(`[data-iso="${focusIso}"]`) : null) ??
    menu.querySelector<HTMLElement>('[data-selected]') ??
    menu.querySelector<HTMLElement>('[data-today]:not([data-other-month])') ??
    menu.querySelector<HTMLElement>('.docx-content-control-calendar-day:not([data-other-month])');
  for (const day of menu.querySelectorAll<HTMLElement>('[data-iso]')) {
    day.tabIndex = day === target ? 0 : -1;
  }
  target?.focus({ preventScroll: true });
}

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * The date picker: month header, weekday row in the locale's order, a six-week grid and a
 * Today button, matching Word's picker. Arrow keys roam the grid and cross month edges; a
 * day press commits an ISO date through the surface.
 */
export function buildContentControlCalendar(
  host: ContentControlMenuHost,
  controlId: string,
  authoredValue: string | undefined,
  alias: string | undefined
): HTMLElement {
  const t = textFormTranslate(host.translate);
  const menu = menuShell(host, controlId);
  menu.classList.add('docx-content-control-calendar');
  menu.setAttribute('role', 'dialog');
  if (alias) menu.setAttribute('aria-label', alias);
  const selected = authoredValue ? parseIsoDate(authoredValue) : null;
  const selectedIso = selected ? isoDateOf(selected) : null;
  const today = new Date();
  let view = { year: (selected ?? today).getFullYear(), month: (selected ?? today).getMonth() };
  let focusIso: string | null = null;

  const commit = (iso: string): void => {
    host.close(menu);
    host.setValue(controlId, iso);
  };
  const stopPress = (node: HTMLElement): void => {
    node.addEventListener('mousedown', (event) => event.stopPropagation());
  };
  const render = (): void => {
    const focusedNav = (host.document.activeElement as HTMLElement | null)?.dataset.docxCalendarNav;
    const month = calendarMonth(view.year, view.month, {
      locale: host.locale(),
      selected: selectedIso,
      today,
    });
    const header = host.document.createElement('div');
    header.className = 'docx-content-control-calendar-header';
    const previous = host.document.createElement('button');
    previous.type = 'button';
    previous.className = 'docx-content-control-calendar-nav';
    previous.dataset.docxCalendarNav = 'previous';
    previous.textContent = '‹';
    previous.setAttribute('aria-label', t('contentControl.calendar.previousMonth'));
    const title = host.document.createElement('div');
    title.className = 'docx-content-control-calendar-title';
    title.setAttribute('aria-live', 'polite');
    title.textContent = month.title;
    const next = host.document.createElement('button');
    next.type = 'button';
    next.className = 'docx-content-control-calendar-nav';
    next.dataset.docxCalendarNav = 'next';
    next.textContent = '›';
    next.setAttribute('aria-label', t('contentControl.calendar.nextMonth'));
    stopPress(previous);
    stopPress(next);
    previous.addEventListener('click', () => {
      view = shiftMonth(view.year, view.month, -1);
      focusIso = null;
      render();
    });
    next.addEventListener('click', () => {
      view = shiftMonth(view.year, view.month, 1);
      focusIso = null;
      render();
    });
    header.append(previous, title, next);

    const weekdays = host.document.createElement('div');
    weekdays.className = 'docx-content-control-calendar-weekdays';
    for (const label of month.weekdays) {
      const weekday = host.document.createElement('span');
      weekday.textContent = label;
      weekdays.append(weekday);
    }

    const grid = host.document.createElement('div');
    grid.className = 'docx-content-control-calendar-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', month.title);
    for (let index = 0; index < month.days.length; index += 7) {
      const row = host.document.createElement('div');
      row.className = 'docx-content-control-calendar-week';
      row.setAttribute('role', 'row');
      for (const day of month.days.slice(index, index + 7)) row.append(dayButton(day));
      grid.append(row);
    }

    const footer = host.document.createElement('div');
    footer.className = 'docx-content-control-calendar-footer';
    const todayButton = host.document.createElement('button');
    todayButton.type = 'button';
    todayButton.className = 'docx-content-control-calendar-today';
    todayButton.textContent = t('contentControl.calendar.today');
    stopPress(todayButton);
    todayButton.addEventListener('click', () => commit(isoDateOf(today)));
    footer.append(todayButton);

    menu.replaceChildren(header, weekdays, grid, footer);
    focusContentControlCalendar(menu, focusIso);
    if (focusedNav === 'previous') previous.focus({ preventScroll: true });
    if (focusedNav === 'next') next.focus({ preventScroll: true });
  };
  const dayButton = (day: CalendarDay): HTMLElement => {
    const button = host.document.createElement('button');
    button.type = 'button';
    button.className = 'docx-content-control-calendar-day';
    button.textContent = String(day.day);
    button.dataset.iso = day.iso;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', day.label);
    if (day.otherMonth) button.dataset.otherMonth = '';
    if (day.selected) {
      button.dataset.selected = '';
      button.setAttribute('aria-selected', 'true');
    }
    if (day.today) button.dataset.today = '';
    stopPress(button);
    button.addEventListener('click', () => commit(day.iso));
    button.addEventListener('keydown', (event) => {
      const step = ARROW_STEPS[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const from = parseIsoDate(day.iso)!;
      const target = new Date(from.getFullYear(), from.getMonth(), from.getDate() + step);
      focusIso = isoDateOf(target);
      if (target.getFullYear() !== view.year || target.getMonth() !== view.month) {
        view = { year: target.getFullYear(), month: target.getMonth() };
        render();
        return;
      }
      focusContentControlCalendar(menu, focusIso);
    });
    return button;
  };
  render();
  return menu;
}
