import { resolve } from 'node:path';
import { collectNamedExports } from './lib/named-exports.mjs';

const root = resolve(import.meta.dirname, '..');

const entries = {
  react: collectNamedExports(resolve(root, 'packages/react/src/index.ts')),
  vue: collectNamedExports(resolve(root, 'packages/vue/src/index.ts')),
  reactUi: collectNamedExports(resolve(root, 'packages/react/src/ui.ts')),
  reactPluginApi: collectNamedExports(resolve(root, 'packages/react/src/plugin-api/index.ts')),
  agentsReact: collectNamedExports(resolve(root, 'packages/agent-use/src/react.ts')),
  agentsVue: collectNamedExports(resolve(root, 'packages/agent-use/src/vue.ts')),
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
  'shared i18n contract': {
    entries: ['react', 'vue'],
    names: ['Translations'],
  },
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
  'agent UI kit canonical entries': {
    entries: ['agentsReact', 'agentsVue'],
    names: [
      'AgentPanel',
      'AgentPanelProps',
      'AgentChatLog',
      'AgentComposer',
      'AgentSuggestionChip',
      'AgentTimeline',
      'AgentMessage',
      'AgentToolCall',
      'EditorRefLike',
      'getToolDisplayName',
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
