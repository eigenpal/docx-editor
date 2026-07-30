// The compound toolbar root: a working default set with in-place overrides.
//
// DEFAULT-SET + IN-PLACE OVERRIDE SEMANTICS. With no children the toolbar renders the
// default arrangement (undo/redo, marks, alignment, font family — every slot the
// engine actually wires). WITH children, each child that is a toolbar PART — detected
// by the static slot marker (`Component.docxSlot`, or `ToolbarButton`'s marker plus
// its `slot` prop; never displayName, which minifies away) — REPLACES its slot in the
// default arrangement in place, so `<Toolbar><Bold className="fat"/></Toolbar>` is
// still the whole toolbar with one customized button. A part child with `hidden`
// removes its slot (the part renders null where it stands). Non-part children append
// after the default set. `preset={false}` opts out entirely: children render verbatim.

import { Children, Fragment, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core-contract/editor';
import { ToolbarContext, type ToolbarTranslate } from './toolbar-context';
import { ToolbarButton, guardToolbarMousedown } from './ToolbarButton';
import {
  ToolbarAlignCenter,
  ToolbarAlignJustify,
  ToolbarAlignLeft,
  ToolbarAlignRight,
  ToolbarBold,
  ToolbarItalic,
  ToolbarRedo,
  ToolbarSeparator,
  ToolbarStrike,
  ToolbarUnderline,
  ToolbarUndo,
  type ToolbarPartComponent,
} from './parts';
import { FontFamily, useFontFamily } from './FontFamily';

/** The default arrangement, as slot entries with separators between groups. */
type DefaultEntry = { kind: 'slot'; slot: ChromeSlotId; Part: PartLike } | { kind: 'separator' };
type PartLike = (props: { hidden?: boolean }) => ReactNode;

const DEFAULT_ARRANGEMENT: readonly DefaultEntry[] = [
  { kind: 'slot', slot: 'history.undo', Part: ToolbarUndo },
  { kind: 'slot', slot: 'history.redo', Part: ToolbarRedo },
  { kind: 'separator' },
  { kind: 'slot', slot: 'text.bold', Part: ToolbarBold },
  { kind: 'slot', slot: 'text.italic', Part: ToolbarItalic },
  { kind: 'slot', slot: 'text.underline', Part: ToolbarUnderline },
  { kind: 'slot', slot: 'text.strike', Part: ToolbarStrike },
  { kind: 'separator' },
  { kind: 'slot', slot: 'alignment.left', Part: ToolbarAlignLeft },
  { kind: 'slot', slot: 'alignment.center', Part: ToolbarAlignCenter },
  { kind: 'slot', slot: 'alignment.right', Part: ToolbarAlignRight },
  { kind: 'slot', slot: 'alignment.justify', Part: ToolbarAlignJustify },
  { kind: 'separator' },
  { kind: 'slot', slot: 'font.family', Part: FontFamily },
];

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
   * `false` renders children verbatim with no default arrangement. Default `true`:
   * part children override their slots in place, others append.
   */
  preset?: boolean;
  children?: ReactNode;
}

function DocxEditorToolbarRoot(props: DocxEditorToolbarProps) {
  const { className, t, preset = true, children } = props;
  const context = useMemo(() => ({ t }), [t]);

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
  readonly AlignLeft: ToolbarPartComponent;
  readonly AlignCenter: ToolbarPartComponent;
  readonly AlignRight: ToolbarPartComponent;
  readonly AlignJustify: ToolbarPartComponent;
  readonly FontFamily: typeof FontFamily;
}

/**
 * The compound toolbar: `<DocxEditor.Toolbar/>` for the working default set, parts as
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
  AlignLeft: ToolbarAlignLeft,
  AlignCenter: ToolbarAlignCenter,
  AlignRight: ToolbarAlignRight,
  AlignJustify: ToolbarAlignJustify,
  FontFamily,
});

export { useFontFamily };
