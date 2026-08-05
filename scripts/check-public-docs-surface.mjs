import { resolve } from 'node:path';
import { collectNamedExports } from './lib/named-exports.mjs';

const root = resolve(import.meta.dirname, '..');

const entries = {
  react: collectNamedExports(resolve(root, 'packages/react/src/index.ts')),
  vue: collectNamedExports(resolve(root, 'packages/vue/src/index.ts')),
  automation: collectNamedExports(resolve(root, 'packages/agents/src/index.ts')),
  automationBrowser: collectNamedExports(resolve(root, 'packages/agents/src/browser.ts')),
};

const required = {
  'shared adapter root contract': {
    entries: ['react', 'vue'],
    names: [
      'DocxEditor',
      'DocxEditorProps',
      'DocxEditorRef',
      'EditorMode',
    ],
  },
  // Locale string types (LocaleStrings, Translations, PartialLocaleStrings,
  // TranslationKey) live in `@docx-editor.dev/i18n` and are no longer
  // re-exported from the React or Vue adapters. Consumers import them from
  // the i18n package directly.
  // Both automation entries carry the whole documented vocabulary — the lifecycle types, the
  // object model and the error type — because a consumer's own code is written against those
  // names whichever entry constructed the runtime. The entries differ by ONE member,
  // `createBrowser`, and that difference is asserted in the package's own export tests rather
  // than here, where only presence can be stated.
  'document automation object model': {
    entries: ['automation', 'automationBrowser'],
    names: [
      'DocxEditor',
      'DocxEditorRuntime',
      'DocxEditorServerRuntime',
      'RequestContext',
      'RunCallback',
      'ClientObject',
      'ClientResult',
      'TrackedObjects',
      'LoadOption',
      'CreateServerOptions',
      'DocumentCapabilities',
      'DocumentLimits',
      'Paragraph',
      'Range',
      'ContentControl',
      'Section',
      'Comment',
      'Revision',
    ],
  },
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
