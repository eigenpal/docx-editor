// `ColorPicker`: the one colour control of the editor, as a compound a host can place anywhere.
// `Root` holds the value and the open state, `Trigger` opens the grid, `Content` is the grid
// (No colour, the theme colours with their tints and shades, the standard colours, and a hex
// field), and `Swatch`, `NoColor`, and `HexInput` are its parts. The grid focuses the current
// colour, the arrow keys move in it, Escape closes it, and the focus returns to the trigger.
// The model is core's (`color-picker.ts`); the Vue twin is
// `packages/vue/src/editor/color/ColorPicker.tsx` and renders the same markup.

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement } from 'react';
import {
  colorPickerGrid,
  colorPickFromHexText,
  colorPickHex,
  colorPickIsCurrent,
  colorPickLabel,
  documentThemeHexes,
  focusColorSwatch,
  hostDocumentOf,
  isDomNode,
  moveColorSwatchFocus,
  type ColorPick,
} from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { Slot } from '../toolbar/Slot';

/** The value of a picker: a pick, `none` for No colour, or null when the target is mixed. @public */
export type ColorPickerValue = ColorPick | 'none' | null;

interface ColorPickerContextValue {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly value: ColorPickerValue;
  readonly pick: (next: ColorPick | 'none') => void;
  readonly themeHexes: readonly string[];
  readonly disabled: boolean;
  readonly noColor: 'none' | 'auto' | false;
  readonly automaticHex: string | undefined;
  readonly triggerRef: { current: HTMLButtonElement | null };
  readonly contentId: string;
  readonly label: (pick: ColorPick) => string;
}

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);

function usePicker(part: string): ColorPickerContextValue {
  const context = useContext(ColorPickerContext);
  if (!context) throw new Error(`ColorPicker.${part} must be inside ColorPicker.Root`);
  return context;
}

/** Props for `ColorPicker.Root`. @public */
export interface ColorPickerRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** More class names for the element. */
  className?: string;
  /** The current pick, `none` for No colour, or null when the target shows several colours. */
  value: ColorPickerValue;
  /** Called with the picked colour, or `none` (or `auto`) for the first button of the grid. */
  onPick: (pick: ColorPick | 'none') => void;
  /**
   * What the first button of the grid means: `none` (No colour, the default), `auto`
   * (Automatic), or false for no such button.
   */
  noColor?: 'none' | 'auto' | false;
  /** The colour that Automatic paints, `#RRGGBB`. */
  automaticHex?: string;
  /** The theme colours, `RRGGBB` in slot order; default the document's. */
  themeHexes?: readonly string[];
  disabled?: boolean;
  /** Open state, for a controlled picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
}

function ColorPickerRoot({
  value,
  onPick,
  noColor = 'none',
  automaticHex,
  themeHexes,
  disabled = false,
  open: openProp,
  onOpenChange,
  asChild,
  className,
  children,
  ...rest
}: ColorPickerRootProps): ReactElement {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const [openState, setOpenState] = useState(false);
  const open = (openProp ?? openState) && !disabled;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentId = useId();
  const hexes = themeHexes ?? documentThemeHexes(editor?.getDocumentThemeColors());
  const context = useMemo<ColorPickerContextValue>(() => {
    const setOpen = (next: boolean): void => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    };
    return {
      open,
      setOpen,
      value,
      pick: (next) => {
        setOpen(false);
        triggerRef.current?.focus();
        onPick(next);
      },
      themeHexes: hexes,
      disabled,
      noColor,
      automaticHex,
      triggerRef,
      contentId,
      label: (pick) => colorPickLabel(pick, (key, params) => t(key as TranslationKey, params)),
    };
  }, [
    open,
    openProp,
    onOpenChange,
    value,
    onPick,
    hexes,
    disabled,
    noColor,
    automaticHex,
    contentId,
    t,
  ]);
  const Comp = asChild ? Slot : 'div';
  return (
    <ColorPickerContext.Provider value={context}>
      <Comp
        className={`docx-color-picker docx-chart-pane__color docx-shape-pane__color${className ? ` ${className}` : ''}`}
        data-open={open || undefined}
        {...rest}
      >
        {children}
      </Comp>
    </ColorPickerContext.Provider>
  );
}

/** The paint of the picker's value, `#RRGGBB`, or null for No colour or a mixed target. */
function valueHex(context: ColorPickerContextValue): string | null {
  const { value } = context;
  if (value === null || value === 'none') return null;
  return colorPickHex(value, context.themeHexes, context.automaticHex);
}

