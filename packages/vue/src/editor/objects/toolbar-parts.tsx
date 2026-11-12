// The toolbar form of the shape and chart parts: the same parts with `variant="compact"`, keyed
// by slot, so `DocxEditor.Toolbar` draws the contextual `shape` and `chart` groups from
// `CHROME_GROUPS` and a host can override each slot like any other toolbar slot.

import { defineComponent, h, type Component } from 'vue';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { OBJECT_SLOT_PARTS } from './pane-sections';
import type { ObjectSlotId } from './object-controls';

/** The compact part of an object slot. */
function compactPart(slot: ObjectSlotId): Component {
  const Part = OBJECT_SLOT_PARTS[slot];
  return defineComponent({
    name: 'ToolbarObjectPart',
    props: { hidden: { type: Boolean, default: false } },
    setup(props) {
      return () => h(Part, { variant: 'compact', hidden: props.hidden });
    },
  });
}

/** The toolbar parts of every shape and chart slot. */
export const OBJECT_TOOLBAR_PARTS: Partial<Record<ChromeSlotId, Component>> = Object.fromEntries(
  (Object.keys(OBJECT_SLOT_PARTS) as ObjectSlotId[]).map((slot) => [slot, compactPart(slot)])
);
