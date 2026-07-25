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

export interface LegacyChromeControl {
  readonly id: string;
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
      paths: ['M280-200v-80h284q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H280Z'],
      state: { kind: 'command', command: 'undo' },
    },
    {
      id: 'redo',
      labelKey: 'formattingBar.redoShortcut',
      paths: ['M396-200q-97 0-166.5-63T160-420q0-94 69.5-157T396-640h252L544-744l56-56 200 200-200 200-56-56 104-104H396q-63 0-109.5 40T240-420q0 60 46.5 100T396-280h284v80H396Z'],
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
      labelKey: 'font.selectAriaLabel',
      paths: null,
      valueKey: 'font.sansSerif',
      state: { kind: 'parityOnly' },
    },
    {
      id: 'fontSize',
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
      paths: ['M272-200v-560h221q65 0 120 40t55 111q0 51-23 78.5T602-491q25 11 55.5 41t30.5 90q0 89-65 124.5T501-200H272Zm121-112h104q48 0 58.5-24.5T566-372q0-11-10.5-35.5T494-432H393v120Zm0-228h93q33 0 48-17t15-38q0-24-17-39t-44-15h-95v109Z'],
      state: { kind: 'command', command: 'bold' },
    },
    {
      id: 'italic',
      labelKey: 'formattingBar.italicShortcut',
      paths: ['M200-200v-100h160l120-360H320v-100h400v100H580L460-300h140v100H200Z'],
      state: { kind: 'command', command: 'italic' },
    },
    {
      id: 'underline',
      labelKey: 'formattingBar.underlineShortcut',
      paths: ['M200-120v-80h560v80H200Zm123-223q-56-63-56-167v-330h103v336q0 56 28 91t82 35q54 0 82-35t28-91v-336h103v330q0 104-56 167t-157 63q-101 0-157-63Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'strikethrough',
      labelKey: 'formattingBar.strikethrough',
      paths: ['M486-160q-76 0-135-45t-85-123l88-38q14 48 48.5 79t85.5 31q42 0 76-20t34-64q0-18-7-33t-19-27h112q5 14 7.5 28.5T694-340q0 86-61.5 133T486-160ZM80-480v-80h800v80H80Zm402-326q66 0 115.5 32.5T674-674l-88 39q-9-29-33.5-52T484-710q-41 0-68 18.5T386-640h-96q2-69 54.5-117.5T482-806Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'fontColor',
      labelKey: 'formattingBar.fontColor',
      paths: ['M80 0v-160h800V0H80Zm140-280 210-560h100l210 560h-96l-50-144H368l-52 144h-96Zm176-224h168l-82-232h-4l-82 232Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'highlightColor',
      labelKey: 'formattingBar.highlightColor',
      paths: ['M544-400 440-504 240-304l104 104 200-200Zm-47-161 104 104 199-199-104-104-199 199Zm-84-28 216 216-229 229q-24 24-56 24t-56-24l-2-2-26 26H60l126-126-2-2q-24-24-24-56t24-56l229-229Zm0 0 227-227q24-24 56-24t56 24l104 104q24 24 24 56t-24 56L629-373 413-589Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'insertLink',
      labelKey: 'formattingBar.insertLinkShortcut',
      paths: ['M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'clearFormatting',
      labelKey: 'formattingBar.clearFormatting',
      paths: ['m528-546-93-93-121-121h486v120H568l-40 94ZM792-56 460-388l-80 188H249l119-280L56-792l56-56 736 736-56 56Z'],
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
      paths: ['M760-600v-80q0-17 11.5-28.5T800-720h80v-40H760v-40h120q17 0 28.5 11.5T920-760v40q0 17-11.5 28.5T880-680h-80v40h120v40H760ZM235-160l185-291-172-269h106l124 200h4l123-200h107L539-451l186 291H618L482-377h-4L342-160H235Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'subscript',
      labelKey: 'formattingBar.subscriptShortcut',
      paths: ['M760-160v-80q0-17 11.5-28.5T800-280h80v-40H760v-40h120q17 0 28.5 11.5T920-320v40q0 17-11.5 28.5T880-240h-80v40h120v40H760Zm-525-80 185-291-172-269h106l124 200h4l123-200h107L539-531l186 291H618L482-457h-4L342-240H235Z'],
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
      labelKey: 'alignment.alignLeft',
      paths: ['M120-120v-80h720v80H120Zm0-160v-80h480v80H120Zm0-160v-80h720v80H120Zm0-160v-80h480v80H120Zm0-160v-80h720v80H120Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'alignCenter',
      labelKey: 'alignment.center',
      paths: ['M120-120v-80h720v80H120Zm160-160v-80h400v80H280ZM120-440v-80h720v80H120Zm160-160v-80h400v80H280ZM120-760v-80h720v80H120Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'alignRight',
      labelKey: 'alignment.alignRight',
      paths: ['M120-760v-80h720v80H120Zm240 160v-80h480v80H360ZM120-440v-80h720v80H120Zm240 160v-80h480v80H360ZM120-120v-80h720v80H120Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'alignJustify',
      labelKey: 'alignment.justify',
      paths: ['M120-120v-80h720v80H120Zm0-160v-80h720v80H120Zm0-160v-80h720v80H120Zm0-160v-80h720v80H120Zm0-160v-80h720v80H120Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'lineSpacing',
      labelKey: 'lineSpacing.label',
      paths: ['M240-160 80-320l56-56 64 62v-332l-64 62-56-56 160-160 160 160-56 56-64-62v332l64-62 56 56-160 160Zm240-40v-80h400v80H480Zm0-240v-80h400v80H480Zm0-240v-80h400v80H480Z'],
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
      paths: ['M360-200v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360ZM200-160q-33 0-56.5-23.5T120-240q0-33 23.5-56.5T200-320q33 0 56.5 23.5T280-240q0 33-23.5 56.5T200-160Zm0-240q-33 0-56.5-23.5T120-480q0-33 23.5-56.5T200-560q33 0 56.5 23.5T280-480q0 33-23.5 56.5T200-400Zm-56.5-263.5Q120-687 120-720t23.5-56.5Q167-800 200-800t56.5 23.5Q280-753 280-720t-23.5 56.5Q233-640 200-640t-56.5-23.5Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'numberedList',
      labelKey: 'lists.numberedList',
      paths: ['M120-80v-60h100v-30h-60v-60h60v-30H120v-60h120q17 0 28.5 11.5T280-280v40q0 17-11.5 28.5T240-200q17 0 28.5 11.5T280-160v40q0 17-11.5 28.5T240-80H120Zm0-280v-110q0-17 11.5-28.5T160-510h60v-30H120v-60h120q17 0 28.5 11.5T280-560v70q0 17-11.5 28.5T240-450h-60v30h100v60H120Zm60-280v-180h-60v-60h120v240h-60Zm180 440v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'decreaseIndent',
      labelKey: 'lists.decreaseIndent',
      paths: ['M120-120v-80h720v80H120Zm320-160v-80h400v80H440Zm0-160v-80h400v80H440Zm0-160v-80h400v80H440ZM120-760v-80h720v80H120Zm160 440L120-480l160-160v320Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'increaseIndent',
      labelKey: 'lists.increaseIndent',
      paths: ['M120-120v-80h720v80H120Zm320-160v-80h400v80H440Zm0-160v-80h400v80H440Zm0-160v-80h400v80H440ZM120-760v-80h720v80H120Zm0 440v-320l160 160-160 160Z'],
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
      paths: ['M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z'],
      state: { kind: 'parityOnly' },
    },
    {
      id: 'imageProperties',
      labelKey: 'formattingBar.imagePropertiesShortcut',
      paths: ['M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-160v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-160v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z'],
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
      paths: ['M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm240-240H200v160h240v-160Zm80 0v160h240v-160H520Zm-80-80v-160H200v160h240Zm80 0h240v-160H520v160ZM200-680h560v-80H200v80Z'],
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
      paths: ['M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z'],
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
