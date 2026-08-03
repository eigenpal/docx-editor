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
//
// SLOT IDS ARE THE STABLE PUBLIC CONTRACT.
//
// Every control is addressed as `${groupId}.${controlId}` — `text.bold`,
// `font.family`, `alignment.left`. These slot ids are the vocabulary a host uses
// to place, replace, or hide chrome (Radix-style composition), and the key
// `commandForSlot` resolves to an engine command. They are literal-typed
// (`ChromeSlotId`) so a typo is a compile error, and they are PUBLIC API FOREVER:
// renaming a group or control id is a breaking change. Control ids are unique
// within their group, not globally — `image.insert` and `table.insert` coexist —
// so anything keyed on a control (test ids, icon registries) must key on the
// SLOT id, never the bare control id.

import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

/**
 * HOW a control reaches the engine — never WHETHER it is enabled.
 *
 * Enabled state has exactly one source: `toolbarCommandState(editor, slot)`, which
 * asks `Editor.can`. The registry is static data and cannot know what the engine
 * will honour at this selection, in this document, at this moment.
 *
 * There used to be a fourth member, `parityOnly`, meaning "visible but permanently
 * disabled". It was a second, static answer to the question `Editor.can` already
 * answers, and it went stale the moment the engine wired underline, strike, the four
 * alignments, the list commands and the four value slots: the registry still said
 * parity-only, React ignored it and ran them, and Vue believed it and rendered twelve
 * WORKING commands permanently disabled. A slot the engine has not wired needs no
 * registry flag — `commandForSlot` answers null and `toolbarCommandState` disables the
 * control with the engine's own words ("not wired to an editor command").
 */
export type ChromeControlState =
  /**
   * Dispatched as one fixed engine command: enabled when
   * `Editor.can(commandForSlot(slot))` succeeds, a click runs
   * `runToolbarCommand(editor, slot)`. The command is resolved from the SLOT id
   * through `commandForSlot` in toolbar-commands.ts — the one command table both
   * adapters share. A slot with no row there is simply not wired YET, and says so
   * through the engine rather than through this descriptor.
   */
  | { readonly kind: 'command' }
  /**
   * Dispatched with a PICKED value: `commandForSlotValue(slot, value)`. Enabled when
   * the engine would honour a well-formed value right now (`toolbarCommandState`
   * probes for exactly that), so the control needs chrome that produces a value — a
   * font list, a size, a colour — before a click means anything.
   *
   * A distinct kind because 'command' cannot describe it: there is no fixed command
   * to hand `Editor.can`, and a bare click has nothing to send.
   */
  | { readonly kind: 'value' }
  /** `Editor.save()` — not a command (see `runSave`). */
  | { readonly kind: 'save' };

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
export type ChromeControlShape = 'icon' | 'stepper' | 'dropdown' | 'colorSplit';

export interface ChromeControl<Id extends string = string> {
  /** Stable control id, unique WITHIN its group. Public API; renames are breaking. */
  readonly id: Id;
  /** How it renders. Defaults to `icon`. */
  readonly shape?: ChromeControlShape;
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
  readonly state: ChromeControlState;
}

export interface ChromeGroup<Id extends string = string, ControlId extends string = string> {
  /** Stable group id. Public API; renames are breaking. */
  readonly id: Id;
  readonly labelKey: string;
  /**
   * Not part of the DEFAULT toolbar arrangement. The chrome spec shows these
   * controls only in a context the engine does not model yet (an image or table
   * selection), or not at all (save belongs in the host's File menu, never in the
   * bar). Their slots stay public for composition — a host can still place
   * `image.insert` or `file.save` explicitly — but the default chrome is the
   * registry's default bar, which ends at the editing-mode picker.
   */
  readonly contextual?: true;
  readonly controls: readonly ChromeControl<ControlId>[];
}

/**
 * The complete chrome, in bar order. Literal-typed (`as const`) so the slot-id
 * vocabulary below is derived from the data and cannot drift from it.
 *
 * Taxonomy taste: ids are short, lowercaseCamel, and never repeat their group's name
 * (`alignment.left`, not `alignment.alignLeft`; `font.family`, not `font.fontFamily`).
 */
