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
//
// ONE ROW, MEASURED. The bar used to wrap to a second and third row when it ran out of
// width, which on a laptop beside an open navigation pane cost more vertical space than the
// first page of the document. Now it measures itself and moves whole GROUPS into a "⋯"
// menu (`useToolbarOverflow` for the measurement, `toolbar-overflow.ts` for the policy).
// That is why the default arrangement below is a list of groups rather than a flat list of
// slots: a group is the unit that collapses, and its registry label becomes the panel's
// section heading. `overflow={false}` restores wrapping.

import { ToolbarEditingMode } from './EditingMode';
import { Children, Fragment, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { unwrapFragment } from '../merge-arrangement';
import {
  chromeSlotId,
  defaultChromeGroups,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import { ToolbarContext, type ToolbarTranslate } from './toolbar-context';
import { ToolbarButton, chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import {
  ToolbarOverflow,
  ToolbarOverflowControl,
  ToolbarOverflowItem,
  type ToolbarOverflowSection,
} from './ToolbarOverflow';
import { collapseOrder, TOOLBAR_PINNED_GROUPS } from './toolbar-overflow';
import { FIXED_ATTRIBUTE, GROUP_ATTRIBUTE, useToolbarOverflow } from './useToolbarOverflow';
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
import {
  TableChromeGroup,
  ToolbarTableBorderColor,
  ToolbarTableBorderStyle,
  ToolbarTableBorderTarget,
  ToolbarTableBorderWidth,
  ToolbarTableCellFill,
  type TableBorderColorNamespace,
  type TableBorderStyleNamespace,
  type TableBorderTargetNamespace,
  type TableBorderWidthNamespace,
  type TableCellFillNamespace,
} from './TableControls';
import { TableChromeProvider } from './useTableChrome';

/** Contextual table chrome slots appended when the caret is inside a table. */
const TABLE_CHROME_SLOTS: readonly ArrangementKey[] = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
];

/**
 * A default-arrangement key: a chrome slot, or `'alignment'` for the MERGED
 * alignment dropdown that stands in for the four `alignment.*` slots.
 */
type ArrangementKey = ChromeSlotId | 'alignment';

/** One default-arrangement entry: the slot and the part that draws it. */
interface DefaultEntry {
  readonly slot: ArrangementKey;
  readonly Part: PartLike;
}

/** A registry group as the toolbar renders it: the collapse unit and a panel section. */
interface DefaultGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly entries: readonly DefaultEntry[];
}

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
  'table.borderTarget': ToolbarTableBorderTarget,
  'table.borderColor': ToolbarTableBorderColor,
  'table.borderStyle': ToolbarTableBorderStyle,
  'table.borderWidth': ToolbarTableBorderWidth,
  'table.cellFill': ToolbarTableCellFill,
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
const DEFAULT_GROUPS: readonly DefaultGroup[] = defaultChromeGroups().map((group) => {
  if (group.id === 'alignment') {
    return {
      id: group.id,
      labelKey: group.labelKey,
      entries: [{ slot: 'alignment' as ArrangementKey, Part: ToolbarAlignment }],
    };
  }
  return {
    id: group.id,
    labelKey: group.labelKey,
    entries: group.controls.map((control) => {
      const slot = chromeSlotId(group, control);
      return { slot: slot as ArrangementKey, Part: SHAPED_PARTS[slot] ?? iconPart(slot) };
    }),
  };
});

/** Every slot the default arrangement draws, for recognizing an override child. */
const DEFAULT_SLOTS: ReadonlySet<ArrangementKey> = new Set(
  DEFAULT_GROUPS.flatMap((group) => group.entries.map((entry) => entry.slot))
);

/** Collapsible group ids in bar order, and the order they collapse in. */
const COLLAPSIBLE = DEFAULT_GROUPS.map((group) => group.id).filter(
  (id) => !TOOLBAR_PINNED_GROUPS.has(id)
);
const COLLAPSE_ORDER = collapseOrder(COLLAPSIBLE);

/** Slots whose panel row is the CONTROL itself, because it shows a value. */
function isValueSlot(slot: ArrangementKey): boolean {
  return slot === 'alignment' || slot in SHAPED_PARTS;
}

/** The slot one child element drives, or null for a non-part child. */
function slotOfChild(child: ReactNode): ArrangementKey | null {
  const unwrapped = unwrapFragment(child, slotOfChild);
  if (unwrapped !== null) return unwrapped as ArrangementKey;
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
  /**
   * `false` lets the bar WRAP to more rows instead of collapsing groups into the "⋯"
   * menu when it runs out of width. Default `true`.
   */
  overflow?: boolean;
  children?: ReactNode;
}

/** Whether a node tree contains any contextual table chrome part (recursive child walk). */
function walkForTableChromeParts(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (Array.isArray(node)) return node.some(walkForTableChromeParts);
  const slot = slotOfChild(node);
  if (slot != null && (TABLE_CHROME_SLOTS as readonly string[]).includes(slot)) return true;
  if (isValidElement(node)) {
    return Children.toArray((node.props as { children?: ReactNode }).children).some(
      walkForTableChromeParts
    );
  }
  return false;
}

function includesTableChromeParts(children: ReactNode, preset: boolean): boolean {
  if (preset) return true;
  return Children.toArray(children).some(walkForTableChromeParts);
}

function DocxEditorToolbarRoot(props: DocxEditorToolbarProps) {
  const { className, t, onSave, preset = true, overflow: overflowEnabled = true, children } = props;
  const context = useMemo(() => ({ t, onSave }), [t, onSave]);

  // Only the preset arrangement has groups to collapse; `preset={false}` is the host's own
  // markup, and moving pieces of it into a menu would be the library rearranging a bar it
  // does not own.
  const measuring = preset && overflowEnabled;
  const { attach, overflow } = useToolbarOverflow(measuring, COLLAPSIBLE, COLLAPSE_ORDER);

  let content: ReactNode;
  if (!preset) {
    content = children;
  } else {
    const kids = Children.toArray(children);
    const overrides = new Map<ArrangementKey, ReactElement>();
    const tableOverrides = new Map<ArrangementKey, ReactElement>();
    const appended: ReactNode[] = [];
    for (const child of kids) {
      const slot = slotOfChild(child);
      if (slot && DEFAULT_SLOTS.has(slot)) {
        // Last override for a slot wins, matching how later props win in a spread.
        overrides.set(slot, child as ReactElement);
      } else if (slot && (TABLE_CHROME_SLOTS as readonly string[]).includes(slot)) {
        tableOverrides.set(slot, child as ReactElement);
      } else {
        appended.push(child);
      }
    }

    const render = (entry: DefaultEntry): ReactNode => {
      // A `hidden` override renders null where it stands, removing the slot.
      const override = overrides.get(entry.slot);
      if (override) return override;
      const Part = entry.Part;
      return <Part />;
    };

    const bar: ReactNode[] = [];
    const sections: ToolbarOverflowSection[] = [];
    let drawn = 0;
    for (const group of DEFAULT_GROUPS) {
      if (overflow.has(group.id)) {
        const rows = group.entries.flatMap((entry) => {
          const row = overflowRow(entry, overrides, t, group.labelKey, render);
          if (row === null) return [];
          return [<Fragment key={entry.slot}>{row}</Fragment>];
        });
        if (rows.length === 0) continue;
        sections.push({
          id: group.id,
          labelKey: group.labelKey,
          children: rows,
        });
        continue;
      }
      // The separator belongs BETWEEN what is on screen. Keyed on the group so a collapse
      // does not renumber the ones that stayed.
      if (drawn > 0) bar.push(<ToolbarSeparator key={`separator-${group.id}`} />);
      drawn += 1;
      const pinned = TOOLBAR_PINNED_GROUPS.has(group.id);
      bar.push(
        <div
          key={group.id}
          className="docx-toolbar__group"
          // Pinned groups are costed as fixed width rather than offered to the fit.
          {...(pinned ? { [FIXED_ATTRIBUTE]: '' } : { [GROUP_ATTRIBUTE]: group.id })}
        >
          {group.entries.map((entry) => (
            <Fragment key={entry.slot}>{render(entry)}</Fragment>
          ))}
        </div>
      );
    }

    content = (
      <>
        {bar}
        <TableChromeGroup overrides={tableOverrides} />
        {appended.length > 0 ? (
          // Host children never collapse — the library does not own them — so they are
          // costed as fixed width like a pinned group.
          <div className="docx-toolbar__group" {...{ [FIXED_ATTRIBUTE]: '' }}>
            {appended}
          </div>
        ) : null}
        {sections.length > 0 ? <ToolbarOverflow sections={sections} /> : null}
      </>
    );
  }

  return (
    <ToolbarContext.Provider value={context}>
      <div
        ref={attach}
        role="toolbar"
        data-testid="docx-toolbar"
        className={`docx-toolbar${className ? ` ${className}` : ''}`}
        // One row when the bar measures itself, wrapping when it does not: the stylesheet
        // reads this rather than guessing from a breakpoint.
        {...(measuring ? { 'data-overflow': '' } : {})}
        // Container-level caret guard (CLAUDE.md focus-stealing pitfall): a disabled
        // button never receives mousedown, so per-button handlers cannot cover it.
        // Form fields are exempt inside the guard itself.
        onMouseDown={guardToolbarMousedown}
      >
        {includesTableChromeParts(children, preset) ? (
          <TableChromeProvider>{content}</TableChromeProvider>
        ) : (
          content
        )}
      </div>
    </ToolbarContext.Provider>
  );
}

/** True when an override child removes its slot from the arrangement. */
function isHiddenOverride(override: ReactElement | undefined): boolean {
  if (!override) return false;
  return Boolean((override.props as { hidden?: boolean }).hidden);
}

/** One row in a collapsed group's overflow panel, or null when hidden. */
function overflowRow(
  entry: DefaultEntry,
  overrides: Map<ArrangementKey, ReactElement>,
  t: ToolbarTranslate | undefined,
  groupLabelKey: string,
  render: (entry: DefaultEntry) => ReactNode
): ReactNode {
  const override = overrides.get(entry.slot);
  if (isHiddenOverride(override)) return null;
  if (override || isValueSlot(entry.slot)) {
    return (
      <ToolbarOverflowControl label={labelOf(t, entry, groupLabelKey)}>
        {render(entry)}
      </ToolbarOverflowControl>
    );
  }
  return <ToolbarOverflowItem slot={entry.slot as ChromeSlotId} />;
}

/** A panel control row's label: the slot's own registry label, else its group's. */
function labelOf(
  t: ToolbarTranslate | undefined,
  entry: DefaultEntry,
  groupLabelKey: string
): string {
  const control = entry.slot === 'alignment' ? null : chromeControlForSlot(entry.slot);
  const key = control?.labelKey ?? groupLabelKey;
  return t?.(key) ?? key;
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
  /** Border-edge target picker compound for contextual table chrome. */
  readonly TableBorderTarget: TableBorderTargetNamespace;
  /** Border-colour split compound (quick-apply main + swatch dialog). */
  readonly TableBorderColor: TableBorderColorNamespace;
  /** Border line-style menu compound. */
  readonly TableBorderStyle: TableBorderStyleNamespace;
  /** Border width menu compound. */
  readonly TableBorderWidth: TableBorderWidthNamespace;
  /** Cell background fill split compound (quick-apply main + swatch dialog). */
  readonly TableCellFill: TableCellFillNamespace;
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
  TableBorderTarget: ToolbarTableBorderTarget,
  TableBorderColor: ToolbarTableBorderColor,
  TableBorderStyle: ToolbarTableBorderStyle,
  TableBorderWidth: ToolbarTableBorderWidth,
  TableCellFill: ToolbarTableCellFill,
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
