import { createDeterministicLayoutShaping } from '@docx-editor.dev/engine-layout';
import {
  createEditor as createProductionEditor,
  type EngineEditorConfig,
} from '../create-editor.ts';

const TEST_SHAPING = createDeterministicLayoutShaping({
  families: [
    'Arial',
    'Aptos',
    'Calibri',
    'Cambria',
    'Consolas',
    'Courier New',
    'Georgia',
    'Tahoma',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
  ],
});

/** Supplies the contract-level deterministic shaper to editor tests only. */
export function createTestEditor(
  config: Omit<EngineEditorConfig, 'layoutShaping'> &
    Partial<Pick<EngineEditorConfig, 'layoutShaping'>>
) {
  return createProductionEditor({
    ...config,
    layoutShaping: config.layoutShaping ?? TEST_SHAPING,
  });
}