export const CHROME_GROUPS = [
  {
    id: 'history',
    labelKey: 'formattingBar.groups.history',
    controls: [
      {
        id: 'undo',
        labelKey: 'formattingBar.undoShortcut',
        paths: GENERATED_ICON_PATHS['undo'],
        state: { kind: 'command' },
      },
      {
        id: 'redo',
        labelKey: 'formattingBar.redoShortcut',
        paths: GENERATED_ICON_PATHS['redo'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'zoom',
    labelKey: 'formattingBar.groups.zoom',
    controls: [
      {
        // Zoom is facade state, not a command and not a mark value: the chrome that
        // drives it calls `Editor.setZoom` and reads `snapshot().zoom` (React's zoom
        // stepper does exactly that). No kind describes that dispatch, and inventing
        // one for a single control would add a branch adapters must implement and only
        // one slot could ever exercise — so this stays 'command', where the shared
        // helper reports the honest "not wired to an editor command" for chrome that
        // has no zoom wiring of its own.
        id: 'level',
        shape: 'stepper',
        valueText: '100%',
        labelKey: 'formattingBar.groups.zoom',
        paths: null,
        valueKey: 'zoom.zoomLevel',
        state: { kind: 'command' },
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
        state: { kind: 'value' },
      },
    ],
  },
  {
    id: 'font',
    labelKey: 'formattingBar.groups.font',
    controls: [
      {
        id: 'family',
        shape: 'dropdown',
        labelKey: 'font.selectAriaLabel',
        paths: null,
        valueKey: 'font.sansSerif',
        state: { kind: 'value' },
      },
      {
        id: 'size',
        shape: 'stepper',
        valueText: '11',
        labelKey: 'fontSize.listLabel',
        paths: null,
        valueKey: 'fontSize.label',
        state: { kind: 'value' },
      },
    ],
  },
  {
    id: 'text',
    labelKey: 'formattingBar.groups.textFormatting',
    controls: [
      {
        id: 'bold',
        labelKey: 'formattingBar.boldShortcut',
        paths: GENERATED_ICON_PATHS['format_bold'],
        state: { kind: 'command' },
      },
      {
        id: 'italic',
        labelKey: 'formattingBar.italicShortcut',
        paths: GENERATED_ICON_PATHS['format_italic'],
        state: { kind: 'command' },
      },
      {
        id: 'underline',
        labelKey: 'formattingBar.underlineShortcut',
        paths: GENERATED_ICON_PATHS['format_underlined'],
        state: { kind: 'command' },
      },
      {
        id: 'strike',
        labelKey: 'formattingBar.strikethrough',
        paths: GENERATED_ICON_PATHS['strikethrough_s'],
        state: { kind: 'command' },
      },
      {
        // The chrome spec renders font colour INSIDE the text-formatting group,
        // right after strikethrough (B I U S, then text colour, highlight, link).
        // The swatch is the default red the apply half is seeded with before any
        // pick ({ rgb: 'FF0000' }).
        id: 'color',
        shape: 'colorSplit',
        swatch: '#ff0000',
        labelKey: 'formattingBar.fontColor',
        paths: GENERATED_ICON_PATHS['format_color_text'],
        state: { kind: 'value' },
      },
      {
        id: 'highlight',
        shape: 'colorSplit',
        swatch: '#ffff00',
        labelKey: 'formattingBar.highlightColor',
        paths: GENERATED_ICON_PATHS['ink_highlighter'],
        state: { kind: 'value' },
      },
      {
        id: 'link',
        labelKey: 'formattingBar.insertLinkShortcut',
        paths: GENERATED_ICON_PATHS['link'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'script',
    labelKey: 'formattingBar.groups.script',
    controls: [
      {
        id: 'super',
        labelKey: 'formattingBar.superscriptShortcut',
        paths: GENERATED_ICON_PATHS['superscript'],
        state: { kind: 'command' },
      },
      {
        id: 'sub',
        labelKey: 'formattingBar.subscriptShortcut',
        paths: GENERATED_ICON_PATHS['subscript'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    // The chrome spec renders this whole group as ONE dropdown (icon + caret
    // opening a four-option panel), not four buttons. The four slots stay — a host
    // composes `alignment.left` etc. individually — only the DEFAULT rendering
    // merges them; adapters key the merge on this group's id.
    id: 'alignment',
    labelKey: 'formattingBar.groups.alignment',
    controls: [
      {
        id: 'left',
        labelKey: 'alignment.alignLeft',
        paths: GENERATED_ICON_PATHS['format_align_left'],
        state: { kind: 'command' },
      },
      {
        id: 'center',
        labelKey: 'alignment.center',
        paths: GENERATED_ICON_PATHS['format_align_center'],
        state: { kind: 'command' },
      },
      {
        id: 'right',
        labelKey: 'alignment.alignRight',
        paths: GENERATED_ICON_PATHS['format_align_right'],
        state: { kind: 'command' },
      },
      {
        id: 'justify',
        labelKey: 'alignment.justify',
        paths: GENERATED_ICON_PATHS['format_align_justify'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'list',
    labelKey: 'formattingBar.groups.listFormatting',
    controls: [
      {
        id: 'bullet',
        labelKey: 'lists.bulletList',
        paths: GENERATED_ICON_PATHS['format_list_bulleted'],
        state: { kind: 'command' },
      },
      {
        id: 'numbered',
        labelKey: 'lists.numberedList',
        paths: GENERATED_ICON_PATHS['format_list_numbered'],
        state: { kind: 'command' },
      },
      {
        id: 'outdent',
        labelKey: 'lists.decreaseIndent',
        paths: GENERATED_ICON_PATHS['format_indent_decrease'],
        state: { kind: 'command' },
      },
      {
        id: 'indent',
        labelKey: 'lists.increaseIndent',
        paths: GENERATED_ICON_PATHS['format_indent_increase'],
        state: { kind: 'command' },
      },
      {
        // The chrome spec groups line spacing WITH the list buttons, after
        // indent — not with alignment.
        id: 'lineSpacing',
        shape: 'dropdown',
        labelKey: 'lineSpacing.label',
        paths: GENERATED_ICON_PATHS['format_line_spacing'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    // The chrome spec puts clear-formatting as a standalone control between the list
    // group and the trailing review controls, flanked by separators.
    id: 'format',
    labelKey: 'formattingBar.clearFormatting',
    controls: [
      {
        id: 'clear',
        labelKey: 'formattingBar.clearFormatting',
        paths: GENERATED_ICON_PATHS['format_clear'],
        state: { kind: 'command' },
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
        state: { kind: 'command' },
      },
      {
        // The "✎ Editing ▾" mode pill: icon + current-mode label + caret.
        id: 'editingMode',
        shape: 'dropdown',
        labelKey: 'editingMode.label',
        valueKey: 'editingMode.editing',
        paths: GENERATED_ICON_PATHS['edit_note'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'image',
    labelKey: 'formattingBar.groups.image',
    contextual: true,
    controls: [
      {
        id: 'insert',
        labelKey: 'toolbar.image',
        paths: GENERATED_ICON_PATHS['image'],
        state: { kind: 'command' },
      },
      {
        id: 'properties',
        labelKey: 'formattingBar.imagePropertiesShortcut',
        paths: GENERATED_ICON_PATHS['tune'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'table',
    labelKey: 'formattingBar.groups.table',
    contextual: true,
    controls: [
      {
        id: 'insert',
        labelKey: 'toolbar.table',
        paths: GENERATED_ICON_PATHS['table'],
        state: { kind: 'command' },
      },
    ],
  },
  {
    id: 'file',
    labelKey: 'toolbar.file',
    contextual: true,
    controls: [
      {
        id: 'save',
        labelKey: 'toolbar.saveShortcut',
        paths: GENERATED_ICON_PATHS['file_download'],
        state: { kind: 'save' },
      },
    ],
  },
] as const;

// `satisfies`-style conformance check, phrased as a plain annotated alias because the
// combined `as const satisfies readonly ChromeGroup[]` crashes API Extractor 7.x
// ("Unable to follow symbol for 'const'", rushstack#4614) when an adapter re-exports
// types derived from `typeof CHROME_GROUPS`. Same guarantee: every literal above must be
// a valid `ChromeGroup`, and the literals stay literal.
const CHROME_GROUPS_CONFORMANCE: readonly ChromeGroup[] = CHROME_GROUPS;
void CHROME_GROUPS_CONFORMANCE;

// The public unions are SPELLED OUT rather than written as `typeof CHROME_GROUPS`
// projections, because API Extractor 7.x crashes following a type that reaches an
// `as const` variable declaration ("Unable to follow symbol for 'const'",
// rushstack#4754) — and the adapters re-export `ChromeSlotId`. The derived forms are
// still computed below as private aliases, with mutual-assignability tripwires, so the
// spelled-out unions CANNOT drift from the data without `typecheck` failing.

/**
 * Every group id in the chrome, as a literal union. Stable public API; renaming a group
 * id is a breaking change.
 *
 * @public
 */
export type ChromeGroupId =
  | 'history'
  | 'zoom'
  | 'styles'
  | 'font'
  | 'text'
  | 'script'
  | 'alignment'
  | 'list'
  | 'format'
  | 'review'
  | 'image'
  | 'table'
  | 'file';

/**
 * The public slot vocabulary: `${groupId}.${controlId}` for every control that actually
 * exists — `text.bold`, `font.family`, `alignment.left`. THE stable contract a host
 * composes against and `commandForSlot` resolves; renaming a slot is a breaking change.
 *
 * @public
 */
export type ChromeSlotId =
  | 'history.undo'
  | 'history.redo'
  | 'zoom.level'
  | 'styles.style'
  | 'font.family'
  | 'font.size'
  | 'text.bold'
  | 'text.italic'
  | 'text.underline'
  | 'text.strike'
  | 'text.color'
  | 'text.highlight'
  | 'text.link'
  | 'script.super'
  | 'script.sub'
  | 'alignment.left'
  | 'alignment.center'
  | 'alignment.right'
  | 'alignment.justify'
  | 'list.bullet'
  | 'list.numbered'
  | 'list.outdent'
  | 'list.indent'
  | 'list.lineSpacing'
  | 'format.clear'
  | 'review.comments'
  | 'review.editingMode'
  | 'image.insert'
  | 'image.properties'
  | 'table.insert'
  | 'file.save';

/**
 * Every control id in the chrome, as a literal union. Unique WITHIN a group, not
 * globally (`image.insert` / `table.insert`) — key consumers on {@link ChromeSlotId}.
 *
 * @public
 */
export type ChromeControlId = ChromeSlotId extends `${string}.${infer C}` ? C : never;

// ── Drift tripwires (private; never followed by API Extractor) ────────────────────────
// Both directions of assignability, so an id added, removed, or renamed in the data
// without updating the public unions (or vice versa) is a compile error right here.
type DerivedGroupId = (typeof CHROME_GROUPS)[number]['id'];
type DerivedSlotId = {
  [G in (typeof CHROME_GROUPS)[number] as G['id']]: `${G['id']}.${G['controls'][number]['id']}`;
}[DerivedGroupId];
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const GROUP_IDS_MATCH_DATA: MutuallyAssignable<ChromeGroupId, DerivedGroupId> = true;
const SLOT_IDS_MATCH_DATA: MutuallyAssignable<ChromeSlotId, DerivedSlotId> = true;
void GROUP_IDS_MATCH_DATA;
void SLOT_IDS_MATCH_DATA;

/**
 * The slot id of one control within its group. Only meaningful for entries of
 * `CHROME_GROUPS` — the cast is sound because every group/control pair in the registry
 * is, by construction, a member of the `ChromeSlotId` union.
 *
 * @public
 */
export function chromeSlotId(
  group: { readonly id: string },
  control: { readonly id: string }
): ChromeSlotId {
  return `${group.id}.${control.id}` as ChromeSlotId;
}

/**
 * The groups of the DEFAULT toolbar arrangement, in bar order: every group that is
 * not `contextual`. This is the registry's default bar — undo/redo through the
 * editing-mode picker — and what both adapters render when the host composes
 * nothing. Contextual slots (`image.*`, `table.insert`, `file.save`) remain
 * available for explicit composition.
 *
 * @public
 */
export function defaultChromeGroups(): readonly ChromeGroup[] {
  // Filtered through the ChromeGroup-typed view: the literal union's members omit
  // the optional `contextual` key entirely, which TS treats as an unknown property.
  return CHROME_GROUPS_CONFORMANCE.filter((group) => !group.contextual);
}

/** The menu region the legacy chrome shows above the toolbar. Parity-only. */
export const CHROME_MENUS: readonly { readonly id: string; readonly labelKey: string }[] = [
  { id: 'file', labelKey: 'toolbar.file' },
  { id: 'format', labelKey: 'toolbar.format' },
  { id: 'insert', labelKey: 'toolbar.insert' },
  { id: 'help', labelKey: 'toolbar.help' },
];

/** Total controls, so a parity test can assert none were dropped. */
export function chromeControlCount(): number {
  return CHROME_GROUPS.reduce((n, g) => n + g.controls.length, 0);
}

/**
 * i18n key for the tooltip on a control an ADAPTER renders but cannot drive yet — a
 * value slot in a toolbar that has grown no picker for it, say. It is never the reason
 * a control is disabled: when the ENGINE refuses, the tooltip is the engine's own
 * `disabledReason`, never an adapter paraphrase.
 */
export const CHROME_UNAVAILABLE_KEY = 'formattingBar.unavailableInPreview';
