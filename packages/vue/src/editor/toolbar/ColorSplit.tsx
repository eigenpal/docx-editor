import { computed, defineComponent, ref, watch, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps } from './parts';

/** @public */
export interface ToolbarColorSplitProps extends ToolbarSlotPartProps {
  className?: string;
  icon?: DocxEditorChildren;
}

/** @public */
export interface ToolbarColorSplitComponent {
  (props: ToolbarColorSplitProps): VNode | null;
  readonly docxSlot: ChromeSlotId;
}

interface SwatchDef {
  readonly value: string;
  readonly labelKey: string;
  readonly css: string;
}

const STANDARD_COLOR_SWATCHES: readonly SwatchDef[] = [
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
];

const HIGHLIGHT_SWATCHES: readonly SwatchDef[] = [
  { value: 'yellow', labelKey: 'colorPicker.colors.yellow', css: '#ffff00' },
  { value: 'green', labelKey: 'colorPicker.colors.brightGreen', css: '#00ff00' },
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

const DEFAULT_THEME_HEXES: readonly string[] = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
];

const THEME_COLUMN_KEYS: readonly string[] = [
  'colorPicker.theme.background1',
  'colorPicker.theme.text1',
  'colorPicker.theme.background2',
  'colorPicker.theme.text2',
  'colorPicker.theme.accent1',
  'colorPicker.theme.accent2',
  'colorPicker.theme.accent3',
  'colorPicker.theme.accent4',
  'colorPicker.theme.accent5',
  'colorPicker.theme.accent6',
];

interface ThemeVariant {
  readonly labelKey: string;
  readonly apply: (c: number) => number;
}

const lighter = (percent: number): ThemeVariant => ({
  labelKey: `colorPicker.theme.lighter${percent}`,
  apply: (c) => c + (255 - c) * (percent / 100),
});
const darker = (percent: number): ThemeVariant => ({
  labelKey: `colorPicker.theme.darker${percent}`,
  apply: (c) => c * (1 - percent / 100),
});

function themeVariantsFor(baseHex: string): readonly ThemeVariant[] {
  const channels = [0, 2, 4].map((at) => parseInt(baseHex.slice(at, at + 2), 16));
  const lightness = (Math.max(...channels) + Math.min(...channels)) / 2 / 255;
  if (lightness === 1) return [darker(5), darker(15), darker(25), darker(35), darker(50)];
  if (lightness === 0) return [lighter(50), lighter(35), lighter(25), lighter(15), lighter(5)];
  if (lightness >= 0.8) return [darker(10), darker(25), darker(50), darker(75), darker(90)];
  return [lighter(80), lighter(60), lighter(40), darker(25), darker(50)];
}

const HEX_VALUE = /^[0-9A-Fa-f]{6}$/;