/** Props for `ColorPicker.Trigger`. @public */
export interface ColorPickerTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** More class names for the element. */
  className?: string;
  asChild?: boolean;
}

/** The button that opens the grid; it shows a chip of the current colour, then its children. */
function ColorPickerTrigger({
  asChild,
  className,
  children,
  onClick,
  ...rest
}: ColorPickerTriggerProps): ReactElement {
  const context = usePicker('Trigger');
  const hex = valueHex(context);
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={(node: HTMLButtonElement | null) => {
        context.triggerRef.current = node;
      }}
      type="button"
      className={`docx-color-picker__trigger docx-shape-pane__color-button${className ? ` ${className}` : ''}`}
      aria-haspopup="true"
      aria-expanded={context.open}
      aria-controls={context.open ? context.contentId : undefined}
      disabled={context.disabled}
      data-color={hex ?? ''}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) context.setOpen(!context.open);
      }}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          <span
            className="docx-color-picker__chip docx-shape-pane__chip"
            data-none={!hex}
            style={hex ? { background: hex } : undefined}
            aria-hidden="true"
          />
          {children}
        </>
      )}
    </Comp>
  );
}

/** Props for `ColorPicker.Swatch`. @public */
export interface ColorPickerSwatchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value'
> {
  /** More class names for the element. */
  className?: string;
  pick: ColorPick;
  /** The paint, `#RRGGBB`; default the paint of `pick` in the document's theme. */
  hex?: string;
}

/** One swatch of the grid; it carries `aria-pressed` for the current pick. */
function ColorPickerSwatch({ pick, hex, className, ...rest }: ColorPickerSwatchProps) {
  const context = usePicker('Swatch');
  const name = context.label(pick);
  const current =
    context.value !== null && context.value !== 'none' && colorPickIsCurrent(pick, context.value);
  return (
    <button
      type="button"
      className={`docx-color-picker__swatch docx-chart-pane__swatch${className ? ` ${className}` : ''}`}
      data-color-swatch=""
      data-pick={pick}
      aria-label={name}
      title={name}
      aria-pressed={current}
      style={{ background: hex ?? colorPickHex(pick, context.themeHexes) }}
      onClick={() => context.pick(pick)}
      {...rest}
    />
  );
}

/** The first button of the grid: No colour, or Automatic. Renders nothing when there is none. */
function ColorPickerNoColor({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>): ReactElement | null {
  const context = usePicker('NoColor');
  const { t } = useTranslation();
  if (context.noColor === false) return null;
  const value = context.noColor;
  const pressed = value === 'auto' ? context.value === 'auto' : context.value === 'none';
  return (
    <button
      type="button"
      className={`docx-color-picker__none docx-chart-pane__grid-auto${className ? ` ${className}` : ''}`}
      data-color-none=""
      aria-pressed={pressed}
      onClick={() => context.pick(value === 'auto' ? 'auto' : 'none')}
      {...rest}
    >
      {children ?? t(value === 'auto' ? 'colorPicker.automatic' : 'colorPicker.noColor')}
    </button>
  );
}

/** A hex field: `#RRGGBB` applies on Enter; other text stays with its reason. */
function ColorPickerHexInput({ className }: { className?: string }): ReactElement {
  const context = usePicker('HexInput');
  const { t } = useTranslation();
  const errorId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const commit = (): void => {
    const pick = colorPickFromHexText(draft);
    if (!pick) return setError(true);
    setError(false);
    setDraft('');
    context.pick(pick);
  };
  return (
    <label className={`docx-color-picker__hex${className ? ` ${className}` : ''}`}>
      <span className="docx-chart-pane__grid-title">{t('colorPicker.hexColor')}</span>
      <input
        className="docx-dialog__input"
        value={draft}
        maxLength={7}
        spellCheck={false}
        placeholder="#RRGGBB"
        aria-invalid={error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          commit();
        }}
      />
      {error ? (
        <span id={errorId} className="docx-chart-pane__error">
          {t('colorPicker.invalidHex')}
        </span>
      ) : null}
    </label>
  );
}

