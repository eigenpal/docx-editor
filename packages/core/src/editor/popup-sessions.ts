/** Priority of an editor-owned popup renderer. @public */
export interface PopupChromeRegistrationOptions {
  /** Use only when no manually registered renderer exists. */
  readonly fallback?: boolean;
}
/**
 * A core-owned content-control value edit.
 *
 * `kind` names the widget that was pressed. A `checkbox` session carries the current state as
 * `'true'` / `'false'` and expects the opposite (or the same) back through `apply`; the
 * packaged pop-ups apply the toggle at once, so a host only sees it when it renders the
 * widget itself.
 * @public
 */
export interface ContentControlWidgetSession {
  readonly controlId: string;
  readonly kind: 'dropdown' | 'comboBox' | 'date' | 'checkbox';
  readonly items: readonly { readonly displayText: string; readonly value: string }[];
  readonly value: string;
  /** The editor's regional locale, for a date picker's month, weekday and first-day rules. */
  readonly locale: string;
  readonly anchor: HTMLElement | null;
  readonly signal: AbortSignal;
  canApply(): boolean;
  apply(value: string): boolean;
  cancel(): void;
}
/** Framework rendering for content-control value widgets. @public */
export interface ContentControlWidgetChromeHandlers {
  readonly onRequest?: (session: ContentControlWidgetSession) => void;
}
/** An invalid protected-field acknowledgement. @public */
export interface InvalidTextFormFieldSession {
  readonly type: 'number' | 'date';
  readonly signal: AbortSignal;
  /** Clear the unchanged invalid value, if the target still permits it. */
  acknowledge(): void;
  /** Dismiss without clearing the authored value. */
  cancel(): void;
}
/** Framework rendering for invalid protected-field acknowledgements. @public */
export interface InvalidTextFormFieldChromeHandlers {
  readonly onRequest?: (session: InvalidTextFormFieldSession) => void;
}
