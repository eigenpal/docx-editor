import {
  computed,
  inject,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref,
} from 'vue';
import {
  calendarMonth,
  isoDateOf,
  parseIsoDate,
  shiftMonth,
  type CalendarMonth,
  type ContentControlWidgetSession,
} from '@docx-editor.dev/core/editor';
import { useEditorState } from '../useEditorState';

/** One selectable entry of a dropdown or combo-box control. @public */
export interface ContentControlWidgetEntry {
  readonly displayText: string;
  readonly value: string;
}

/**
 * The draft state a content-control value pop-up renders over.
 *
 * Read it from `useContentControlWidget()` inside `DocxEditorContentControlWidget`. `value`
 * is the draft; `apply()` commits it through the session, which the engine validates. The
 * calendar members drive the date picker: `calendar` is the month in view, built for the
 * session's locale. Reactive members are refs.
 * @public
 */
export interface UseContentControlWidgetResult {
  readonly session: Readonly<Ref<ContentControlWidgetSession>>;
  readonly kind: Readonly<Ref<ContentControlWidgetSession['kind']>>;
  readonly items: Readonly<Ref<readonly ContentControlWidgetEntry[]>>;
  readonly value: Readonly<Ref<string>>;
  setValue(value: string): void;
  /** The engine still accepts a write for this control. */
  readonly isEnabled: Readonly<Ref<boolean>>;
  /** The last `apply()` was refused by the engine. */
  readonly refused: Readonly<Ref<boolean>>;
  /** Commit `value`, or an explicit one; false when the engine refused it. */
  apply(value?: string): boolean;
  cancel(): void;
  readonly calendar: Readonly<Ref<CalendarMonth>>;
  previousMonth(): void;
  nextMonth(): void;
  /** Commit one calendar day (`YYYY-MM-DD`). */
  selectDay(iso: string): boolean;
  /** Commit the current local date. */
  selectToday(): boolean;
  /** The day keyboard focus should land on after the grid renders, if any. */
  readonly focusIso: Readonly<Ref<string | null>>;
  /** Move keyboard focus to a day, turning the month if it lies outside the view. */
  focusDay(iso: string): void;
}

const key: InjectionKey<UseContentControlWidgetResult> = Symbol('docx-content-control-widget');

/** Provide the widget state to the parts; the packaged root does this. @internal */
export function provideContentControlWidget(state: UseContentControlWidgetResult): void {
  provide(key, state);
}

/** Draft state of the enclosing content-control value pop-up. @public */
export function useContentControlWidget(): UseContentControlWidgetResult {
  const state = inject(key, null);
  if (!state) {
    throw new globalThis.Error(
      'useContentControlWidget must be used inside DocxEditorContentControlWidget.'
    );
  }
  return state;
}

function initialValue(session: ContentControlWidgetSession): string {
  return session.kind === 'date'
    ? parseIsoDate(session.value)
      ? session.value.slice(0, 10)
      : ''
    : session.value;
}

/** Build the draft state for a session ref; resets when the session changes. @internal */
export function useContentControlWidgetState(
  session: Readonly<Ref<ContentControlWidgetSession>>
): UseContentControlWidgetResult {
  const value = ref(initialValue(session.value));
  const refused = ref(false);
  const focusIso = ref<string | null>(null);
  const view = shallowRef({ year: 0, month: 0 });
  const resetView = (current: ContentControlWidgetSession) => {
    const selected = current.kind === 'date' ? parseIsoDate(current.value) : null;
    const start = selected ?? new Date();
    view.value = { year: start.getFullYear(), month: start.getMonth() };
  };
  resetView(session.value);
  watch(session, (current) => {
    value.value = initialValue(current);
    refused.value = false;
    focusIso.value = null;
    resetView(current);
  });
  const isEnabled = useEditorState(() => session.value.canApply(), Object.is, {
    extraDeps: () => session.value,
  });
  const apply = (next?: string): boolean => {
    const accepted = session.value.apply(next ?? value.value);
    refused.value = !accepted;
    return accepted;
  };
  const calendar = computed(() =>
    calendarMonth(view.value.year, view.value.month, {
      locale: session.value.locale,
      selected: session.value.kind === 'date' ? session.value.value : null,
    })
  );
  return {
    session,
    kind: computed(() => session.value.kind),
    items: computed(() => session.value.items),
    value,
    setValue: (next) => {
      value.value = next;
    },
    isEnabled,
    refused,
    apply,
    cancel: () => session.value.cancel(),
    calendar,
    previousMonth: () => {
      view.value = shiftMonth(view.value.year, view.value.month, -1);
      focusIso.value = null;
    },
    nextMonth: () => {
      view.value = shiftMonth(view.value.year, view.value.month, 1);
      focusIso.value = null;
    },
    selectDay: (iso) => apply(iso),
    selectToday: () => apply(isoDateOf(new Date())),
    focusIso,
    focusDay: (iso) => {
      const date = parseIsoDate(iso);
      if (!date) return;
      view.value = { year: date.getFullYear(), month: date.getMonth() };
      focusIso.value = isoDateOf(date);
    },
  };
}
