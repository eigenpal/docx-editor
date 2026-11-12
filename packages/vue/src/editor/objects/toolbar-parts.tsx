// The toolbar form of the shape and chart parts: the parts themselves, keyed by slot.
// `DocxEditorToolbar` provides the compact variant to every part inside it, so the contextual
// `shape` and `chart` groups from `CHROME_GROUPS` render as toolbar controls, and a host part
// placed in the toolbar (`h(DocxEditor.ShapeFill, { className: 'mine' })`) replaces its slot and
// renders compact too.

import type { Component } from 'vue';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { OBJECT_SLOT_PARTS } from './pane-sections';

/** The toolbar parts of every shape and chart slot. */
export const OBJECT_TOOLBAR_PARTS: Partial<Record<ChromeSlotId, Component>> = OBJECT_SLOT_PARTS;
