// The split colour controls: font colour and text highlight.
//
// Both are WIRED value slots. The MAIN half applies the last-used value (seeded from
// the registry's swatch — the red "A"); the narrow CHEVRON half
// opens a compact swatch grid whose picks dispatch
// `commandForSlotValue(slot, value)` through the can-before-exec gate. The popup
// follows the FontFamily pattern: outside mousedown closes it, a pick applies and
// closes, and every control keeps the caret (mousedown prevented).
//
// Swatch values are CONSTANTS in this file — never file- or user-derived — so the
// inline `backgroundColor` style objects are not a string sink for untrusted data.
// The engine still validates every dispatched value (`setMarkAttr`'s hex /
// ST_HighlightColor gates); a malformed constant would be refused, not applied.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { commandForSlotValue, type ChromeSlotId } from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps, ToolbarSlotPartComponent } from './parts';

interface SwatchDef {
  /** The value dispatched to the engine (hex without '#', or an ST_HighlightColor name). */
  readonly value: string;
  /** i18n key for the colour's accessible name. */
  readonly labelKey: string;
  /** The CSS colour painted in the grid (a constant, never derived data). */
  readonly css: string;
}

/** Word's standard-colour row plus neutrals — 16 swatches, `w:color` hex values. */
const FONT_COLOR_SWATCHES: readonly SwatchDef[] = [
  { value: '000000', labelKey: 'colorPicker.colors.black', css: '#000000' },
  { value: '404040', labelKey: 'colorPicker.colors.darkGray', css: '#404040' },
  { value: '808080', labelKey: 'colorPicker.colors.gray', css: '#808080' },
  { value: 'FFFFFF', labelKey: 'colorPicker.colors.white', css: '#ffffff' },
  { value: 'C00000', labelKey: 'colorPicker.colors.darkRed', css: '#c00000' },
  { value: 'FF0000', labelKey: 'colorPicker.colors.red', css: '#ff0000' },
  { value: 'FFC000', labelKey: 'colorPicker.colors.orange', css: '#ffc000' },
  { value: 'FFFF00', labelKey: 'colorPicker.colors.yellow', css: '#ffff00' },
  { value: '92D050', labelKey: 'colorPicker.colors.lightGreen', css: '#92d050' },
  { value: '00B050', labelKey: 'colorPicker.colors.green', css: '#00b050' },
  { value: '00B0F0', labelKey: 'colorPicker.colors.lightBlue', css: '#00b0f0' },
  { value: '0070C0', labelKey: 'colorPicker.colors.blue', css: '#0070c0' },
  { value: '002060', labelKey: 'colorPicker.colors.darkBlue', css: '#002060' },
  { value: '7030A0', labelKey: 'colorPicker.colors.purple', css: '#7030a0' },
  { value: '833C00', labelKey: 'colorPicker.colors.brown', css: '#833c00' },
  { value: '008080', labelKey: 'colorPicker.colors.teal', css: '#008080' },
];

/**
 * The closed `ST_HighlightColor` palette, in the engine's own order
 * (`HIGHLIGHT_NAMES`), painted with the same hexes the paint lane maps them to
 * (semantic-paint's HIGHLIGHT table — spec-fixed values, duplicated as constants).
 */
const HIGHLIGHT_SWATCHES: readonly SwatchDef[] = [
  { value: 'yellow', labelKey: 'colorPicker.colors.yellow', css: '#ffff00' },
  { value: 'green', labelKey: 'colorPicker.colors.green', css: '#00ff00' },
  { value: 'cyan', labelKey: 'colorPicker.colors.cyan', css: '#00ffff' },
  { value: 'magenta', labelKey: 'colorPicker.colors.magenta', css: '#ff00ff' },
  { value: 'blue', labelKey: 'colorPicker.colors.blue', css: '#0000ff' },
  { value: 'red', labelKey: 'colorPicker.colors.red', css: '#ff0000' },
  { value: 'darkBlue', labelKey: 'colorPicker.colors.darkBlue', css: '#000080' },
  { value: 'darkCyan', labelKey: 'colorPicker.colors.darkCyan', css: '#008080' },
  { value: 'darkGreen', labelKey: 'colorPicker.colors.darkGreen', css: '#008000' },
  { value: 'darkMagenta', labelKey: 'colorPicker.colors.darkMagenta', css: '#800080' },
  { value: 'darkRed', labelKey: 'colorPicker.colors.darkRed', css: '#800000' },
  { value: 'darkYellow', labelKey: 'colorPicker.colors.darkYellow', css: '#808000' },
  { value: 'darkGray', labelKey: 'colorPicker.colors.darkGray', css: '#808080' },
  { value: 'lightGray', labelKey: 'colorPicker.colors.lightGray', css: '#c0c0c0' },
  { value: 'black', labelKey: 'colorPicker.colors.black', css: '#000000' },
  { value: 'white', labelKey: 'colorPicker.colors.white', css: '#ffffff' },
];

