import type { DefineComponent } from 'vue';

import DocxEditorSfc from './DocxEditor.vue';
import type { DocxEditorProps } from './DocxEditor/types';

/**
 * Typed entry wrapper that keeps the published declaration independent of the
 * source-only `.vue` file.
 *
 * @public
 */
const DocxEditor = DocxEditorSfc as DefineComponent<DocxEditorProps>;

export default DocxEditor;
