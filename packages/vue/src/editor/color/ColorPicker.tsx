// `ColorPicker`: the one colour control of the editor, as a compound a host can place anywhere,
// the Vue twin of `packages/react/src/editor/color/ColorPicker.tsx`. `Root` holds the value and
// the open state, `Trigger` opens the grid, `Content` is the grid (No colour, the theme colours
// with their tints and shades, the standard colours, and a hex field), and `Swatch`, `NoColor`,
// and `HexInput` are its parts. The grid focuses the current colour, the arrow keys move in it,
// Escape closes it, and the focus returns to the trigger. Both render the same markup.

import {
  Teleport,
  computed,
  defineComponent,
  inject,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
  type PropType,
  type Ref,
} from 'vue';
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
  isElementNode,
  moveColorSwatchFocus,
  type ColorPick,
} from '@docx-editor.dev/core/editor';
import { useTranslation, type TranslationKey } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useDocxEditor } from '../context';
import { Slot } from '../toolbar/Slot';
import { useChromeDark, useChromeScopeClassName } from '../color-mode-context';
import { ScopedByAncestorContext } from '../scope-context';

/** The value of a picker: a pick, `none` for No colour, or null when the target is mixed. @public */
export type ColorPickerValue = ColorPick | 'none' | null;

interface ColorPickerContextValue {
  readonly open: Readonly<Ref<boolean>>;
  readonly setOpen: (open: boolean) => void;
  readonly value: Readonly<Ref<ColorPickerValue>>;
  readonly pick: (next: ColorPick | 'none') => void;
  readonly themeHexes: Readonly<Ref<readonly string[]>>;
  readonly disabled: Readonly<Ref<boolean>>;
  readonly noColor: Readonly<Ref<'none' | 'auto' | false>>;
  readonly automaticHex: Readonly<Ref<string | undefined>>;
  readonly triggerRef: Ref<HTMLButtonElement | null>;
  readonly contentId: string;
  readonly label: (pick: ColorPick) => string;
}

const COLOR_PICKER_KEY: InjectionKey<ColorPickerContextValue> = Symbol('docx-color-picker');

function usePicker(part: string): ColorPickerContextValue {
  const context = inject(COLOR_PICKER_KEY, null);
  if (!context) throw new Error(`ColorPicker.${part} must be inside ColorPicker.Root`);
  return context;
}

/** Props for `ColorPicker.Root`. @public */
export interface ColorPickerRootProps {
  value: ColorPickerValue;
  onPick: (pick: ColorPick | 'none') => void;
  noColor?: 'none' | 'auto' | false;
  automaticHex?: string;
  themeHexes?: readonly string[];
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Renders the single child of the default slot as the root, with the picker's attributes. */
  asChild?: boolean;
}

/** Props for `ColorPicker.Trigger`. Other attributes (`aria-label`, `title`) pass through. @public */
export interface ColorPickerTriggerProps {
  className?: string;
  /** Renders the single child of the default slot as the trigger, without the colour chip. */
  asChild?: boolean;
}

/** Props for `ColorPicker.Swatch`. @public */
export interface ColorPickerSwatchProps {
  pick: ColorPick;
  /** The paint, `#RRGGBB`; default the paint of `pick` in the document's theme. */
  hex?: string;
  className?: string;
}

/** Props for `ColorPicker.Content`. Other attributes (`aria-label`) pass through. @public */
export interface ColorPickerContentProps {
  /** Whether the default content shows the hex field. Default true. */
  hexInput?: boolean;
  /** Renders the grid in place, inside a popup the host already owns. */
  inline?: boolean;
  /**
   * Renders the grid in this element (or selector), through `Teleport`, for a host popover
   * library that places it. The grid then takes no position of its own.
   */
  container?: Element | string | null;
  className?: string;
}

/** Props for `ColorPicker.NoColor`. The default slot replaces the button text. @public */
export interface ColorPickerNoColorProps {
  className?: string;
}

/** Props for `ColorPicker.HexInput`. @public */
export interface ColorPickerHexInputProps {
  /** More class names for the field. */
  className?: string;
}

