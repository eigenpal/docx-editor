import type { ReactEditorPlugin } from '../../plugin-api/types';
import type { EditorView } from 'prosemirror-view';
import { createSpellcheckProseMirrorPlugin, spellcheckPluginKey } from './prosemirror-plugin';
import type {
  SpellcheckMenuState,
  SpellcheckStatus,
  SpellcheckMisspelling,
} from './prosemirror-plugin';
import { SpellcheckOverlay } from './components/SpellcheckOverlay';

export interface SpellcheckPluginOptions {
  debounceMs?: number;
  renderOverlay?: boolean;
}

export interface SpellcheckUiState {
  menu: SpellcheckMenuState | null;
  status: SpellcheckStatus;
  misspellings: SpellcheckMisspelling[];
}

export const SPELLCHECK_DECORATION_STYLES = `
.ep-root .docx-spell-error {
  text-decoration: underline wavy #ef4444;
  text-decoration-thickness: 1.5px;
}
`;

export function createSpellcheckPlugin(
  options: SpellcheckPluginOptions = {}
): ReactEditorPlugin<SpellcheckUiState> {
  const pmPlugin = createSpellcheckProseMirrorPlugin(options);
  const renderOverlay = options.renderOverlay !== false;

  return {
    id: 'spellcheck',
    name: 'Spell Check',
    proseMirrorPlugins: [pmPlugin],

    onStateChange: (view: EditorView): SpellcheckUiState | undefined => {
      const pluginState = spellcheckPluginKey.getState(view.state);
      if (!pluginState) return undefined;
      return {
        menu: pluginState.menu,
        status: pluginState.status,
        misspellings: pluginState.misspellings,
      };
    },

    initialize: () => ({
      menu: null,
      status: 'loading',
      misspellings: [],
    }),

    renderOverlay: (_context, state, editorView) => {
      if (!renderOverlay) return null;
      const misspellings = state?.misspellings ?? [];

      return (
        <>
          <SpellcheckOverlay
            context={_context}
            editorView={editorView}
            misspellings={misspellings}
          />
        </>
      );
    },

    styles: `
${SPELLCHECK_DECORATION_STYLES}
`,
  };
}

export const spellcheckPlugin = createSpellcheckPlugin();

export { SpellcheckContextMenu } from './components/SpellcheckContextMenu';
export {
  spellcheckPluginKey,
  createSpellcheckProseMirrorPlugin,
  closeSpellcheckMenu,
  addWordToDictionary,
  ignoreMisspelling,
  type SpellcheckMenuState,
  type SpellcheckStatus,
  type SpellcheckPluginState,
} from './prosemirror-plugin';
export { buildSpellcheckMenuItems } from './menu-utils';
