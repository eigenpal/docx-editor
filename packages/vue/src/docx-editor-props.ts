import type { Plugin } from 'prosemirror-state';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { FontOption } from '@eigenpal/docx-editor-core/utils/fontOptions';
import type { Theme } from '@eigenpal/docx-editor-core/types/document';
import type { StyleValue, VNodeChild } from 'vue';
import type { Translations } from './i18n';
import type { EditorMode } from './editor-mode';

/**
 * Public props for the Vue editor component.
 *
 * The preferred public export name mirrors React's `DocxEditorProps`; Vue-only
 * aliases should stay additive so shared docs can differ only by package name.
 */
export interface DocxEditorProps {
  /** Document data — ArrayBuffer, Uint8Array, Blob, or File. */
  documentBuffer?: DocxInput | null;
  /** Pre-parsed document model, alternative to documentBuffer. */
  document?: Document | null;
  /** Whether to show the main formatting toolbar. */
  showToolbar?: boolean;
  /** Whether to show the title/menu bar. Vue-only chrome toggle. */
  showMenuBar?: boolean;
  /** Whether to show page rulers. */
  showRuler?: boolean;
  /** Document name shown in the title bar. */
  documentName?: string;
  /** Whether the editor is read-only. */
  readOnly?: boolean;
  /** Editor mode: direct editing, suggesting, or viewing. */
  mode?: EditorMode;
  /** Callback when the editing mode changes. */
  onModeChange?: (mode: EditorMode) => void;
  /** Translation overrides merged with English fallback. */
  i18n?: Translations;
  /** Theme override used for toolbar color palettes when the document has no theme. */
  theme?: Theme | null;
  /** External ProseMirror plugins supplied by the host app. */
  externalPlugins?: Plugin[];
  /** Whether to show the zoom controls in the toolbar. */
  showZoomControl?: boolean;
  /** Initial zoom level. */
  initialZoom?: number;
  /** Custom toolbar content appended after the built-in controls. */
  toolbarExtra?: () => VNodeChild;
  /** Additional CSS class name on the editor root. */
  className?: string;
  /** Additional inline styles on the editor root. */
  style?: StyleValue;
  /** Whether to show the document outline panel initially. */
  showOutline?: boolean;
  /** Whether to show the floating outline toggle button. */
  showOutlineButton?: boolean;
  /** Custom list of fonts shown in the font-family dropdown. */
  fontFamilies?: ReadonlyArray<string | FontOption>;
  /**
   * Callback fired when the print action is triggered. Pass it to enable the
   * `File > Print` menu entry; omit to hide. The `editor.print()` ref method
   * also invokes this callback.
   */
  onPrint?: () => void;
  /** Disable Cmd/Ctrl+F and Cmd/Ctrl+H interception. */
  disableFindReplaceShortcuts?: boolean;
  /** Custom logo/icon renderer for the title bar. Slots remain preferred in templates. */
  renderLogo?: () => VNodeChild;
  /** Callback when the document name changes. */
  onDocumentNameChange?: (name: string) => void;
  /** Whether the document name is editable. */
  documentNameEditable?: boolean;
  /** Custom right-side actions renderer for the title bar. Slots remain preferred in templates. */
  renderTitleBarRight?: () => VNodeChild;
}