const ColorPickerRoot = defineComponent({
  name: 'ColorPickerRoot',
  props: {
    /** The current pick, `none` for No colour, or null when the target shows several colours. */
    value: { type: String as PropType<ColorPickerValue>, default: null },
    /** Called with the picked colour, or `none` (or `auto`) for the first button of the grid. */
    onPick: { type: Function as PropType<(pick: ColorPick | 'none') => void>, required: true },
    /** `none` (No colour, the default), `auto` (Automatic), or false for no such button. */
    noColor: {
      type: [String, Boolean] as PropType<'none' | 'auto' | false>,
      default: 'none',
    },
    /** The colour that Automatic paints, `#RRGGBB`. */
    automaticHex: { type: String, default: undefined },
    /** The theme colours, `RRGGBB` in slot order; default the document's. */
    themeHexes: { type: Array as PropType<readonly string[]>, default: undefined },
    disabled: { type: Boolean, default: false },
    /** Open state, for a controlled picker. */
    open: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const { t } = useTranslation();
    const scope = useChromeScopeClassName();
    provide(ScopedByAncestorContext, true);
    const openState = ref(false);
    const open = computed(() => (props.open ?? openState.value) && !props.disabled);
    const triggerRef = shallowRef<HTMLButtonElement | null>(null);
    const contentId = useStableDocxId('color-picker');
    const setOpen = (next: boolean): void => {
      if (props.open === undefined) openState.value = next;
      props.onOpenChange?.(next);
    };
    provide(COLOR_PICKER_KEY, {
      open,
      setOpen,
      value: computed(() => props.value),
      pick: (next) => {
        setOpen(false);
        triggerRef.value?.focus();
        props.onPick(next);
      },
      themeHexes: (() => {
        // Stable across renders that change nothing, as React keeps it.
        const key = computed(() =>
          (props.themeHexes ?? documentThemeHexes(editorRef.value?.getDocumentThemeColors())).join(
            ','
          )
        );
        return computed(() => (key.value ? key.value.split(',') : []));
      })(),
      disabled: computed(() => props.disabled),
      noColor: computed(() => props.noColor),
      automaticHex: computed(() => props.automaticHex),
      triggerRef,
      contentId,
      label: (pick) => colorPickLabel(pick, (key, params) => t(key as TranslationKey, params)),
    });
    return () => {
      const rootProps = {
        class: `${scope()}docx-color-picker docx-chart-pane__color docx-shape-pane__color${props.className ? ` ${props.className}` : ''}`,
        'data-open': open.value || undefined,
      };
      if (props.asChild) return <Slot {...rootProps}>{{ default: () => slots.default?.() }}</Slot>;
      return <div {...rootProps}>{slots.default?.()}</div>;
    };
  },
});

/** The paint of the picker's value, `#RRGGBB`, or null for No colour or a mixed target. */
function valueHex(context: ColorPickerContextValue): string | null {
  const value = context.value.value;
  if (value === null || value === 'none') return null;
  return colorPickHex(value, context.themeHexes.value, context.automaticHex.value);
}

/**
 * The button that opens the grid; it shows a chip of the current colour, then its children. Its
 * template ref exposes `element`, the button, so a host popover library can anchor to it.
 */
const ColorPickerTrigger = defineComponent({
  name: 'ColorPickerTrigger',
  props: {
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: false },
  },
  setup(props, { slots, expose }) {
    const context = usePicker('Trigger');
    expose({ element: context.triggerRef });
    const setTrigger = (node: unknown): void => {
      context.triggerRef.value = isElementNode(node) ? (node as HTMLButtonElement) : null;
    };
    return () => {
      const hex = valueHex(context);
      const triggerProps = {
        ref: setTrigger,
        type: 'button' as const,
        class: `docx-color-picker__trigger docx-shape-pane__color-button${props.className ? ` ${props.className}` : ''}`,
        'aria-haspopup': 'true' as const,
        'aria-expanded': context.open.value,
        'aria-controls': context.open.value ? context.contentId : undefined,
        disabled: context.disabled.value,
        'data-color': hex ?? '',
        onClick: (event: MouseEvent) => {
          if (!event.defaultPrevented) context.setOpen(!context.open.value);
        },
      };
      if (props.asChild)
        return <Slot {...triggerProps}>{{ default: () => slots.default?.() }}</Slot>;
      return (
        <button {...triggerProps}>
          <span
            class="docx-color-picker__chip docx-shape-pane__chip"
            data-none={!hex}
            style={hex ? { background: hex } : undefined}
            aria-hidden="true"
          />
          {slots.default?.()}
        </button>
      );
    };
  },
});

