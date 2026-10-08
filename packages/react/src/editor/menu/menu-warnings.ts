// Development warnings for menu and context-menu compositions whose overrides do nothing
// or use a deprecated spelling. Each message prints once, and never in a production build.

import { isDevelopment } from '../../lib/is-development';

const printed = new Set<string>();

/** Print `message` once per page, in development builds only. */
export function menuDevWarning(message: string): void {
  if (!isDevelopment() || printed.has(message)) return;
  printed.add(message);
  console.warn(`[docx-editor] ${message}`);
}

/** A menu row named by the deprecated `slot` prop instead of `slotId`. */
export function warnDeprecatedSlotProp(slot: string): void {
  menuDevWarning(
    `Menu.Item and ContextMenu.Slot take the slot id as slotId. slot="${slot}" still works ` +
      `in this release; write slotId="${slot}".`
  );
}

/** The context-menu row that used to answer to `review.comments`. */
export function warnRenamedContextRow(from: string, to: string): void {
  menuDevWarning(
    `The context-menu row "${from}" is now "${to}". The old id still names it in this ` +
      `release; use "${to}".`
  );
}

/** A `hidden` override whose id matches no packaged row, so it removes nothing. */
export function warnUnmatchedHiddenRow(id: string): void {
  menuDevWarning(
    `A hidden context-menu override names "${id}", but no packaged row has that id, so ` +
      `nothing is removed.`
  );
}
