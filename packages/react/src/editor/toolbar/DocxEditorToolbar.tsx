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
// zoom steppers (wired), the colour split buttons (wired), the pickers this toolbar
// does not drive yet (disabled lookalikes), and save (live only with an `onSave`
// handler).
//
// WITH children, each child that is a toolbar PART — detected by the static slot
// marker (`Component.docxSlot`, or `ToolbarButton`'s marker plus its `slot` prop;
// never displayName, which minifies away) — REPLACES its slot in the default
// arrangement in place, so `<Toolbar><Bold className="fat"/></Toolbar>` is still the
// whole toolbar with one customized button. A part child with `hidden` removes its
// slot (the part renders null where it stands). Non-part children append after the
// default set. `preset={false}` opts out entirely: children render verbatim.

import { ToolbarEditingMode } from './EditingMode';
import { Children, Fragment, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  chromeSlotId,
  defaultChromeGroups,
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
  ToolbarImageInsert,
  ToolbarImageProperties,
  ToolbarIndent,
  ToolbarItalic,
  ToolbarLink,
  ToolbarNumberedList,
  ToolbarOutdent,
  ToolbarRedo,
  ToolbarSave,
  ToolbarSeparator,
  ToolbarStrike,
  ToolbarSubscript,
  ToolbarSuperscript,
  ToolbarTableInsert,
  ToolbarUnderline,
  ToolbarUndo,
  type ToolbarPartComponent,
  type ToolbarSlotPartComponent,
} from './parts';
import { ToolbarFontSize, ToolbarZoom } from './steppers';
import { ToolbarLineSpacing } from './LineSpacing';
import { ToolbarFontColor, ToolbarHighlight, type ToolbarColorSplitComponent } from './ColorSplit';
import { ToolbarAlignment, type ToolbarAlignmentComponent } from './Alignment';
import { ToolbarAction } from './ToolbarAction';
import { FontFamily, useFontFamily } from './FontFamily';
import { ParagraphStyle, useParagraphStyle } from './ParagraphStyle';
import {
  CONTENT_CONTROL_SHAPED_PARTS,
  ToolbarContentControlFormFill,
  ToolbarContentControlInspector,
  ToolbarContentControlRemove,
  ToolbarContentControlShowAll,
} from './ContentControlParts';

/**
 * A default-arrangement key: a chrome slot, or `'alignment'` for the MERGED
 * alignment dropdown that stands in for the four `alignment.*` slots.
 */
type ArrangementKey = ChromeSlotId | 'alignment';

/** The default arrangement, as slot entries with separators between groups. */
type DefaultEntry = { kind: 'slot'; slot: ArrangementKey; Part: PartLike } | { kind: 'separator' };
type PartLike = (props: { hidden?: boolean }) => ReactNode;

/**
 * The parts whose slot needs more than an icon button: compounds, steppers, colour
 * splits, the undriven pickers, and save. Everything NOT named here renders as a live
 * `ToolbarButton` for its slot — which is also the fallback for any control a future
 * registry revision adds, so the arrangement below never goes stale.
 */
const SHAPED_PARTS: Partial<Record<ChromeSlotId, PartLike>> = {
  'zoom.level': ToolbarZoom,
  'styles.style': ParagraphStyle,
  'font.family': FontFamily,
  'font.size': ToolbarFontSize,
  'text.color': ToolbarFontColor,
  'text.highlight': ToolbarHighlight,
  // Insert Link is icon-SHAPED but not command-driven: a link needs a target, so the press
  // opens the popover instead of running the slot's command. Its enabled state still comes
  // from the engine, like every other control.
  'text.link': ToolbarLink,
  'list.lineSpacing': ToolbarLineSpacing,
  'review.editingMode': ToolbarEditingMode,
  'file.save': ToolbarSave,
  // Content-control chrome: mode toggles and inspector/remove. Keys only apply once
  // `CHROME_GROUPS` registers the `contentControl` group; until then the default bar
  // does not list them (no hand-listed slots), and hosts compose the named parts.
  ...CONTENT_CONTROL_SHAPED_PARTS,
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

/**
 * The DEFAULT chrome, in registry order, separators between groups: every
 * non-contextual registry group — the registry's default bar, which ends at the
 * editing-mode picker (contextual slots stay available for composition) — with the
 * alignment group merged into ONE dropdown under the `'alignment'` key.
 */
const DEFAULT_ARRANGEMENT: readonly DefaultEntry[] = defaultChromeGroups().flatMap(
  (group, index) => {
    const entries: DefaultEntry[] = index > 0 ? [{ kind: 'separator' }] : [];
    if (group.id === 'alignment') {
      entries.push({ kind: 'slot', slot: 'alignment', Part: ToolbarAlignment });
      return entries;
    }
    for (const control of group.controls) {
      const slot = chromeSlotId(group, control);
      entries.push({ kind: 'slot', slot, Part: SHAPED_PARTS[slot] ?? iconPart(slot) });
    }
    return entries;
  }
);

/** The slot one child element drives, or null for a non-part child. */
function slotOfChild(child: ReactNode): ArrangementKey | null {
  if (!isValidElement(child)) return null;
  const type = child.type as { docxSlot?: unknown; docxToolbarPart?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxSlot === 'string') return type.docxSlot as ArrangementKey;
  if (type.docxToolbarPart === true) {
    const slot = (child.props as { slot?: unknown }).slot;
    if (typeof slot === 'string') return slot as ArrangementKey;
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
    const overrides = new Map<ArrangementKey, ReactElement>();
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
  /** A host-owned action the chrome registry does not describe. */
  readonly Action: typeof ToolbarAction;
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
  readonly Alignment: ToolbarAlignmentComponent;
  readonly AlignLeft: ToolbarPartComponent;
  readonly AlignCenter: ToolbarPartComponent;
  readonly AlignRight: ToolbarPartComponent;
  readonly AlignJustify: ToolbarPartComponent;
  readonly LineSpacing: ToolbarSlotPartComponent;
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
  readonly FontColor: ToolbarColorSplitComponent;
  readonly Highlight: ToolbarColorSplitComponent;
  readonly Zoom: ToolbarSlotPartComponent;
  readonly StylePicker: typeof ParagraphStyle;
  readonly EditingMode: ToolbarSlotPartComponent;
  readonly Save: ToolbarSlotPartComponent;
  readonly ContentControlShowAll: ToolbarPartComponent;
  readonly ContentControlFormFill: ToolbarPartComponent;
  readonly ContentControlInspector: ToolbarPartComponent;
  readonly ContentControlRemove: ToolbarPartComponent;
}

/**
 * The compound toolbar: `<DocxEditor.Toolbar/>` for the full working chrome, parts as
 * statics for composition (`<DocxEditor.Toolbar><DocxEditor.Toolbar.Bold/>...`).
 *
 * @public
 */
export const DocxEditorToolbar: DocxEditorToolbarNamespace = Object.assign(DocxEditorToolbarRoot, {
  Button: ToolbarButton,
  Action: ToolbarAction,
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
  Alignment: ToolbarAlignment,
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
  StylePicker: ParagraphStyle,
  EditingMode: ToolbarEditingMode,
  Save: ToolbarSave,
  ContentControlShowAll: ToolbarContentControlShowAll,
  ContentControlFormFill: ToolbarContentControlFormFill,
  ContentControlInspector: ToolbarContentControlInspector,
  ContentControlRemove: ToolbarContentControlRemove,
});

export { useFontFamily, useParagraphStyle };