function variantHex(baseHex: string, apply: (channel: number) => number): string {
  let out = '';
  for (let i = 0; i < 6; i += 2) {
    const channel = Math.round(apply(parseInt(baseHex.slice(i, i + 2), 16)));
    out += Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

function isLightHex(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 230;
}

interface ColorSplitConfig {
  readonly slot: ChromeSlotId;
  readonly defaultValue: string;
  readonly cssOf: (value: string) => string;
  readonly clear: { readonly value: string; readonly labelKey: string };
  readonly body: (props: PopupBodyProps) => DocxEditorChildren | VNode[];
}

interface PopupBodyProps {
  readonly apply: (value: string) => void;
  readonly label: (key: string) => string;
  readonly current: string | null;
  readonly themeHexes: readonly string[];
}

const Swatch = defineComponent({
  name: 'ColorSwatch',
  props: {
    value: { type: String, required: true },
    css: { type: String, required: true },
    title: { type: String, required: true },
    selected: { type: Boolean, required: true },
    apply: { type: Function as PropType<(value: string) => void>, required: true },
  },
  setup(props) {
    return () => (
      <button
        type="button"
        class="docx-toolbar__swatch"
        style={{ backgroundColor: props.css }}
        aria-label={props.title}
        title={props.title}
        data-value={props.value}
        {...(props.selected ? { 'data-selected': '' } : {})}
        {...(isLightHex(props.css.replace('#', '')) ? { 'data-light': '' } : {})}
        onMousedown={guardToolbarMousedown}
        onClick={() => props.apply(props.value)}
      />
    );
  },
});

const ThemeMatrix = defineComponent({
  name: 'ThemeMatrix',
  props: {
    apply: { type: Function as PropType<(value: string) => void>, required: true },
    label: { type: Function as PropType<(key: string) => string>, required: true },
    current: { type: String as PropType<string | null>, default: null },
    themeHexes: { type: Array as PropType<readonly string[]>, required: true },
  },
  setup(props) {
    return () => {
      const ladders = props.themeHexes.map(themeVariantsFor);
      const rows = [0, 1, 2, 3, 4];
      return (
        <div class="docx-toolbar__swatch-section">
          <div class="docx-toolbar__swatch-heading">{props.label('colorPicker.themeColors')}</div>
          <div class="docx-toolbar__swatch-grid docx-toolbar__swatch-grid--theme" role="group">
            {props.themeHexes.map((hex, column) => (
              <Swatch
                key={`base-${column}`}
                value={hex}
                css={`#${hex.toLowerCase()}`}
                title={props.label(THEME_COLUMN_KEYS[column]!)}
                selected={props.current === hex}
                apply={props.apply}
              />
            ))}
            {rows.flatMap((row) =>
              props.themeHexes.map((base, column) => {
                const variant = ladders[column]![row]!;
                const hex = variantHex(base, variant.apply);
                return (
                  <Swatch
                    key={`${row}-${column}`}
                    value={hex}
                    css={`#${hex.toLowerCase()}`}
                    title={`${props.label(THEME_COLUMN_KEYS[column]!)}, ${props.label(variant.labelKey)}`}
                    selected={props.current === hex}
                    apply={props.apply}
                  />
                );
              })
            )}
          </div>
        </div>
      );
    };
  },
});

const FontColorBody = defineComponent({
  name: 'FontColorBody',
  props: {
    apply: { type: Function as PropType<(value: string) => void>, required: true },
    label: { type: Function as PropType<(key: string) => string>, required: true },
    current: { type: String as PropType<string | null>, default: null },
    themeHexes: { type: Array as PropType<readonly string[]>, required: true },
  },
  setup(props) {
    const draft = ref('');
    return () => {
      const valid = HEX_VALUE.test(draft.value);
      return (
        <>
          <ThemeMatrix {...props} />
          <div class="docx-toolbar__swatch-section">
            <div class="docx-toolbar__swatch-heading">
              {props.label('colorPicker.standardColors')}
            </div>
            <div class="docx-toolbar__swatch-grid" role="group">
              {STANDARD_COLOR_SWATCHES.map((swatch) => (
                <Swatch
                  key={swatch.value}
                  value={swatch.value}
                  css={swatch.css}
                  title={props.label(swatch.labelKey)}
                  selected={props.current === swatch.value}
                  apply={props.apply}
                />
              ))}
            </div>
          </div>
          <div class="docx-toolbar__swatch-section">
            <div class="docx-toolbar__swatch-heading">{props.label('colorPicker.customColor')}</div>
            <div class="docx-toolbar__swatch-custom">
              <span class="docx-toolbar__swatch-hash" aria-hidden="true">
                #
              </span>
              <input
                type="text"
                class="docx-toolbar__swatch-hex"
                value={draft.value}
                maxlength={6}
                spellcheck={false}
                aria-label={props.label('colorPicker.customColor')}
                onInput={(event: Event) => {
                  draft.value = (event.target as HTMLInputElement).value
                    .replace(/[^0-9A-Fa-f]/g, '')
                    .slice(0, 6);
                }}
                onKeydown={(event: KeyboardEvent) => {
                  if (event.key === 'Enter' && valid) props.apply(draft.value.toUpperCase());
                }}
              />
              <button
                type="button"
                class="docx-toolbar__swatch-apply"
                disabled={!valid}
                onMousedown={guardToolbarMousedown}
                onClick={() => props.apply(draft.value.toUpperCase())}
              >
                {props.label('colorPicker.apply')}
              </button>
            </div>
          </div>
        </>
      );
    };
  },
});

/** @internal */
export interface ToolbarHexColorPickerBodyProps {
  readonly apply: (value: string) => void;
  readonly current: string | null;
}

/** @internal */
export const ToolbarHexColorPickerBody = defineComponent({
  name: 'ToolbarHexColorPickerBody',
  props: {
    apply: { type: Function as PropType<(value: string) => void>, required: true },
    current: { type: String as PropType<string | null>, default: null },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const label = useToolbarLabel();
    return () => {
      const themeEntries = editorRef.value?.getDocumentThemeColors() ?? [];
      const themeHexes =
        themeEntries.length === THEME_COLUMN_KEYS.length
          ? themeEntries.map((entry) => entry.hex)
          : DEFAULT_THEME_HEXES;
      const normalizedCurrent = props.current?.toUpperCase() ?? null;
      return (
        <FontColorBody
          apply={props.apply}
          label={label}
          current={normalizedCurrent}
          themeHexes={themeHexes}
        />
      );
    };
  },
});

const HIGHLIGHT_GRID = HIGHLIGHT_SWATCHES.filter((swatch) => swatch.value !== 'white');

const HighlightBody = defineComponent({
  name: 'HighlightBody',
  props: {
    apply: { type: Function as PropType<(value: string) => void>, required: true },
    label: { type: Function as PropType<(key: string) => string>, required: true },
    current: { type: String as PropType<string | null>, default: null },
  },
  setup(props) {
    return () => (
      <div class="docx-toolbar__swatch-section">
        <div class="docx-toolbar__swatch-heading">{props.label('colorPicker.highlightColors')}</div>
        <div class="docx-toolbar__swatch-grid docx-toolbar__swatch-grid--highlight" role="group">
          {HIGHLIGHT_GRID.map((swatch) => (
            <Swatch
              key={swatch.value}
              value={swatch.value}
              css={swatch.css}
              title={props.label(swatch.labelKey)}
              selected={props.current === swatch.value}
              apply={props.apply}
            />
          ))}
        </div>
      </div>
    );
  },
});

function createColorSplit(config: ColorSplitConfig): ToolbarColorSplitComponent {
  const { slot, defaultValue, cssOf, clear, body } = config;
  const isFontColor = slot === 'text.color';

  const Part = defineComponent({
    name: `ToolbarColorSplit_${slot.replace(/\./g, '_')}`,
    props: {
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
      icon: { type: Object as PropType<VNode>, default: undefined },
    },
    setup(props) {
      const editorRef = useDocxEditor();
      const command = useEditorCommand(slot);
      const label = useToolbarLabel();
      const open = ref(false);
      const lastValue = ref(defaultValue);
      const rootRef = ref<HTMLDivElement | null>(null);

      const current = useEditorState((snapshot: EditorSnapshot) => {
        if (isFontColor) {
          const color = snapshot.formatting?.color;
          return color && color.kind === 'hex' ? color.value.toUpperCase() : null;
        }
        return snapshot.formatting?.highlight ?? null;
      });

      const themeHexes = computed(() => {
        const themeEntries = editorRef.value?.getDocumentThemeColors() ?? [];
        return themeEntries.length === THEME_COLUMN_KEYS.length
          ? themeEntries.map((entry) => entry.hex)
          : DEFAULT_THEME_HEXES;
      });

      watch(open, (isOpen, _, onCleanup) => {
        if (!isOpen) return;
        const onMouseDown = (event: MouseEvent) => {
          const root = rootRef.value;
          if (root && event.target instanceof Node && root.contains(event.target)) return;
          open.value = false;
        };
        document.addEventListener('mousedown', onMouseDown);
        onCleanup(() => document.removeEventListener('mousedown', onMouseDown));
      });

      const apply = (value: string) => {
        open.value = false;
        const editor = editorRef.value;
        if (!editor) return;
        const cmd = commandForSlotValue(slot, value);
        if (!cmd) return;
        if (editor.can(cmd).ok) {
          editor.exec(cmd);
          if (value !== clear.value) lastValue.value = value;
        }
      };

      return () => {
        if (props.hidden) return null;
        const control = chromeControlForSlot(slot);
        const text = label(control?.labelKey ?? slot);
        return (
          <div
            ref={rootRef}
            class={`docx-toolbar__colorsplit${props.className ? ` ${props.className}` : ''}`}
            data-slot={slot}
          >
            <button
              type="button"
              class="docx-toolbar__button docx-toolbar__colorsplit-main"
              disabled={!command.isEnabled.value}
              {...(!command.isEnabled.value ? { 'data-disabled': '' } : {})}
              aria-label={text}
              title={command.disabledReason.value ?? text}
              onMousedown={guardToolbarMousedown}
              onClick={() => apply(lastValue.value)}
            >
              {props.icon ?? chromeIcon(control?.paths)}
              <span
                class="docx-toolbar__colorsplit-bar"
                style={{ backgroundColor: cssOf(lastValue.value) }}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="docx-toolbar__colorsplit-caret"
              disabled={!command.isEnabled.value}
              {...(!command.isEnabled.value ? { 'data-disabled': '' } : {})}
              aria-haspopup="true"
              aria-expanded={open.value}
              aria-label={text}
              title={command.disabledReason.value ?? text}
              onMousedown={guardToolbarMousedown}
              onClick={() => {
                open.value = !open.value;
              }}
            >
              ▾
            </button>
            {open.value ? (
              <div
                class="docx-toolbar__swatch-popup"
                role="dialog"
                aria-label={text}
                onMousedown={guardToolbarMousedown}
              >
                <button
                  type="button"
                  class="docx-toolbar__swatch-clear"
                  onMousedown={guardToolbarMousedown}
                  onClick={() => apply(clear.value)}
                >
                  <span
                    class={`docx-toolbar__swatch-clear-chip${
                      clear.value === 'none' ? ' docx-toolbar__swatch-clear-chip--none' : ''
                    }`}
                    aria-hidden="true"
                  />
                  {label(clear.labelKey)}
                </button>
                {body({
                  apply,
                  label,
                  current: current.value,
                  themeHexes: themeHexes.value,
                })}
              </div>
            ) : null}
          </div>
        );
      };
    },
  });

  return Object.assign(Part, { docxSlot: slot }) as unknown as ToolbarColorSplitComponent;
}

const HIGHLIGHT_CSS = new Map(HIGHLIGHT_SWATCHES.map((swatch) => [swatch.value, swatch.css]));

/** @public */
export const ToolbarFontColor: ToolbarColorSplitComponent = createColorSplit({
  slot: 'text.color',
  defaultValue: 'FF0000',
  cssOf: (value) => (value === 'auto' ? '#000000' : `#${value}`),
  clear: { value: 'auto', labelKey: 'colorPicker.automatic' },
  body: (props) => <ToolbarHexColorPickerBody apply={props.apply} current={props.current} />,
});

/** @public */
export const ToolbarHighlight: ToolbarColorSplitComponent = createColorSplit({
  slot: 'text.highlight',
  defaultValue: 'yellow',
  cssOf: (value) => HIGHLIGHT_CSS.get(value) ?? '#ffff00',
  clear: { value: 'none', labelKey: 'colorPicker.noColor' },
  body: (props) => <HighlightBody {...props} />,
});
