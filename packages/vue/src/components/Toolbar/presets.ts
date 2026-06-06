/**
 * Static option lists for the Vue Toolbar — default fonts, font-size
 * presets, paragraph-style presets, and line-spacing presets. Kept here
 * so Toolbar.vue stays under the file-size cap.
 */

import type { FontOption } from '@eigenpal/docx-editor-core/utils/fontOptions';
import type { TranslationKey } from '@eigenpal/docx-editor-i18n';

export const defaultFonts: FontOption[] = [
  { name: 'Arial', fontFamily: 'Arial', category: 'sans-serif' },
  { name: 'Calibri', fontFamily: 'Calibri', category: 'sans-serif' },
  { name: 'Helvetica', fontFamily: 'Helvetica', category: 'sans-serif' },
  { name: 'Verdana', fontFamily: 'Verdana', category: 'sans-serif' },
  { name: 'Open Sans', fontFamily: 'Open Sans', category: 'sans-serif' },
  { name: 'Roboto', fontFamily: 'Roboto', category: 'sans-serif' },
  { name: 'Times New Roman', fontFamily: 'Times New Roman', category: 'serif' },
  { name: 'Georgia', fontFamily: 'Georgia', category: 'serif' },
  { name: 'Cambria', fontFamily: 'Cambria', category: 'serif' },
  { name: 'Garamond', fontFamily: 'Garamond', category: 'serif' },
  { name: 'Courier New', fontFamily: 'Courier New', category: 'monospace' },
  { name: 'Consolas', fontFamily: 'Consolas', category: 'monospace' },
];

export const fontSizePresets = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

export interface ParagraphStylePreset {
  id: string;
  /** Fallback label used if the i18n key resolves to nothing. */
  label: string;
  nameKey: TranslationKey;
  previewStyle: Record<string, string>;
}

export const paragraphStyles: ParagraphStylePreset[] = [
  {
    id: 'Normal',
    label: 'Normal',
    nameKey: 'styles.normalText',
    previewStyle: { fontSize: '13px' },
  },
  {
    id: 'Title',
    label: 'Title',
    nameKey: 'styles.title',
    previewStyle: { fontSize: '20px', fontWeight: 'bold' },
  },
  {
    id: 'Subtitle',
    label: 'Subtitle',
    nameKey: 'styles.subtitle',
    previewStyle: { fontSize: '15px', color: '#6b7280' },
  },
  {
    id: 'Heading1',
    label: 'Heading 1',
    nameKey: 'styles.heading1',
    previewStyle: { fontSize: '18px', fontWeight: 'bold', color: '#4a6c8c' },
  },
  {
    id: 'Heading2',
    label: 'Heading 2',
    nameKey: 'styles.heading2',
    previewStyle: { fontSize: '16px', fontWeight: 'bold', color: '#4a6c8c' },
  },
  {
    id: 'Heading3',
    label: 'Heading 3',
    nameKey: 'styles.heading3',
    previewStyle: { fontSize: '14px', fontWeight: 'bold', color: '#4a6c8c' },
  },
];

export interface LineSpacingPreset {
  /** Fallback label; localized presets carry a `labelKey` instead. */
  label: string;
  labelKey?: TranslationKey;
  value: number;
}

export const lineSpacingOptions: LineSpacingPreset[] = [
  { label: 'Single', labelKey: 'lineSpacing.single', value: 240 },
  { label: '1.15', value: 276 },
  { label: '1.5', value: 360 },
  { label: 'Double', labelKey: 'lineSpacing.double', value: 480 },
];

export const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export const DEFAULT_ZOOM_PERCENT = 100;
