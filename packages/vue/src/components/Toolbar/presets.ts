/**
 * Static option lists for the Vue Toolbar — default fonts, font-size
 * presets, paragraph-style presets, and line-spacing presets. Kept here
 * so Toolbar.vue stays under the file-size cap.
 */

import type { FontOption } from '@eigenpal/docx-editor-core/utils/fontOptions';

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

export const paragraphStyles = [
  { id: 'Normal', label: 'Normal', previewStyle: { fontSize: '13px' } },
  { id: 'Title', label: 'Title', previewStyle: { fontSize: '20px', fontWeight: 'bold' } },
  { id: 'Subtitle', label: 'Subtitle', previewStyle: { fontSize: '15px', color: '#6b7280' } },
  {
    id: 'Heading1',
    label: 'Heading 1',
    previewStyle: { fontSize: '18px', fontWeight: 'bold', color: '#4a6c8c' },
  },
  {
    id: 'Heading2',
    label: 'Heading 2',
    previewStyle: { fontSize: '16px', fontWeight: 'bold', color: '#4a6c8c' },
  },
  {
    id: 'Heading3',
    label: 'Heading 3',
    previewStyle: { fontSize: '14px', fontWeight: 'bold', color: '#4a6c8c' },
  },
];

export const lineSpacingOptions = [
  { label: 'Single', value: 240 },
  { label: '1.15', value: 276 },
  { label: '1.5', value: 360 },
  { label: 'Double', value: 480 },
];

export const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export const DEFAULT_ZOOM_PERCENT = 100;
