// Legacy editor chrome, expressed as data (interactive-paginated-editing M6V.1).
//
// M6V.1 reproduces the complete user-visible legacy chrome from archaeology ref
// 9bb06c38f43c0dc297e3de8b5b488b241e134be1 on the greenfield demos. Everything
// here is PRESENTATION ONLY: icon geometry, grouping, ordering, and i18n keys.
// There is no ProseMirror, no legacy painter, no DOM-selection authority, and no
// adapter-owned geometry — a control's enabled state comes from `Editor.can` and
// nothing else.
//
// It lives in engine-editor rather than in either adapter because React and Vue
// MUST render the same chrome. The repo rule is that platform-agnostic logic
// belongs in the shared layer and is called by both adapters, not duplicated; a
// previous round of this change grew 24 React-only exports precisely by ignoring
// that, and no test caught it until a full-repo export-parity sweep.
//
// Icon paths are the Material Symbols set the legacy UI already bundled, lifted
// verbatim (viewBox "0 -960 960 960"). They were extracted programmatically from
// the reference commit rather than retyped, because a hand-copied path is a silent
// visual regression that no assertion would catch.

/** Which toolbar controls are actually wired to an engine command. */
export type LegacyChromeControlState =
  /** Enabled when `Editor.can(command)` succeeds; runs `Editor.exec(command)`. */
  | { readonly kind: 'command'; readonly command: LegacyChromeCommandId }
  /** `Editor.save()` — not a command. */
  | { readonly kind: 'save' }
  /**
   * Present for visual parity, permanently disabled with a localized reason.
   *
   * M6V.1 is explicit that only undo, redo, bold, italic, and save may act, and
   * that every other legacy control MUST stay VISIBLE but disabled rather than be
   * dropped. A missing button would understate the parity gap; an enabled one
   * would claim a capability the engine does not have.
   */
  | { readonly kind: 'parityOnly' };

/** The commands M6V.1 permits to be enabled. */
export type LegacyChromeCommandId = 'undo' | 'redo' | 'bold' | 'italic';

/**
 * The SHAPE a control renders as (task M6V.1).
 *
 * The legacy toolbar is not a row of uniform icon buttons: it mixes labelled dropdowns
 * (`Normal`, `Arial`, alignment, line spacing), numeric steppers with visible values
 * (zoom `- 100% +`, size `- 26 +`), split colour controls (a glyph over a colour swatch
 * with its own caret), and a mode pill (`Editing`). Rendering all of them as icon
 * buttons is the difference an owner review called out as "not visual parity" — the
 * regions were all present and it still did not look like the product.
 */
/** `modePill` is deliberately absent. It was declared, never used by any control, and
 *  rendered nothing — the editing-mode control below is a `dropdown`, which is what the
 *  legacy product shows. A shape no descriptor names is a branch adapters must implement
 *  and can never exercise. */
import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

export type LegacyChromeShape = 'icon' | 'stepper' | 'dropdown' | 'colorSplit';

export interface LegacyChromeControl {
  readonly id: string;
  /** How it renders. Defaults to `icon`. */
  readonly shape?: LegacyChromeShape;
  /** Displayed value for a stepper or dropdown (an i18n key, or a literal for numbers). */
  readonly valueText?: string;
  /** Swatch colour for a `colorSplit` control. */
  readonly swatch?: string;
  /** i18n key for the accessible name and tooltip. Never hardcoded English. */
  readonly labelKey: string;
  /** Material Symbols path data, or null for a non-icon control (a picker). */
  readonly paths: readonly string[] | null;
  /** For pickers: the i18n key of the placeholder value shown. */
  readonly valueKey?: string;
  readonly state: LegacyChromeControlState;
}

export interface LegacyChromeGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly controls: readonly LegacyChromeControl[];
}

