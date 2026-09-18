import { defineConfig } from '@playwright/test';
import editorSmoke from './editor-smoke.config.ts';

// Keep the required lane explicit: other editor specs have their own server and
// fixture requirements. These cover both adapters and the main editing paths.
export default defineConfig(editorSmoke, {
  testMatch: [
    'adapter-render.smoke.spec.ts',
    'browser-first-tree.smoke.spec.ts',
    'clipboard-roundtrip.interaction.spec.ts',
    'font-remount-focus.interaction.spec.ts',
    'formtext-selection.interaction.spec.ts',
    'table-editing.interaction.spec.ts',
    'text-form-field-save.interaction.spec.ts',
    'vue.interaction.spec.ts',
  ],
  use: { trace: 'retain-on-failure' },
});