interface ColorSplitConfig {
  readonly slot: ChromeSlotId;
  readonly swatches: readonly SwatchDef[];
  /** The seed value for the main half, from the registry's swatch. */
  readonly defaultValue: string;
  /** CSS colour for an applied value (hex slots prefix '#', highlight looks up). */
  readonly cssOf: (value: string) => string;
}

function createColorSplit(config: ColorSplitConfig): ToolbarSlotPartComponent {
  const { slot, swatches, defaultValue, cssOf } = config;

  const Part = ({ className, hidden }: ToolbarSlotPartProps) => {
    const editor = useDocxEditor();
    const { isEnabled, disabledReason } = useEditorCommand(slot);
    const label = useToolbarLabel();
    const [open, setOpen] = useState(false);
    const [lastValue, setLastValue] = useState(defaultValue);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Outside mousedown closes the popup — mousedown, not click, so the popup is gone
    // before any click lands (same reasoning as FontFamily.Content).
    useEffect(() => {
      if (!open) return undefined;
      const onMouseDown = (event: globalThis.MouseEvent) => {
        const root = rootRef.current;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        setOpen(false);
      };
      document.addEventListener('mousedown', onMouseDown);
      return () => document.removeEventListener('mousedown', onMouseDown);
    }, [open]);

    const apply = useCallback(
      (value: string) => {
        setOpen(false);
        if (!editor) return;
        const command = commandForSlotValue(slot, value);
        if (!command) return;
        if (editor.can(command).ok) {
          editor.exec(command);
          setLastValue(value);
        }
      },
      [editor]
    );

    const control = useMemo(() => chromeControlForSlot(slot), []);
    if (hidden) return null;
    const text = label(control?.labelKey ?? slot);
    return (
      <div
        ref={rootRef}
        className={`docx-toolbar__colorsplit${className ? ` ${className}` : ''}`}
        data-slot={slot}
      >
        <button
          type="button"
          className="docx-toolbar__button docx-toolbar__colorsplit-main"
          disabled={!isEnabled}
          {...(!isEnabled ? { 'data-disabled': '' } : {})}
          aria-label={text}
          title={disabledReason ?? text}
          onMouseDown={guardToolbarMousedown}
          onClick={() => apply(lastValue)}
        >
          {chromeIcon(control?.paths)}
          <span
            className="docx-toolbar__colorsplit-bar"
            style={{ backgroundColor: cssOf(lastValue) }}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="docx-toolbar__colorsplit-caret"
          disabled={!isEnabled}
          {...(!isEnabled ? { 'data-disabled': '' } : {})}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={text}
          title={disabledReason ?? text}
          onMouseDown={guardToolbarMousedown}
          onClick={() => setOpen((current) => !current)}
        >
          ▾
        </button>
        {open ? (
          <div className="docx-toolbar__swatch-popup">
            {swatches.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                className="docx-toolbar__swatch"
                style={{ backgroundColor: swatch.css }}
                aria-label={label(swatch.labelKey)}
                title={label(swatch.labelKey)}
                data-value={swatch.value}
                onMouseDown={guardToolbarMousedown}
                onClick={() => apply(swatch.value)}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  };
  return Object.assign(Part, { docxSlot: slot });
}

const HIGHLIGHT_CSS = new Map(HIGHLIGHT_SWATCHES.map((swatch) => [swatch.value, swatch.css]));

/**
 * The font-colour split button (`DocxEditorToolbar.FontColor`): wired to `text.color`.
 * The seed is the registry swatch (the chrome spec's default red: the apply
 * half starts at `{ rgb: 'FF0000' }` before any pick).
 */
export const ToolbarFontColor: ToolbarSlotPartComponent = createColorSplit({
  slot: 'text.color',
  swatches: FONT_COLOR_SWATCHES,
  // The registry's `swatch: '#ff0000'`, as the hex value `w:color` takes.
  defaultValue: 'FF0000',
  cssOf: (value) => `#${value}`,
});

/**
 * The highlight split button (`DocxEditorToolbar.Highlight`): wired to
 * `text.highlight`, values from the closed ST_HighlightColor palette.
 */
export const ToolbarHighlight: ToolbarSlotPartComponent = createColorSplit({
  slot: 'text.highlight',
  swatches: HIGHLIGHT_SWATCHES,
  defaultValue: 'yellow',
  cssOf: (value) => HIGHLIGHT_CSS.get(value) ?? '#ffff00',
});
