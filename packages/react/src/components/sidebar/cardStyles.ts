// Re-export the canonical card chrome from core. React's CSSProperties
// is structurally compatible with the loose Record shape core uses.
import type { CSSProperties } from 'react';
import {
  CARD_STYLE_COLLAPSED as CORE_COLLAPSED,
  CARD_STYLE_EXPANDED as CORE_EXPANDED,
} from '@eigenpal/docx-editor-core/utils/cardStyles';

export const CARD_STYLE_COLLAPSED = CORE_COLLAPSED as CSSProperties;
export const CARD_STYLE_EXPANDED = CORE_EXPANDED as CSSProperties;
