// The compound toolbar root: the FULL chrome registry as the default, with in-place
// overrides.
//
// DEFAULT-SET + IN-PLACE OVERRIDE SEMANTICS. With no children the toolbar renders the
// COMPLETE chrome — every group and control of `CHROME_GROUPS`, in registry
// order, with a separator between groups. The arrangement is DERIVED from the registry
// rather than hand-listed, so a registry change flows through: a new control renders
// as a live `ToolbarButton` (disabled with the engine's reason until it is wired)
// without touching this file. Controls whose SHAPE the registry declares specially
// render through their dedicated parts: the FontFamily compound, the font-size and
// zoom steppers (wired), the colour split buttons (wired), the parity-only pickers
// (disabled lookalikes), and save (live only with an `onSave` handler).
//
// WITH children, each child that is a toolbar PART — detected by the static slot
// marker (`Component.docxSlot`, or `ToolbarButton`'s marker plus its `slot` prop;
// never displayName, which minifies away) — REPLACES its slot in the default
// arrangement in place, so `<Toolbar><Bold className="fat"/></Toolbar>` is still the
// whole toolbar with one customized button. A part child with `hidden` removes its
// slot (the part renders null where it stands). Non-part children append after the
// default set. `preset={false}` opts out entirely: children render verbatim.

