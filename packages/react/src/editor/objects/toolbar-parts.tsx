// The toolbar form of the shape and chart parts: the same parts with `variant="compact"`, keyed
// by slot, so `DocxEditor.Toolbar` draws the contextual `shape` and `chart` groups from
// `CHROME_GROUPS` and a host can override each slot like any other toolbar slot.

import type { ReactElement } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { OBJECT_SLOT_PARTS } from './pane-sections';
import type { ObjectSlotId } from './object-controls';

type ToolbarPart = (props: { hidden?: boolean }) => ReactElement | null;

const cache = new Map<ObjectSlotId, ToolbarPart>();

/** The compact part of an object slot, created once per slot. */
function compactPart(slot: ObjectSlotId): ToolbarPart {
  let part = cache.get(slot);
  if (!part) {
    const Part = OBJECT_SLOT_PARTS[slot];
    part = (props: { hidden?: boolean }) => <Part variant="compact" {...props} />;
    cache.set(slot, part);
  }
  return part;
}

/** The toolbar parts of every shape and chart slot. */
export const OBJECT_TOOLBAR_PARTS: Partial<Record<ChromeSlotId, ToolbarPart>> = Object.fromEntries(
  (Object.keys(OBJECT_SLOT_PARTS) as ObjectSlotId[]).map((slot) => [slot, compactPart(slot)])
);
