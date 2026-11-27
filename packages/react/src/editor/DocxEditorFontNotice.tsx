import { useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
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
  /** Appended after the default notice classes. */
  className?: string;
  /** Inline presentation overrides for the notice element. */
  style?: CSSProperties;
  /** Translator override; defaults to the ambient locale context. */
  t?: TFunction;
  /**
   * Your own notice, in place of the packaged bar. It renders only while there are
   * substituted families that the reader has not dismissed. It replaces the whole
   * element, so `className` and `style` do not apply. The function can call hooks.
   *
   * ```tsx
   * <DocxEditor.FontNotice>
   *   {({ fonts, dismiss }) => <MyBanner fonts={fonts} onClose={dismiss} />}
   * </DocxEditor.FontNotice>
   * ```
   */
  children?: (context: DocxEditorFontNoticeContext) => DocxEditorChildren;
}

const RENDER_WARNINGS = {
  both: '[docx-editor] renderFontNotice replaces fontNotice.children. Pass only one.',
  disabled:
    '[docx-editor] renderFontNotice is ignored with fontNotice={false}, which renders no ' +
    'font notice.',
  noChrome:
    '[docx-editor] renderFontNotice is ignored with chrome={false}, which renders no font ' +
    'notice. Compose <DocxEditor.FontNotice> yourself instead.',
} as const;

const warnedRender = new Set<keyof typeof RENDER_WARNINGS>();

/**
 * Warn once, in development, when `renderFontNotice` cannot do what it says: it replaces
 * `fontNotice.children`, and neither `fontNotice={false}` nor `chrome={false}` renders a
 * notice for it.
 */
export function warnFontNoticeRender(
  fontNotice: boolean | DocxEditorFontNoticeProps,
  hasRenderProp: boolean,
  chrome: boolean
): void {
  if (!hasRenderProp || !isDevelopment()) return;
  const kind = !chrome
    ? 'noChrome'
    : fontNotice === false
      ? 'disabled'
      : typeof fontNotice === 'object' && fontNotice.children
        ? 'both'
        : null;
  if (kind === null || warnedRender.has(kind)) return;
  warnedRender.add(kind);
  console.warn(RENDER_WARNINGS[kind]);
}

/**
 * Runs the host's function as a component of its own. It mounts only while the notice
 * shows, so the function can call hooks: called inline, its hooks would follow two early
 * returns and change the hook count when the families arrive.
 */
function CustomFontNotice({
  render,
  context,
}: {
  render: (context: DocxEditorFontNoticeContext) => DocxEditorChildren;
  context: DocxEditorFontNoticeContext;
}) {
  return <>{render(context)}</>;
}

/**
 * Font compatibility notice.
 *
 * Shown when the open document declares font families this platform cannot resolve —
 * not installed, not embedded in the file, not supplied by the app's font
 * configuration — so the text is rendering in a substitute face. Dismissing hides the
 * notice for that set of families; a different document (or a font arriving) changes
 * the set and surfaces it again.
 *
 * Pass a function as `children` to render your own notice from the same state.
 *
 * @public
 */
export function DocxEditorFontNotice({
  className,
  style,
  t: tProp,
  children,
}: DocxEditorFontNoticeProps) {
  const substitutions = useEditorState(selectFontSubstitutions);
  const { t: ambient } = useTranslation();
  const t = tProp ?? ambient;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const key = substitutions.join('\0');
  const dismiss = useCallback(() => setDismissedKey(key), [key]);

  if (substitutions.length === 0) return null;
  if (dismissedKey === key) return null;

  const fonts = substitutions.join(', ');
  // Interpolated locally as well: hosts commonly bridge a bare `(key) => string` into
  // `t`, and the notice must not surface a literal placeholder then. A function, so a
  // `$` in a family name is not read as a replacement pattern.
  const message = t('editor.fontSubstitutionNotice', { fonts }).replace('{fonts}', () => fonts);
  // A JavaScript host can pass elements here; only a function replaces the bar.
  if (typeof children === 'function') {
    return (
      <CustomFontNotice render={children} context={{ fonts: substitutions, message, dismiss }} />
    );
  }

  return (
    <div
      className={className ? `docx-font-notice ${className}` : 'docx-font-notice'}
      role="status"
      {...(style ? { style } : {})}
    >
      <span className="docx-font-notice__text">{message}</span>
      <button
        type="button"
        className="docx-font-notice__dismiss"
        // A press on chrome must not take the caret from the page.
        onMouseDown={(event) => event.preventDefault()}
        onClick={dismiss}
      >
        {t('common.dismiss')}
      </button>
    </div>
  );
}