import { Children, Fragment, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  CHROME_GROUPS,
  chromeSlotId,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import { ToolbarContext, type ToolbarTranslate } from './toolbar-context';
import { ToolbarButton, guardToolbarMousedown } from './ToolbarButton';
import {
  ToolbarAlignCenter,
  ToolbarAlignJustify,
  ToolbarAlignLeft,
  ToolbarAlignRight,
  ToolbarBold,
  ToolbarBulletList,
  ToolbarClearFormatting,
  ToolbarComments,
  ToolbarEditingMode,
  ToolbarImageInsert,
  ToolbarImageProperties,
  ToolbarIndent,
  ToolbarItalic,
  ToolbarLineSpacing,
  ToolbarLink,
  ToolbarNumberedList,
  ToolbarOutdent,
  ToolbarRedo,
  ToolbarSave,
  ToolbarSeparator,
  ToolbarStrike,
  ToolbarStylePicker,
  ToolbarSubscript,
  ToolbarSuperscript,
  ToolbarTableInsert,
  ToolbarUnderline,
  ToolbarUndo,
  type ToolbarPartComponent,
  type ToolbarSlotPartComponent,
} from './parts';
import { ToolbarFontSize, ToolbarZoom } from './steppers';
import { ToolbarFontColor, ToolbarHighlight } from './ColorSplit';
import { FontFamily, useFontFamily } from './FontFamily';

/** The default arrangement, as slot entries with separators between groups. */
type DefaultEntry = { kind: 'slot'; slot: ChromeSlotId; Part: PartLike } | { kind: 'separator' };
type PartLike = (props: { hidden?: boolean }) => ReactNode;

/**
 * The parts whose slot needs more than an icon button: compounds, steppers, colour
 * splits, parity-only pickers, and save. Everything NOT named here renders as a live
 * `ToolbarButton` for its slot — which is also the fallback for any control a future
 * registry revision adds, so the arrangement below never goes stale.
 */
const SHAPED_PARTS: Partial<Record<ChromeSlotId, PartLike>> = {
  'zoom.level': ToolbarZoom,
  'styles.style': ToolbarStylePicker,
  'font.family': FontFamily,
  'font.size': ToolbarFontSize,
  'font.color': ToolbarFontColor,
  'text.highlight': ToolbarHighlight,
  'review.editingMode': ToolbarEditingMode,
  'file.save': ToolbarSave,
};

/** Icon-button fallback parts, one per slot, created once. */
const iconPartCache = new Map<ChromeSlotId, PartLike>();
function iconPart(slot: ChromeSlotId): PartLike {
  let part = iconPartCache.get(slot);
  if (!part) {
    part = (props: { hidden?: boolean }) => <ToolbarButton slot={slot} {...props} />;
    iconPartCache.set(slot, part);
  }
  return part;
}

/** The whole registry, in registry order, separators between groups. */
const DEFAULT_ARRANGEMENT: readonly DefaultEntry[] = CHROME_GROUPS.flatMap((group, index) => {
  const entries: DefaultEntry[] = index > 0 ? [{ kind: 'separator' }] : [];
  for (const control of group.controls) {
    const slot = chromeSlotId(group, control);
    entries.push({ kind: 'slot', slot, Part: SHAPED_PARTS[slot] ?? iconPart(slot) });
  }
  return entries;
});

/** The slot one child element drives, or null for a non-part child. */
function slotOfChild(child: ReactNode): ChromeSlotId | null {
  if (!isValidElement(child)) return null;
  const type = child.type as { docxSlot?: unknown; docxToolbarPart?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxSlot === 'string') return type.docxSlot as ChromeSlotId;
  if (type.docxToolbarPart === true) {
    const slot = (child.props as { slot?: unknown }).slot;
    if (typeof slot === 'string') return slot as ChromeSlotId;
  }
  return null;
}

/** Props for `DocxEditor.Toolbar`. @public */
export interface DocxEditorToolbarProps {
  /** Appended after the base `docx-toolbar` class. */
  className?: string;
  /** i18n resolver for control labels; without it the raw keys show (never English). */
  t?: ToolbarTranslate;
  /**
   * Handler for the `file.save` control. Save is not an engine command (`Editor.save()`
   * returns bytes the host must deliver), so without a handler the control renders
   * disabled — same contract as the Vue toolbar's `onSave`.
   */
  onSave?: () => void;
  /**
   * `false` renders children verbatim with no default arrangement. Default `true`:
   * part children override their slots in place, others append.
   */
  preset?: boolean;
  children?: ReactNode;
}

function DocxEditorToolbarRoot(props: DocxEditorToolbarProps) {
  const { className, t, onSave, preset = true, children } = props;
  const context = useMemo(() => ({ t, onSave }), [t, onSave]);

  let content: ReactNode;
  if (!preset) {
    content = children;
  } else {
    const kids = Children.toArray(children);
    const overrides = new Map<ChromeSlotId, ReactElement>();
    const appended: ReactNode[] = [];
    for (const child of kids) {
      const slot = slotOfChild(child);
      if (slot && DEFAULT_ARRANGEMENT.some((e) => e.kind === 'slot' && e.slot === slot)) {
        // Last override for a slot wins, matching how later props win in a spread.
        overrides.set(slot, child as ReactElement);
      } else {
        appended.push(child);
      }
    }
    content = (
      <>
        {DEFAULT_ARRANGEMENT.map((entry, index) => {
          if (entry.kind === 'separator') return <ToolbarSeparator key={`separator-${index}`} />;
          const override = overrides.get(entry.slot);
          // A `hidden` override renders null where it stands, removing the slot.
          if (override) return <Fragment key={entry.slot}>{override}</Fragment>;
          const Part = entry.Part;
          return (
            <Fragment key={entry.slot}>
              <Part />
            </Fragment>
          );
        })}
        {appended}
      </>
    );
  }

  return (
    <ToolbarContext.Provider value={context}>
      <div
        role="toolbar"
        data-testid="docx-toolbar"
        className={`docx-toolbar${className ? ` ${className}` : ''}`}
        // Container-level caret guard (CLAUDE.md focus-stealing pitfall): a disabled
        // button never receives mousedown, so per-button handlers cannot cover it.
        // Form fields are exempt inside the guard itself.
        onMouseDown={guardToolbarMousedown}
      >
        {content}
      </div>
    </ToolbarContext.Provider>
  );
}

/** The toolbar with its parts attached as statics. @public */
export interface DocxEditorToolbarNamespace {
  (props: DocxEditorToolbarProps): ReactNode;
  readonly Button: typeof ToolbarButton;
  readonly Separator: typeof ToolbarSeparator;
  readonly Undo: ToolbarPartComponent;
  readonly Redo: ToolbarPartComponent;
  readonly Bold: ToolbarPartComponent;
  readonly Italic: ToolbarPartComponent;
  readonly Underline: ToolbarPartComponent;
  readonly Strike: ToolbarPartComponent;
  readonly Link: ToolbarPartComponent;
  readonly ClearFormatting: ToolbarPartComponent;
  readonly Superscript: ToolbarPartComponent;
  readonly Subscript: ToolbarPartComponent;
  readonly AlignLeft: ToolbarPartComponent;
  readonly AlignCenter: ToolbarPartComponent;
  readonly AlignRight: ToolbarPartComponent;
  readonly AlignJustify: ToolbarPartComponent;
  readonly LineSpacing: ToolbarPartComponent;
  readonly BulletList: ToolbarPartComponent;
  readonly NumberedList: ToolbarPartComponent;
  readonly Outdent: ToolbarPartComponent;
  readonly Indent: ToolbarPartComponent;
  readonly ImageInsert: ToolbarPartComponent;
  readonly ImageProperties: ToolbarPartComponent;
  readonly TableInsert: ToolbarPartComponent;
  readonly Comments: ToolbarPartComponent;
  readonly FontFamily: typeof FontFamily;
  readonly FontSize: ToolbarSlotPartComponent;
  readonly FontColor: ToolbarSlotPartComponent;
  readonly Highlight: ToolbarSlotPartComponent;
  readonly Zoom: ToolbarSlotPartComponent;
  readonly StylePicker: ToolbarSlotPartComponent;
  readonly EditingMode: ToolbarSlotPartComponent;
  readonly Save: ToolbarSlotPartComponent;
}

/**
 * The compound toolbar: `<DocxEditor.Toolbar/>` for the full working chrome, parts as
 * statics for composition (`<DocxEditor.Toolbar><DocxEditor.Toolbar.Bold/>...`).
 *
 * @public
 */
export const DocxEditorToolbar: DocxEditorToolbarNamespace = Object.assign(DocxEditorToolbarRoot, {
  Button: ToolbarButton,
  Separator: ToolbarSeparator,
  Undo: ToolbarUndo,
  Redo: ToolbarRedo,
  Bold: ToolbarBold,
  Italic: ToolbarItalic,
  Underline: ToolbarUnderline,
  Strike: ToolbarStrike,
  Link: ToolbarLink,
  ClearFormatting: ToolbarClearFormatting,
  Superscript: ToolbarSuperscript,
  Subscript: ToolbarSubscript,
  AlignLeft: ToolbarAlignLeft,
  AlignCenter: ToolbarAlignCenter,
  AlignRight: ToolbarAlignRight,
  AlignJustify: ToolbarAlignJustify,
  LineSpacing: ToolbarLineSpacing,
  BulletList: ToolbarBulletList,
  NumberedList: ToolbarNumberedList,
  Outdent: ToolbarOutdent,
  Indent: ToolbarIndent,
  ImageInsert: ToolbarImageInsert,
  ImageProperties: ToolbarImageProperties,
  TableInsert: ToolbarTableInsert,
  Comments: ToolbarComments,
  FontFamily,
  FontSize: ToolbarFontSize,
  FontColor: ToolbarFontColor,
  Highlight: ToolbarHighlight,
  Zoom: ToolbarZoom,
  StylePicker: ToolbarStylePicker,
  EditingMode: ToolbarEditingMode,
  Save: ToolbarSave,
});

export { useFontFamily };