/** The default grid: theme colours with tints and shades, then the standard colours. */
function ColorPickerGrid(): ReactElement {
  const context = usePicker('Grid');
  const { t } = useTranslation();
  const grid = colorPickerGrid(context.themeHexes);
  return (
    <>
      <span className="docx-chart-pane__grid-title">{t('colorPicker.themeColors')}</span>
      <div className="docx-chart-pane__swatches">
        {grid.theme.flat().map((s) => (
          <ColorPickerSwatch key={s.pick} pick={s.pick} hex={s.hex} />
        ))}
      </div>
      <span className="docx-chart-pane__grid-title">{t('colorPicker.standardColors')}</span>
      <div className="docx-chart-pane__swatches">
        {grid.standard.map((s) => (
          <ColorPickerSwatch key={s.pick} pick={s.pick} hex={s.hex} />
        ))}
      </div>
    </>
  );
}

/** Props for `ColorPicker.Content`. @public */
export interface ColorPickerContentProps extends HTMLAttributes<HTMLDivElement> {
  /** Whether the default content shows the hex field. Default true. */
  hexInput?: boolean;
  /**
   * Renders the grid in place, inside a popup the host already owns (a toolbar panel), instead
   * of as a popover under the trigger.
   */
  inline?: boolean;
  /** More class names for the element. */
  className?: string;
}

/**
 * The grid popover. It renders only while the picker is open. Children replace the default
 * content: `NoColor`, the grid, and `HexInput`.
 */
function ColorPickerContent({
  hexInput = true,
  inline = false,
  className,
  children,
  onKeyDown,
  ...rest
}: ColorPickerContentProps): ReactElement | null {
  const context = usePicker('Content');
  const panel = useRef<HTMLDivElement>(null);
  const { open, setOpen, triggerRef } = context;
  useEffect(() => {
    if (!open) return undefined;
    const doc = hostDocumentOf(panel.current);
    const away = (event: PointerEvent): void => {
      const target = event.target;
      if (!isDomNode(target)) return;
      if (!panel.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    doc.addEventListener('pointerdown', away, true);
    focusColorSwatch(panel.current);
    return () => doc.removeEventListener('pointerdown', away, true);
  }, [open, setOpen, triggerRef]);
  if (!open) return null;
  return (
    <div
      ref={panel}
      id={context.contentId}
      role="group"
      className={`docx-color-picker__content${inline ? ' docx-color-picker__content--inline' : ' docx-chart-pane__grid'}${className ? ` ${className}` : ''}`}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (moveColorSwatchFocus(panel.current, event.key)) {
          event.preventDefault();
          return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
      {...rest}
    >
      {children ?? (
        <>
          <ColorPickerNoColor />
          <ColorPickerGrid />
          {hexInput ? <ColorPickerHexInput /> : null}
        </>
      )}
    </div>
  );
}

/**
 * The colour picker compound: `Root`, `Trigger`, `Content`, and the parts of the grid. Every
 * colour control of the editor is built from it. @public
 */
export const ColorPicker = {
  Root: ColorPickerRoot,
  Trigger: ColorPickerTrigger,
  Content: ColorPickerContent,
  Grid: ColorPickerGrid,
  Swatch: ColorPickerSwatch,
  NoColor: ColorPickerNoColor,
  HexInput: ColorPickerHexInput,
};

/** Props for `ColorPickerPanel`. @internal */
export interface ColorPickerPanelProps {
  /** The current colour, `RRGGBB`, or null. */
  readonly current: string | null;
  /** Called with the picked colour as `RRGGBB`: a theme pick resolves to the colour it paints. */
  readonly apply: (hex: string) => void;
  /** Called by Escape, to close the popup that holds the panel. */
  readonly onClose: () => void;
}

/**
 * The shared grid inside a popup the host owns, for a target that keeps only `RRGGBB` (a table
 * border or shading): theme colours with tints and shades, standard colours, and a hex field.
 * @internal
 */
export function ColorPickerPanel({ current, apply, onClose }: ColorPickerPanelProps): ReactElement {
  const editor = useDocxEditor();
  const hexes = documentThemeHexes(editor?.getDocumentThemeColors());
  const value =
    current && /^[0-9A-Fa-f]{6}$/.test(current) ? (`#${current.toUpperCase()}` as ColorPick) : null;
  return (
    <ColorPickerRoot
      value={value}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      noColor={false}
      themeHexes={hexes}
      onPick={(pick) => {
        if (pick !== 'none') apply(colorPickHex(pick, hexes).slice(1));
      }}
    >
      <ColorPickerContent inline />
    </ColorPickerRoot>
  );
}
