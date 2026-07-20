import { resolve } from 'node:path';
import { collectNamedExports } from './lib/named-exports.mjs';

const root = resolve(import.meta.dirname, '..');

const entries = {
  react: collectNamedExports(resolve(root, 'packages/react/src/index.ts')),
  vue: collectNamedExports(resolve(root, 'packages/vue/src/index.ts')),
  reactUi: collectNamedExports(resolve(root, 'packages/react/src/ui.ts')),
  reactPluginApi: collectNamedExports(resolve(root, 'packages/react/src/plugin-api/index.ts')),
};

const required = {
  'shared adapter root contract': {
    entries: ['react', 'vue'],
    names: [
      'DocxEditor',
      'DocxEditorProps',
      'DocxEditorRef',
      'DocxEditorHandle',
      'EditorMode',
      'RenderAsyncOptions',
      'renderAsync',
    ],
  },
  // Locale string types (LocaleStrings, Translations, PartialLocaleStrings,
  // TranslationKey) live in `@docx-editor.dev/i18n` and are no longer
  // re-exported from the React or Vue adapters. Consumers import them from
  // the i18n package directly.
  'documented React toolbar/customization surface': {
    entries: ['reactUi'],
    names: [
      'EditorToolbar',
      'EditorToolbarProps',
      'Toolbar',
      'ToolbarProps',
      'ColorPicker',
      'ColorPickerProps',
      'FontOption',
    ],
  },
  'documented React plugin surface': {
    entries: ['reactPluginApi'],
    names: [
      'PluginHost',
      'EditorPlugin',
      'PluginPanelProps',
      'PluginHostRef',
      'RenderedDomContext',
      'PositionCoordinates',
      'templatePlugin',
      'createTemplatePlugin',
    ],
  },
  // The 'agent UI kit canonical entries' group moved to the core/agents repo
  // along with `@docx-editor.dev/agents`.
};

let failed = false;

for (const [group, contract] of Object.entries(required)) {
  for (const entry of contract.entries) {
    const names = entries[entry];
    const missing = contract.names.filter((name) => !names.has(name));
    if (missing.length > 0) {
      failed = true;
      console.error(`Public docs surface drift: ${group} missing from ${entry}:`);
      for (const name of missing) console.error(`  - ${name}`);
    }
  }
}

if (failed) process.exit(1);

console.log(
  `✓ public docs surface: ${Object.keys(required).length} documented contract groups exported`
);