/** One swatch of the grid; it carries `aria-pressed` for the current pick. */
const ColorPickerSwatch = defineComponent({
  name: 'ColorPickerSwatch',
  props: {
    pick: { type: String as PropType<ColorPick>, required: true },
    /** The paint, `#RRGGBB`; default the paint of `pick` in the document's theme. */
    hex: { type: String, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props) {
    const context = usePicker('Swatch');
    return () => {
      const name = context.label(props.pick);
      const value = context.value.value;
      const current = value !== null && value !== 'none' && colorPickIsCurrent(props.pick, value);
      return (
        <button
          type="button"
          class={`docx-color-picker__swatch docx-chart-pane__swatch${props.className ? ` ${props.className}` : ''}`}
          data-color-swatch=""
          data-pick={props.pick}
          aria-label={name}
          title={name}
          aria-pressed={current}
          style={{ background: props.hex ?? colorPickHex(props.pick, context.themeHexes.value) }}
          onClick={() => context.pick(props.pick)}
        />
      );
    };
  },
});

/** The first button of the grid: No colour, or Automatic. Renders nothing when there is none. */
const ColorPickerNoColor = defineComponent({
  name: 'ColorPickerNoColor',
  props: { className: { type: String, default: undefined } },
  setup(props, { slots }) {
    const context = usePicker('NoColor');
    const { t } = useTranslation();
    return () => {
      const kind = context.noColor.value;
      if (kind === false) return null;
      const pressed =
        kind === 'auto' ? context.value.value === 'auto' : context.value.value === 'none';
      return (
        <button
          type="button"
          class={`docx-color-picker__none docx-chart-pane__grid-auto${props.className ? ` ${props.className}` : ''}`}
          data-color-none=""
          aria-pressed={pressed}
          onClick={() => context.pick(kind === 'auto' ? 'auto' : 'none')}
        >
          {slots.default?.() ??
            t(kind === 'auto' ? 'colorPicker.automatic' : 'colorPicker.noColor')}
        </button>
      );
    };
  },
});

/** A hex field: `#RRGGBB` applies on Enter; other text stays with its reason. */
const ColorPickerHexInput = defineComponent({
  name: 'ColorPickerHexInput',
  props: { className: { type: String, default: undefined } },
  setup(props) {
    const context = usePicker('HexInput');
    const { t } = useTranslation();
    const errorId = useStableDocxId('color-picker-hex-error');
    const draft = ref('');
    const error = ref(false);
    const commit = (): void => {
      const pick = colorPickFromHexText(draft.value);
      if (!pick) {
        error.value = true;
        return;
      }
      error.value = false;
      draft.value = '';
      context.pick(pick);
    };
    return () => (
      <label class={`docx-color-picker__hex${props.className ? ` ${props.className}` : ''}`}>
        <span class="docx-chart-pane__grid-title">{t('colorPicker.hexColor')}</span>
        <input
          class="docx-dialog__input"
          value={draft.value}
          maxlength={7}
          spellcheck={false}
          placeholder="#RRGGBB"
          aria-invalid={error.value}
          aria-describedby={error.value ? errorId : undefined}
          onInput={(event: Event) => {
            draft.value = (event.target as HTMLInputElement).value;
            error.value = false;
          }}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            commit();
          }}
        />
        {error.value ? (
          <span id={errorId} class="docx-chart-pane__error">
            {t('colorPicker.invalidHex')}
          </span>
        ) : null}
      </label>
    );
  },
});

/** The default grid: theme colours with tints and shades, then the standard colours. */
const ColorPickerGrid = defineComponent({
  name: 'ColorPickerGrid',
  setup() {
    const context = usePicker('Grid');
    const { t } = useTranslation();
    return () => {
      const grid = colorPickerGrid(context.themeHexes.value);
      return [
        <span class="docx-chart-pane__grid-title">{t('colorPicker.themeColors')}</span>,
        <div class="docx-chart-pane__swatches">
          {grid.theme.flat().map((s) => (
            <ColorPickerSwatch key={s.pick} pick={s.pick} hex={s.hex} />
          ))}
        </div>,
        <span class="docx-chart-pane__grid-title">{t('colorPicker.standardColors')}</span>,
        <div class="docx-chart-pane__swatches">
          {grid.standard.map((s) => (
            <ColorPickerSwatch key={s.pick} pick={s.pick} hex={s.hex} />
          ))}
        </div>,
      ];
    };
  },
});

