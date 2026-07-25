// Toolbar (interactive-paginated-editing M4.5, extended to full legacy parity at M6V.1).
// Shared adapter presentation and compatibility behavior.
// presentation. The legacy toolbar imported `prosemirror-history` and read
// `undoDepth`/`redoDepth` off a PM `EditorState` to decide what was enabled —
// exactly the adapter-side PM access the greenfield architecture forbids.
//
// Here every control's enabled state is one `Editor.can(command)` answer, and a
// click runs `Editor.exec(command)` only after `can` said yes. Save is not a
// command: it calls `Editor.save()` directly. A control the engine cannot honour
// renders disabled with the engine's own reason as its tooltip, so the UI can
// never claim a capability the engine does not have.
//
// M6V.1 renders the COMPLETE legacy group set for visual parity. Groups, ordering,
// icons, and i18n keys all come from `LEGACY_CHROME_GROUPS` in engine-editor so
// React and Vue cannot drift — a previous round of this change grew 24 React-only
// exports by putting shared shape in one adapter, and only a full-repo
// export-parity sweep caught it.
//
// Only undo, redo, bold, italic, and save may act. Everything else is present,
// visible, and permanently disabled: dropping it would understate the parity gap,
// and enabling it would claim a capability that does not exist.

import * as Select from '@radix-ui/react-select';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import {
  LEGACY_CHROME_GROUPS,
  LEGACY_CHROME_UNAVAILABLE_KEY,
  type LegacyChromeControl,
} from '@docx-editor.dev/engine-editor';
import { useEditorSnapshot } from '../../useEditorSnapshot';
import { runToolbarCommand, toolbarCommandState } from '../../toolbarCommands';

/** The legacy dropdown chevron. Replaces a literal "▾" text glyph, which rendered at the
 *  font's own weight and baseline and read as a stray character beside the Material
 *  Symbols icons rather than as part of the control. */
