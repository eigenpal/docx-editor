// Development warning for a `fieldDate` prop that changes after the editor exists.
//
// The editor reads `fieldDate` once, when it is created. The comparison is by time, not
// identity, so an inline `new Date(...)` re-created on every render with the same time does
// not warn. A changed time is ignored, and this says so once, never in a production build.

import { isDevelopment } from '../lib/is-development';

let printed = false;

/**
 * True for a `Date`, also one made in another window or frame, where `instanceof Date` is
 * false. `Date.prototype.getTime` throws for any other value.
 */
export function isDateValue(value: unknown): value is Date {
  try {
    Date.prototype.getTime.call(value);
    return true;
  } catch {
    return false;
  }
}

/** Forget that the warning printed, so a test can watch it again. @internal */
export function resetFieldDateWarningForTests(): void {
  printed = false;
}

/** Warn once when `fieldDate` differs in time from the one the editor was created with. */
export function warnFieldDateChanged(created: Date | undefined, current: Date | undefined): void {
  if (Object.is(created?.getTime(), current?.getTime()) || printed || !isDevelopment()) return;
  printed = true;
  console.warn(
    '[docx-editor] fieldDate changed after the editor was created, so the change is ' +
      'ignored. The editor reads fieldDate once; create a new editor to change it.'
  );
}
