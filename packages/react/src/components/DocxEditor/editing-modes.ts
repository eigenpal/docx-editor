/**
 * EditorMode union + the catalog the editing-mode dropdown renders.
 * Lives next to DocxEditor.tsx so the dropdown component and the parent
 * forwardRef body share one source of truth.
 */

import type { TranslationKey } from '../../i18n';

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

export type EditingModeDef = {
  value: EditorMode;
  labelKey: TranslationKey;
  icon: string;
  descKey: TranslationKey;
};

export const EDITING_MODES: readonly EditingModeDef[] = [
  {
    value: 'editing',
    labelKey: 'editor.editing',
    icon: 'edit_note',
    descKey: 'editor.editingDescription',
  },
  {
    value: 'suggesting',
    labelKey: 'editor.suggesting',
    icon: 'rate_review',
    descKey: 'editor.suggestingDescription',
  },
  {
    value: 'viewing',
    labelKey: 'editor.viewing',
    icon: 'visibility',
    descKey: 'editor.viewingDescription',
  },
];
