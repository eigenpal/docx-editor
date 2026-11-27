import {
  defineComponent,
  h,
  mergeProps,
  ref,
  type CSSProperties,
  type PropType,
  type SlotsType,
  type VNode,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { TFunction } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { isDevelopment } from '../lib/is-development';
import { useEditorState } from './useEditorState';

const NONE: readonly string[] = [];
const selectFontSubstitutions = (snapshot: EditorSnapshot): readonly string[] =>
  snapshot.fontSubstitutions ?? NONE;

/**
 * What a custom font notice receives. `fonts` and `message` hold family names from the
 * document, so render them as text, never as HTML.
 *
 * @public
 */
export interface DocxEditorFontNoticeContext {
  /** The families that render in a substitute face. Never empty. */
  readonly fonts: readonly string[];
  /** The packaged message, already translated, with the families in it. */
  readonly message: string;
  /** Hides the notice for this set of families. A different set shows it again. */
  readonly dismiss: () => void;
}

/** Props for `DocxEditor.FontNotice`. @public */
export interface DocxEditorFontNoticeProps {
  className?: string;
  style?: CSSProperties;
  t?: TFunction;
  /**
   * Your own notice, in place of the packaged bar. The default slot does the same and
   * wins over this prop. It renders only while there are substituted families that the
   * reader has not dismissed.
   */
  children?: (context: DocxEditorFontNoticeContext) => DocxEditorChildren;
}

const SLOT_WARNINGS = {
  both: '[docx-editor] The #fontNotice slot replaces fontNotice.children. Pass only one.',
  disabled:
    '[docx-editor] The #fontNotice slot is ignored with :font-notice="false", which renders ' +
    'no font notice.',
  noChrome:
    '[docx-editor] The #fontNotice slot is ignored with :chrome="false", which renders no ' +
    'font notice. Compose <DocxEditorFontNotice> yourself instead.',
} as const;

const warnedSlot = new Set<keyof typeof SLOT_WARNINGS>();

/**
 * Warn once, in development, when the `fontNotice` slot cannot do what it says: it
 * replaces `fontNotice.children`, and neither `:font-notice="false"` nor `:chrome="false"`
 * renders a notice for it.
 */
export function warnFontNoticeSlot(
  fontNotice: boolean | DocxEditorFontNoticeProps,
  hasSlot: boolean,
  chrome: boolean
): void {
  if (!hasSlot || !isDevelopment()) return;
  const kind = !chrome
    ? 'noChrome'
    : fontNotice === false
      ? 'disabled'
      : typeof fontNotice === 'object' && fontNotice.children
        ? 'both'
        : null;
  if (kind === null || warnedSlot.has(kind)) return;
  warnedSlot.add(kind);
  console.warn(SLOT_WARNINGS[kind]);
}

/**
 * The bar that names the font families the document renders in substitute faces. The
 * reader can dismiss it; a different set of families shows it again. Fill the default slot
 * to render your own notice from the same state.
 *
 * @public
 */
export const DocxEditorFontNotice = defineComponent({
  name: 'DocxEditorFontNotice',
  // Attributes go on the packaged bar by hand: a custom notice can render several root
  // nodes, where Vue has no element to put them on and warns.
  inheritAttrs: false,
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
    t: { type: Function as PropType<TFunction>, default: undefined },
    children: {
      type: Function as PropType<DocxEditorFontNoticeProps['children']>,
      default: undefined,
    },
  },
  slots: Object as SlotsType<{
    /** Your own notice, in place of the packaged bar. */
    default?: (context: DocxEditorFontNoticeContext) => VNode[];
  }>,
  setup(props, { attrs, slots }) {
    const substitutions = useEditorState(selectFontSubstitutions);
    const { t: ambient } = useTranslation();
    const dismissedKey = ref<string | null>(null);

    return () => {
      const subs = substitutions.value;
      if (subs.length === 0) return null;
      const key = subs.join('\0');
      if (dismissedKey.value === key) return null;
      const t = props.t ?? ambient;
      const fonts = subs.join(', ');
      // Interpolated locally as well: hosts commonly bridge a bare `(key) => string` into
      // `t`, and the notice must not surface a literal placeholder then. A function, so a
      // `$` in a family name is not read as a replacement pattern.
      const message = t('editor.fontSubstitutionNotice', { fonts }).replace('{fonts}', () => fonts);
      const dismiss = () => {
        dismissedKey.value = key;
      };
      // A JavaScript host can pass another value here; only a function replaces the bar.
      const custom =
        slots.default ?? (typeof props.children === 'function' ? props.children : undefined);
      if (custom) return custom({ fonts: subs, message, dismiss });
      return h(
        'div',
        mergeProps(attrs, {
          class: props.className ? `docx-font-notice ${props.className}` : 'docx-font-notice',
          role: 'status',
          ...(props.style ? { style: props.style } : {}),
        }),
        [
          h('span', { class: 'docx-font-notice__text' }, message),
          h(
            'button',
            {
              type: 'button',
              class: 'docx-font-notice__dismiss',
              // A press on chrome must not take the caret from the page.
              onMousedown: (event: MouseEvent) => event.preventDefault(),
              onClick: dismiss,
            },
            t('common.dismiss')
          ),
        ]
      );
    };
  },
});
