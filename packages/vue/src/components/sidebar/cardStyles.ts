// Re-export the canonical card chrome from core. Vue's CSSProperties
// shape accepts the numeric `borderRadius: 8` values from the core
// table without conversion.
import type { CSSProperties } from 'vue';
import {
  CARD_STYLE_COLLAPSED as CORE_COLLAPSED,
  CARD_STYLE_EXPANDED as CORE_EXPANDED,
} from '@eigenpal/docx-editor-core/utils/cardStyles';

export const CARD_STYLE_COLLAPSED = CORE_COLLAPSED as CSSProperties;
export const CARD_STYLE_EXPANDED = CORE_EXPANDED as CSSProperties;