export const LEGACY_CHROME_GROUPS: readonly LegacyChromeGroup[] = [
  {
    id: 'history',
    labelKey: 'formattingBar.groups.history',
    controls: [
      {
        id: 'undo',
        labelKey: 'formattingBar.undoShortcut',
        paths: GENERATED_ICON_PATHS['undo'],
        state: { kind: 'command', command: 'undo' },
      },
      {
        id: 'redo',
        labelKey: 'formattingBar.redoShortcut',
        paths: GENERATED_ICON_PATHS['redo'],
        state: { kind: 'command', command: 'redo' },
      },
    ],
  },
  {
    id: 'zoom',
    labelKey: 'formattingBar.groups.zoom',
    controls: [
      {
        id: 'zoom',
        shape: 'stepper',
        valueText: '100%',
        labelKey: 'formattingBar.groups.zoom',
        paths: null,
        valueKey: 'zoom.zoomLevel',
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'styles',
    labelKey: 'formattingBar.groups.styles',
    controls: [
      {
        id: 'style',
        shape: 'dropdown',
        labelKey: 'styles.selectAriaLabel',
        paths: null,
        valueKey: 'styles.normalText',
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'font',
    labelKey: 'formattingBar.groups.font',
    controls: [
      {
        id: 'fontFamily',
        shape: 'dropdown',
        labelKey: 'font.selectAriaLabel',
        paths: null,
        valueKey: 'font.sansSerif',
        state: { kind: 'parityOnly' },
      },
      {
        id: 'fontSize',
        shape: 'stepper',
        valueText: '11',
        labelKey: 'fontSize.listLabel',
        paths: null,
        valueKey: 'fontSize.label',
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'textFormatting',
    labelKey: 'formattingBar.groups.textFormatting',
    controls: [
      {
        id: 'bold',
        labelKey: 'formattingBar.boldShortcut',
        paths: GENERATED_ICON_PATHS['format_bold'],
        state: { kind: 'command', command: 'bold' },
      },
      {
        id: 'italic',
        labelKey: 'formattingBar.italicShortcut',
        paths: GENERATED_ICON_PATHS['format_italic'],
        state: { kind: 'command', command: 'italic' },
      },
      {
        id: 'underline',
        labelKey: 'formattingBar.underlineShortcut',
        paths: GENERATED_ICON_PATHS['format_underlined'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'strikethrough',
        labelKey: 'formattingBar.strikethrough',
        paths: GENERATED_ICON_PATHS['strikethrough_s'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'fontColor',
        shape: 'colorSplit',
        swatch: '#d93025',
        labelKey: 'formattingBar.fontColor',
        paths: GENERATED_ICON_PATHS['format_color_text'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'highlightColor',
        shape: 'colorSplit',
        swatch: '#fff2a8',
        labelKey: 'formattingBar.highlightColor',
        paths: GENERATED_ICON_PATHS['ink_highlighter'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'insertLink',
        labelKey: 'formattingBar.insertLinkShortcut',
        paths: GENERATED_ICON_PATHS['link'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'clearFormatting',
        labelKey: 'formattingBar.clearFormatting',
        paths: GENERATED_ICON_PATHS['format_clear'],
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'script',
    labelKey: 'formattingBar.groups.script',
    controls: [
      {
        id: 'superscript',
        labelKey: 'formattingBar.superscriptShortcut',
        paths: GENERATED_ICON_PATHS['superscript'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'subscript',
        labelKey: 'formattingBar.subscriptShortcut',
        paths: GENERATED_ICON_PATHS['subscript'],
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'alignment',
    labelKey: 'formattingBar.groups.alignment',
    controls: [
      {
        id: 'alignLeft',
        shape: 'dropdown',
        labelKey: 'alignment.alignLeft',
        paths: GENERATED_ICON_PATHS['format_align_left'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'alignCenter',
        labelKey: 'alignment.center',
        paths: GENERATED_ICON_PATHS['format_align_center'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'alignRight',
        labelKey: 'alignment.alignRight',
        paths: GENERATED_ICON_PATHS['format_align_right'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'alignJustify',
        labelKey: 'alignment.justify',
        paths: GENERATED_ICON_PATHS['format_align_justify'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'lineSpacing',
        shape: 'dropdown',
        labelKey: 'lineSpacing.label',
        paths: GENERATED_ICON_PATHS['format_line_spacing'],
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'listFormatting',
    labelKey: 'formattingBar.groups.listFormatting',
    controls: [
      {
        id: 'bulletList',
        labelKey: 'lists.bulletList',
        paths: GENERATED_ICON_PATHS['format_list_bulleted'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'numberedList',
        labelKey: 'lists.numberedList',
        paths: GENERATED_ICON_PATHS['format_list_numbered'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'decreaseIndent',
        labelKey: 'lists.decreaseIndent',
        paths: GENERATED_ICON_PATHS['format_indent_decrease'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'increaseIndent',
        labelKey: 'lists.increaseIndent',
        paths: GENERATED_ICON_PATHS['format_indent_increase'],
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'image',
    labelKey: 'formattingBar.groups.image',
    controls: [
      {
        id: 'insertImage',
        labelKey: 'toolbar.image',
        paths: GENERATED_ICON_PATHS['image'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'imageProperties',
        labelKey: 'formattingBar.imagePropertiesShortcut',
        paths: GENERATED_ICON_PATHS['tune'],
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'table',
    labelKey: 'formattingBar.groups.table',
    controls: [
      {
        id: 'insertTable',
        labelKey: 'toolbar.table',
        paths: GENERATED_ICON_PATHS['table'],
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'review',
    labelKey: 'formattingBar.commentsAndChanges',
    controls: [
      {
        id: 'comments',
        shape: 'icon',
        labelKey: 'formattingBar.commentsAndChanges',
        paths: GENERATED_ICON_PATHS['comment'],
        state: { kind: 'parityOnly' },
      },
      {
        id: 'editingMode',
        shape: 'dropdown',
        labelKey: 'editingMode.label',
        valueKey: 'editingMode.editing',
        paths: null,
        state: { kind: 'parityOnly' },
      },
    ],
  },
  {
    id: 'file',
    labelKey: 'toolbar.file',
    controls: [
      {
        id: 'save',
        labelKey: 'toolbar.saveShortcut',
        paths: GENERATED_ICON_PATHS['file_download'],
        state: { kind: 'save' },
      },
    ],
  },
];

/** The menu region the legacy chrome shows above the toolbar. Parity-only. */
export const LEGACY_CHROME_MENUS: readonly { readonly id: string; readonly labelKey: string }[] = [
  { id: 'file', labelKey: 'toolbar.file' },
  { id: 'format', labelKey: 'toolbar.format' },
  { id: 'insert', labelKey: 'toolbar.insert' },
  { id: 'help', labelKey: 'toolbar.help' },
];

/** Total controls, so a parity test can assert none were dropped. */
export function legacyChromeControlCount(): number {
  return LEGACY_CHROME_GROUPS.reduce((n, g) => n + g.controls.length, 0);
}

/** i18n key for the tooltip on a control that exists only for visual parity. */
export const LEGACY_CHROME_UNAVAILABLE_KEY = 'formattingBar.unavailableInPreview';
