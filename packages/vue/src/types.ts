import type {
  DocumentHandle,
  DocumentSource,
  Editor,
  EditorCommand,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  FontConfiguration,
  ZoomMode,
} from '@docx-editor.dev/core/contracts/editor';
import type {
  EditorModule,
  FontConfigurationFragment,
  FontResolver,
} from '@docx-editor.dev/core/editor';
import type { Translations } from '@docx-editor.dev/i18n';
import type { DocxEditorMenuProps } from './editor/menu';
import type { DocxEditorContextMenuProps } from './editor/contextmenu';

export { EditorFontError } from '@docx-editor.dev/core/contracts/editor';
export type {
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from '@docx-editor.dev/core/contracts/editor';

export type EditorMode = 'edit' | 'view' | 'suggesting';

/** Props for the Vue `DocxEditor` sugar host. @public */
export interface DocxEditorProps {
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
  colorMode?: 'light' | 'dark' | 'system';
  t?: (key: string, params?: Record<string, string | number>) => string;
  i18n?: Translations;
  chrome?: boolean;
  title?: string;
  menu?: boolean | DocxEditorMenuProps;
  hyperlinkPopup?: boolean;
  contextMenu?: boolean | DocxEditorContextMenuProps;
  navigation?: boolean;
  rulers?: boolean;
  document?: DocumentSource;
  mode?: EditorMode;
  zoom?: number;
  zoomMode?: ZoomMode | 'auto';
  locale?: string;
  author?: string;
  modules?: readonly EditorModule[];
  class?: string;
}

/** Imperative handle exposed by `<DocxEditor ref="…">`. @public */
export interface DocxEditorRef {
  load(document: DocumentSource): void;
  save(): Promise<ArrayBuffer | null>;
  getDocumentHandle(): DocumentHandle | null;
  getEditor(): Editor | null;
  focus(): void;
  exec(command: EditorCommand, options?: { scope?: EditorScope }): ExecResult;
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;
}
