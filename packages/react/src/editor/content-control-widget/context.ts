import { createContext, useCallback, useContext, useMemo, useState } from 'react';
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
 * Read it from `useContentControlWidget()` inside `DocxEditorContentControlWidget`, or from a
 * fully custom `popups.contentControlWidget` renderer that mounts the provider through the
 * packaged root. `value` is the draft; `apply()` commits it through the session, which the
 * engine validates. The calendar members drive the date picker: `calendar` is the month in
 * view, built for the session's locale.
 * @public
 */
export interface UseContentControlWidgetResult {
  readonly session: ContentControlWidgetSession;
  readonly kind: ContentControlWidgetSession['kind'];
  readonly items: readonly ContentControlWidgetEntry[];
  readonly value: string;
  setValue(value: string): void;
  /** The engine still accepts a write for this control. */
  readonly isEnabled: boolean;
  /** The last `apply()` was refused by the engine. */
  readonly refused: boolean;
  /** Commit `value`, or an explicit one; false when the engine refused it. */
  apply(value?: string): boolean;
  cancel(): void;
  readonly calendar: CalendarMonth;
  previousMonth(): void;
  nextMonth(): void;
  /** Commit one calendar day (`YYYY-MM-DD`). */
  selectDay(iso: string): boolean;
  /** Commit the current local date. */
  selectToday(): boolean;
  /** The day keyboard focus should land on after the grid renders, if any. */
  readonly focusIso: string | null;
  /** Move keyboard focus to a day, turning the month if it lies outside the view. */
  focusDay(iso: string): void;
}

const Context = createContext<UseContentControlWidgetResult | null>(null);

/** Provider for the parts; the packaged root mounts it. @internal */
export const ContentControlWidgetProvider = Context.Provider;

/** Draft state of the enclosing content-control value pop-up. @public */
export function useContentControlWidget(): UseContentControlWidgetResult {
  const context = useContext(Context);
  if (!context) {
    throw new globalThis.Error(
      'useContentControlWidget must be rendered inside DocxEditorContentControlWidget.'
    );
  }
  return context;
}

function initialValue(session: ContentControlWidgetSession): string {
  return session.kind === 'date'
    ? parseIsoDate(session.value)
      ? session.value.slice(0, 10)
      : ''
    : session.value;
}

/** Build the draft state for one session; remounted per session by the root. @internal */
export function useContentControlWidgetState(
  session: ContentControlWidgetSession
): UseContentControlWidgetResult {
  const [value, setValue] = useState(() => initialValue(session));
  const [refused, setRefused] = useState(false);
  const isEnabled = useEditorState(() => session.canApply());
  const selected = session.kind === 'date' ? parseIsoDate(session.value) : null;
  const [view, setView] = useState(() => {
    const start = selected ?? new Date();
    return { year: start.getFullYear(), month: start.getMonth() };
  });
  const apply = useCallback(
    (next?: string) => {
      const accepted = session.apply(next ?? value);
      setRefused(!accepted);
      return accepted;
    },
    [session, value]
  );
  const cancel = useCallback(() => session.cancel(), [session]);
  const calendar = useMemo(
    () =>
      calendarMonth(view.year, view.month, {
        locale: session.locale,
        selected: session.kind === 'date' ? session.value : null,
      }),
    [view, session]
  );
  const previousMonth = useCallback(
    () => setView((current) => shiftMonth(current.year, current.month, -1)),
    []
  );
  const nextMonth = useCallback(
    () => setView((current) => shiftMonth(current.year, current.month, 1)),
    []
  );
  const selectDay = useCallback((iso: string) => apply(iso), [apply]);
  const selectToday = useCallback(() => apply(isoDateOf(new Date())), [apply]);
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const focusDay = useCallback((iso: string) => {
    const date = parseIsoDate(iso);
    if (!date) return;
    setView({ year: date.getFullYear(), month: date.getMonth() });
    setFocusIso(isoDateOf(date));
  }, []);
  return useMemo(
    () => ({
      session,
      kind: session.kind,
      items: session.items,
      value,
      setValue,
      isEnabled,
      refused,
      apply,
      cancel,
      calendar,
      previousMonth,
      nextMonth,
      selectDay,
      selectToday,
      focusIso,
      focusDay,
    }),
    [
      session,
      value,
      isEnabled,
      refused,
      apply,
      cancel,
      calendar,
      previousMonth,
      nextMonth,
      selectDay,
      selectToday,
      focusIso,
      focusDay,
    ]
  );
}
