import { DEFAULT_IMAGE_RESOURCE_LIMITS } from '@docx-editor.dev/core/store';
import {
  useId,
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
  CONTENT_CONTROL_PICTURE_ACCEPT,
  calendarMonth,
  calendarDateText,
  calendarDateFromText,
  createContentControlListNavigation,
  type ContentControlListNavigation,
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
  /** Numeric regional date entry, separate from the ISO value. */
  readonly dateText: Readonly<Ref<string>>;
  setDateText(text: string): void;
  applyDateText(): boolean;
  /** Jump to a month without committing. Month is zero-based; year is 100–9999. */
  showMonth(year: number, month: number): void;
  /** ID shared by the combo input and listbox. */
  readonly listId: string;
  /** Shared typeahead and roving-focus behavior for replacement lists. */
  readonly listNavigation: ContentControlListNavigation;
  /** Picture sessions: the image types `replaceImage` takes, as a file input `accept` list. */
  readonly accept: string;
  /**
   * Picture sessions: replace the control's image from a file or its bytes. The engine
   * checks the format and size; false (and `refused`) when it declines or the session is
   * not a picture session.
   */
  replaceImage(source: Blob | Uint8Array): Promise<boolean>;
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
  const listId = `docx-cc-list-${useId()}`;
  const value = ref(initialValue(session.value));
  const refused = ref(false);
  const dateText = ref(calendarDateText(session.value.value, session.value.locale));
  // Rebuilt per session so a live `locale` change re-collates typeahead, as the React twin and
  // the engine menu do; the public member stays one stable object that delegates.
  let navigation = createContentControlListNavigation(session.value.locale);
  const listNavigation: ContentControlListNavigation = {
    keyDown: (event, root) => navigation.keyDown(event, root),
    reset: () => navigation.reset(),
  };
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
    dateText.value = calendarDateText(current.value, current.locale);
    navigation = createContentControlListNavigation(current.locale);
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
    dateText,
    setDateText: (text) => {
      dateText.value = text;
      refused.value = false;
    },
    applyDateText: () => {
      const iso = calendarDateFromText(dateText.value, session.value.locale);
      if (!iso) {
        refused.value = true;
        return false;
      }
      return apply(iso);
    },
    showMonth: (year, month) => {
      if (
        !Number.isInteger(year) ||
        year < 100 ||
        year > 9999 ||
        !Number.isInteger(month) ||
        month < 0 ||
        month > 11
      )
        return;
      view.value = { year, month };
      focusIso.value = null;
    },
    listNavigation,
    listId,
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
    accept: CONTENT_CONTROL_PICTURE_ACCEPT,
    replaceImage: async (source) => {
      const current = session.value;
      if (!current.replaceImage) {
        refused.value = true;
        return false;
      }
      try {
        const size = source instanceof Uint8Array ? source.byteLength : source.size;
        if (!current.canApply() || size > DEFAULT_IMAGE_RESOURCE_LIMITS.maxEncodedBytes) {
          refused.value = true;
          return false;
        }
        const bytes =
          source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
        const accepted = await current.replaceImage(bytes);
        refused.value = !accepted;
        return accepted;
      } catch {
        refused.value = true;
        return false;
      }
    },
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
