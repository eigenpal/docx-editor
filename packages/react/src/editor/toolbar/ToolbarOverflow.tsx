import type { ReactNode } from 'react';
// The "⋯" control: everything the row could not hold, one press away.
//
// COMMAND ROWS REUSE ENGINE STATE. Each command row goes through `useEditorCommand` and
// the chrome registry for icon, label, enabled/active, and disabled reason — the same
// source as `ToolbarButton` and `Menu.Item`. They render as ordinary buttons inside a
// non-modal dialog popover so value-bearing controls (font pickers, steppers) can keep
// their combobox/input semantics and natural Tab traversal.
//
// VALUE CONTROLS STAY CONTROLS. Font family, size, colour splits, zoom, line spacing,
// the style picker and editing-mode pill render in labelled rows with their real parts.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { chromeSlotIsToggle, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { MORE_ATTRIBUTE } from './useToolbarOverflow';

/**
 * `more_horiz`. Here rather than in the registry for the reason the context menu's icons
 * are: the trigger is not a chrome slot, and giving it one would put a dead control in the
 * default arrangement. Material Symbols (Google, Apache-2.0), viewBox "0 -960 960 960".
 */
const MORE_PATHS: readonly string[] = [
  'M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z',
];

/** One collapsed group in the panel: the registry's label, and the group's rows. */
export interface ToolbarOverflowSection {
  readonly id: string;
  readonly labelKey: string;
  readonly children: ReactNode;
}

export interface ToolbarOverflowProps {
  readonly sections: readonly ToolbarOverflowSection[];
  readonly className?: string;
}

interface OverflowPanelContextValue {
  readonly close: (focusTrigger: boolean) => void;
}

const OverflowPanelContext = createContext<OverflowPanelContextValue>({
  close: () => {},
});

/** Focus the first tabbable control inside the panel. */
function focusFirstInteractive(panel: HTMLElement): void {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  panel.querySelector<HTMLElement>(selector)?.focus();
}

/**
 * A labelled row for a control that shows a value: the part itself, with the name the
 * registry gives it, because a font picker with no label in a vertical list is a mystery.
 */
export function ToolbarOverflowControl({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="docx-toolbar__more-control">
      <span className="docx-toolbar__more-control-label">{label}</span>
      <span className="docx-toolbar__more-control-body">{children}</span>
    </div>
  );
}

/**
 * One chrome command in the overflow panel: ordinary button semantics, shared engine state.
 */
export function ToolbarOverflowItem({ slot }: { readonly slot: ChromeSlotId }) {
  const label = useToolbarLabel();
  const shortcut = usePlatformShortcut();
  const { close } = useContext(OverflowPanelContext);
  const { execute, isActive, isEnabled, disabledReason, value } = useEditorCommand(slot);
  const control = chromeControlForSlot(slot);
  // The same three answers the in-bar button renders, because on a narrow window this IS the
  // button: the toggle rule is the engine's (`chromeSlotIsToggle`), `data-value` is what
  // tells a locked format painter apart from an armed one, and the label is corrected for
  // this keyboard.
  const isToggle = chromeSlotIsToggle(slot);
  const text = shortcut(label(control?.labelKey ?? slot));

  return (
    <button
      type="button"
      className="docx-toolbar__more-command"
      data-slot={slot}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      {...(isToggle ? { 'aria-pressed': isActive } : {})}
      {...(isActive ? { 'data-active': '' } : {})}
      {...(value !== null ? { 'data-value': value } : {})}
      onMouseDown={guardToolbarMousedown}
      onClick={(event) => {
        execute();
        // Keyboard activation unmounts the focused row, so return focus to the trigger.
        // A pointer click keeps the editor selection focused through the mousedown guard.
        close(event.detail === 0);
      }}
    >
      <span className="docx-toolbar__more-command-icon" aria-hidden="true">
        {chromeIcon(control?.paths)}
      </span>
      <span className="docx-toolbar__more-command-label">{text}</span>
    </button>
  );
}

/** The trigger and its panel. Rendered by the toolbar only when something overflowed. */
export function ToolbarOverflow({ sections, className }: ToolbarOverflowProps) {
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusOnOpenRef = useRef(false);
  const panelId = useId();
  const text = label('formattingBar.more');

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const panelContext = useMemo<OverflowPanelContextValue>(() => ({ close }), [close]);

  // Outside press closes. Capture, for the same reason the review rail listens in capture:
  // the painted surface calls `preventDefault` on its own pointer handling and a bubbling
  // listener never sees a press that landed on the pages.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    const panel = panelRef.current;
    if (panel) focusFirstInteractive(panel);
  }, [open]);

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    close(true);
  };

  return (
    <div
      ref={rootRef}
      className={`docx-toolbar__more${className ? ` ${className}` : ''}`}
      {...{ [MORE_ATTRIBUTE]: '' }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="docx-toolbar__button docx-toolbar__more-trigger"
        data-slot="toolbar.more"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={text}
        title={text}
        {...(open ? { 'data-active': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          focusOnOpenRef.current = true;
          setOpen(true);
        }}
      >
        {chromeIcon(MORE_PATHS)}
      </button>
      {open ? (
        <OverflowPanelContext.Provider value={panelContext}>
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={text}
            className="docx-toolbar__more-panel"
            data-testid="toolbar-overflow-panel"
            onKeyDown={onPanelKeyDown}
          >
            {sections.map((section) => (
              <div
                key={section.id}
                className="docx-toolbar__more-section"
                role="group"
                aria-label={label(section.labelKey)}
              >
                <span className="docx-toolbar__more-heading" aria-hidden="true">
                  {label(section.labelKey)}
                </span>
                {section.children}
              </div>
            ))}
          </div>
        </OverflowPanelContext.Provider>
      ) : null}
    </div>
  );
}
