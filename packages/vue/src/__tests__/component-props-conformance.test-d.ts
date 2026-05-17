// Type-level drift guard for the framework-neutral Vue DocxEditor prop contract.
// Cross-package React/Vue key drift is checked by `bun run check:editor-contract`.

import type { DocxEditorProps as VueDocxEditorProps } from '../docx-editor-props';

type ImplementedSharedPropKeys =
  | 'documentBuffer'
  | 'document'
  | 'showToolbar'
  | 'documentName'
  | 'readOnly'
  | 'mode'
  | 'i18n'
  | 'externalPlugins';

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type Assert<T extends true> = T;

export type VuePropsExposeImplementedSharedKeys = Assert<
  IsAssignable<ImplementedSharedPropKeys, keyof VueDocxEditorProps>
>;