function Caret(): React.ReactElement {
  return (
    <svg className="shrink-0 opacity-60" viewBox="0 -960 960 960" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M480-360 280-560h400L480-360Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Resolves an i18n key to display text.
 *
 * Required, not optional with an English fallback. `packages/i18n/en.json` is the
 * repo's single source of truth for user-facing strings, so shipping a fallback
 * table inside the adapter would create a second one — and CLAUDE.md forbids
 * hardcoded user-facing English in components. The host supplies the translator;
 * the adapter only ever holds keys.
 */
export type Translate = (key: string) => string;

/** Legacy picker widths, from the `<StylePicker width={120} />` / `<FontPicker
 *  width={60} />` / `<FontSizePicker width={42} />` call sites in the legacy Toolbar. */
const PICKER_WIDTH: Record<string, number> = { style: 120, fontFamily: 60, fontSize: 42 };

function ToolbarIcon({ paths }: { readonly paths: readonly string[] }): ReactNode {
  return (
    <svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function ControlButton({
  editor,
  control,
  t,
  onSave,
}: {
  readonly editor: Editor | null;
  readonly control: LegacyChromeControl;
  readonly t: Translate;
  readonly onSave?: () => void;
}): ReactNode {
  const label = t(control.labelKey);

  // A control's SHAPE, not just its presence. The legacy toolbar mixes labelled
  // dropdowns, numeric steppers with visible values, and split colour controls; a row of
  // uniform icon buttons has every region present and still does not look like the
  // product, which is what an owner review rejected.
  const noFocusSteal = (event: { preventDefault: () => void }) => event.preventDefault();

  if (control.shape === 'stepper') {
    // Tailwind utilities over the shared token palette, per the owner directive: ONE
    // styling system, not a bespoke stylesheet beside it. The `.ep-toolbar__stepper*`,
    // `__color*`, and `__picker*` rules are deleted from the core stylesheet; Vue still
    // renders those class names and is knowingly unstyled here until it migrates at
    // 10V.1, which the owner chose over carrying two systems.
    return (
      <span
        className="inline-flex h-[30px] items-center gap-1"
        data-testid={`toolbar-${control.id}`}
        aria-disabled="true"
        title={`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}
        aria-label={`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}
        onMouseDown={noFocusSteal}
      >
        {/* VERBATIM from the legacy stepper buttons. */}
        <span className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80" aria-hidden="true">
          −
        </span>
        {/* VERBATIM from the legacy `ui/FontSizePicker.tsx` value input. */}
        <span className="h-7 w-10 text-center text-sm border border-border bg-doc-bg-input text-doc-text grid place-items-center rounded">
          {control.valueText ?? ''}
        </span>
        <span className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80" aria-hidden="true">
          +
        </span>
      </span>
    );
  }

  if (control.shape === 'colorSplit') {
    return (
      <span
        className={clsx(
          'inline-flex h-[30px] items-center gap-0.5 rounded px-1',
          'text-foreground/90 transition-colors hover:bg-black/[0.04]',
        )}
        data-testid={`toolbar-${control.id}`}
        aria-disabled="true"
        title={`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}
        aria-label={`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}
        onMouseDown={noFocusSteal}
      >
        {/* Glyph above the colour bar, as the legacy split control renders it. */}
        <span className="flex flex-col items-center gap-[2px]" aria-hidden="true">
          {control.paths ? <ToolbarIcon paths={control.paths} /> : null}
          <span
            className="h-[3px] w-[16px] rounded-[1px]"
            style={{ background: control.swatch ?? 'transparent' }}
          />
        </span>
        <Caret />
      </span>
    );
  }

  if (control.shape === 'dropdown' || control.paths === null) {
    const value = control.valueKey ? t(control.valueKey) : '';
    // Radix `Select`, as the legacy adapter used, rather than a hand-rolled span. The
    // trigger is a real button with the right ARIA and disabled semantics, and its look
    // comes from Tailwind utilities over the shared token palette instead of bespoke
    // `.ep-toolbar__picker` rules, which are now deleted. Parity-only for now, so the
    // trigger is disabled and no content is mounted — M6V.3 wires the real option lists.
    return (
      <Select.Root disabled>
        <Select.Trigger
          // VERBATIM from the legacy `ui/Select.tsx` trigger at
          // packages/react/src/components/ui/Select.tsx,
          // rather than an approximation of it. The earlier hand-tuned values (h-[30px],
          // text-[13px], hover:border-border) were close but visibly off against the
          // reference — the owner compared the two side by side.
          className={clsx(
            'flex h-8 items-center justify-between gap-1 rounded px-2 py-1',
            'text-sm text-foreground bg-transparent',
            'hover:bg-muted/80 focus:outline-none focus:bg-muted/80',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors duration-150',
            '[&>span]:truncate',
          )}
          // Fixed widths from the legacy call site in `Toolbar.tsx`: the style picker is
          // 120px, the font picker 60px, the font-size picker 42px. Left to shrink-wrap,
          // the controls jitter as their value changes and the groups never line up with
          // the reference.
          style={{ width: PICKER_WIDTH[control.id] ?? undefined }}
          data-testid={`toolbar-${control.id}`}
          data-parity-only="true"
          // The reason belongs on the control itself, not in a visually-hidden child:
          // the trigger is a real button, and the parity gate requires every
          // `data-parity-only` control to carry a LOCALIZED reason it can read.
          title={`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}
          aria-label={`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}
          onMouseDown={noFocusSteal}
        >
          {control.paths ? <ToolbarIcon paths={control.paths} /> : null}
          {value ? <span className="truncate">{value}</span> : null}
          <Select.Icon asChild>
            <Caret />
          </Select.Icon>
        </Select.Trigger>
      </Select.Root>
    );
  }

  if (control.state.kind === 'parityOnly') {
    const reason = `${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`;
    return (
      <button
        type="button"
        className={clsx(
          // Same resting/hover/disabled treatment as the legacy Select trigger, so the
          // ribbon reads as one control set rather than two.
          'inline-flex h-8 w-8 items-center justify-center rounded border-none',
          'bg-transparent text-foreground transition-colors duration-150',
          'hover:enabled:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        data-testid={`toolbar-${control.id}`}
        data-parity-only="true"
        disabled
        title={reason}
        aria-label={reason}
        // Even a DISABLED control must not steal focus. Round-5 review measured all 24
        // parity-only controls moving `document.activeElement` to BODY, dropping
        // `frame.focus.focused`, un-painting the caret, and leaving all six geometry
        // keys refused — 24/24 in both adapters. Clicking the visible Underline button
        // cost the user their caret and their keyboard.
        onMouseDown={(event) => event.preventDefault()}
      >
        <ToolbarIcon paths={control.paths} />
      </button>
    );
  }

  if (control.state.kind === 'save') {
    return (
      <button
        type="button"
        className={clsx(
          // Same resting/hover/disabled treatment as the legacy Select trigger, so the
          // ribbon reads as one control set rather than two.
          'inline-flex h-8 w-8 items-center justify-center rounded border-none',
          'bg-transparent text-foreground transition-colors duration-150',
          'hover:enabled:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        data-testid={`toolbar-${control.id}`}
        disabled={!editor || !onSave}
        title={label}
        aria-label={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSave}
      >
        <ToolbarIcon paths={control.paths} />
      </button>
    );
  }

  const commandId = control.state.command;
  const state = toolbarCommandState(editor, commandId);
  // Active/pressed state, wired through the public facade.
  //
  // `Editor.isActive` is a deliberate placeholder returning `false` today; the wiring is
  // the point. Both adapters read active state through one public method, so filling in
  // the derivation lights up the toolbars with no adapter change — and the active
  // treatment below is the legacy one (`--doc-toggle-active-bg`: a dark slab in light
  // mode, a Word-accent tint in dark), not an invented look.
  return (
    <button
      type="button"
      data-active={state.active ? 'true' : undefined}
      aria-pressed={state.active}
      className={clsx(
          // Same resting/hover/disabled treatment as the legacy Select trigger, so the
          // ribbon reads as one control set rather than two.
          'inline-flex h-8 w-8 items-center justify-center rounded border-none',
          'bg-transparent text-foreground transition-colors duration-150',
          'hover:enabled:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      data-testid={`toolbar-${control.id}`}
      disabled={!state.enabled}
      // The engine's own words, never an adapter paraphrase.
      title={state.disabledReason ?? label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()} // keep focus on the editor
      onClick={() => runToolbarCommand(editor, commandId)}
    >
      <ToolbarIcon paths={control.paths} />
    </button>
  );
}

export interface DocxEditorToolbarProps {
  readonly editor: Editor | null;
  /** Resolves i18n keys. The adapter ships no English of its own. */
  readonly t: Translate;
  /** Save handler — the host decides what to do with the bytes. */
  readonly onSave?: () => void;
}

export function DocxEditorToolbar({ editor, t, onSave }: DocxEditorToolbarProps): ReactNode {
  // Re-render as the selection and document change, or `can()` answers go stale.
  useEditorSnapshot(editor);
  return (
    <div
      // VERBATIM from the legacy toolbar root in
      // packages/react/src/components/Toolbar.tsx:679.
      // The hand-rolled `.ep-toolbar` rule invented its own padding, margins, min-height
      // AND a `--doc-toolbar-pill` colour token that does not exist in legacy — the band
      // is `bg-muted`, which is why the colour never matched.
      className={clsx(
        'ep-toolbar',
        'flex items-center px-2 py-1 bg-muted rounded-full min-h-[36px] overflow-x-auto mx-2 mb-1',
      )}
      role="toolbar"
      aria-label={t('toolbar.ariaLabel')}
      data-testid="docx-editor-toolbar"
      // Focus protection belongs HERE, on the container, not on each control.
      //
      // Per-button `onMouseDown={preventDefault}` is dead code on a disabled control:
      // Chromium does not dispatch mouse events to disabled form controls, so the
      // handler never runs while focus still leaves the editor. Round-6 review proved
      // it with a real trusted click and explained why round 5 measured it as fixed —
      // under synthetic `dispatchEvent` the handler DOES fire and `activeElement` never
      // moves, so a JS-driven probe reports success either way. 20 of 29 controls were
      // still losing the caret, focus, and all six geometry keys in the real app.
      //
      // `pointer-events: none` on the button is also not enough: the click then lands
      // on this container, whose mousedown blurs the editor just the same. One handler
      // on the container covers every child, disabled or not, and cannot be bypassed
      // by adding a control later.
      onMouseDown={(event) => event.preventDefault()}
    >
      {LEGACY_CHROME_GROUPS.map((group, index) => (
        <div key={group.id} className="ep-toolbar__group-wrap inline-flex items-center">
          {/* `Toolbar.tsx:365` — a real 1px element, not a border on the group. */}
          {index > 0 ? <div className="w-px h-6 bg-border mx-1.5" role="separator" /> : null}
          <div
            className="ep-toolbar__group flex items-center gap-px px-1.5"
            role="group"
            aria-label={t(group.labelKey)}
            data-group={group.id}
          >
            {group.controls.map((control) => (
              <ControlButton key={control.id} editor={editor} control={control} t={t} onSave={onSave} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