/**
 * The grid popover. It renders only while the picker is open, and moves the focus into the grid
 * when it opens. With `container`, it renders there through `Teleport` and leaves the position to
 * the host; its template ref exposes `element`, the grid, for a host popover library.
 */
const ColorPickerContent = defineComponent({
  name: 'ColorPickerContent',
  props: {
    /** Whether the default content shows the hex field. Default true. */
    hexInput: { type: Boolean, default: true },
    /** Renders the grid in place, inside a popup the host already owns. */
    inline: { type: Boolean, default: false },
    /** Renders the grid in this element (or selector), through `Teleport`. */
    container: {
      type: [Object, String] as PropType<Element | string | null>,
      default: undefined,
    },
    className: { type: String, default: undefined },
  },
  setup(props, { slots, expose }) {
    const context = usePicker('Content');
    const dark = useChromeDark();
    const panel = ref<HTMLDivElement | null>(null);
    expose({ element: panel });
    watch(
      context.open,
      (isOpen, _, onCleanup) => {
        if (!isOpen) return;
        const doc = hostDocumentOf(panel.value ?? context.triggerRef.value);
        const away = (event: PointerEvent): void => {
          const target = event.target;
          if (!isDomNode(target)) return;
          if (!panel.value?.contains(target) && !context.triggerRef.value?.contains(target))
            context.setOpen(false);
        };
        doc.addEventListener('pointerdown', away, true);
        onCleanup(() => doc.removeEventListener('pointerdown', away, true));
      },
      { flush: 'post', immediate: true }
    );
    // Only when the grid opens: a later render of the host keeps the focus where the user put it.
    watch(
      context.open,
      (isOpen) => {
        if (isOpen) focusColorSwatch(panel.value);
      },
      { flush: 'post', immediate: true }
    );
    return () => {
      if (!context.open.value) return null;
      const container = props.container ?? null;
      const placed = props.inline || !!container;
      // Through a portal the grid leaves the picker's scope, so it carries the scope itself.
      const scope = container ? (dark.value ? 'docx-editor dark ' : 'docx-editor ') : '';
      const grid = (
        <div
          ref={panel}
          id={context.contentId}
          role="group"
          class={`${scope}docx-color-picker__content${placed ? ' docx-color-picker__content--inline' : ' docx-chart-pane__grid'}${props.className ? ` ${props.className}` : ''}`}
          onKeydown={(event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (moveColorSwatchFocus(panel.value, event.key)) {
              event.preventDefault();
              return;
            }
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            context.setOpen(false);
            context.triggerRef.value?.focus();
          }}
        >
          {slots.default?.() ?? [
            <ColorPickerNoColor />,
            <ColorPickerGrid />,
            props.hexInput ? <ColorPickerHexInput /> : null,
          ]}
        </div>
      );
      return container ? <Teleport to={container}>{grid}</Teleport> : grid;
    };
  },
});

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

/** The parts of the `ColorPicker` compound. @public */
export type ColorPickerCompound = typeof ColorPicker;

/**
 * The shared grid inside a popup the host owns, for a target that keeps only `RRGGBB` (a table
 * border or shading). A theme pick resolves to the colour it paints. @internal
 */
export const ColorPickerPanel = defineComponent({
  name: 'ColorPickerPanel',
  props: {
    current: { type: String as PropType<string | null>, default: null },
    apply: { type: Function as PropType<(hex: string) => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    return () => {
      const hexes = documentThemeHexes(editorRef.value?.getDocumentThemeColors());
      const current = props.current;
      const value =
        current && /^[0-9A-Fa-f]{6}$/.test(current)
          ? (`#${current.toUpperCase()}` as ColorPick)
          : null;
      return (
        <ColorPickerRoot
          value={value}
          open
          onOpenChange={(open: boolean) => {
            if (!open) props.onClose();
          }}
          noColor={false}
          themeHexes={hexes}
          onPick={(pick: ColorPick | 'none') => {
            if (pick !== 'none') props.apply(colorPickHex(pick, hexes).slice(1));
          }}
        >
          {{ default: () => <ColorPickerContent inline /> }}
        </ColorPickerRoot>
      );
    };
  },
});
