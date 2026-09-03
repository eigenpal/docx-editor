/** Live host configuration for the editor facade. */

import {
  createT,
  deepMerge,
  en,
  locales,
  type LocaleCode,
  type LocaleStrings,
} from '@docx-editor.dev/i18n';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsFromTranslate,
  type DrawingPaintStrings,
} from '../output/semantic-paint-drawings.ts';
import {
  resolveOpeningEditingMode,
  type OpeningModeDecision,
  type OpeningModeGuards,
} from './opening-editing-mode.ts';

export type HostEditingMode = 'edit' | 'view' | 'suggesting';
export type EditorTranslate = (key: string, params?: Record<string, string | number>) => string;
export interface TocLabels {
  readonly title: string;
}

function localeState(locale: string | undefined): { code: LocaleCode; labels: TocLabels } {
  const code = locale && locale in locales ? (locale as LocaleCode) : ('en' as const);
  const t = createT(
    deepMerge(en, code === 'en' ? undefined : locales[code]) as LocaleStrings,
    code
  );
  return { code, labels: { title: t('toolbar.tableOfContents') } };
}

/** State that construction config and later instance setters share. */
export interface DocxEditorHostConfigState {
  mode(): HostEditingMode | undefined;
  modeForGate(): HostEditingMode;
  openingModeDecision(guards: OpeningModeGuards): OpeningModeDecision;
  setMode(mode: HostEditingMode | undefined): boolean;
  drawingStrings(): DrawingPaintStrings;
  setTranslate(translate: EditorTranslate | undefined): DrawingPaintStrings | null;
  tocLabels(): TocLabels;
  setLocale(locale: string | undefined): TocLabels | null;
}

/** Create mutable host state while module registration stays construction-only. */
export function createDocxEditorHostConfigState(initial: {
  readonly mode?: HostEditingMode;
  readonly translate?: EditorTranslate;
  readonly locale?: string;
}): DocxEditorHostConfigState {
  let mode = initial.mode;
  let translate = initial.translate;
  let drawingStrings = translate
    ? drawingPaintStringsFromTranslate(translate)
    : DEFAULT_DRAWING_PAINT_STRINGS;
  let locale = localeState(initial.locale);

  return {
    mode: () => mode,
    modeForGate: () => mode ?? 'edit',
    openingModeDecision: (guards) => resolveOpeningEditingMode(mode, guards),
    setMode(next) {
      if (mode === next) return false;
      mode = next;
      return true;
    },
    drawingStrings: () => drawingStrings,
    setTranslate(next) {
      if (translate === next) return null;
      translate = next;
      drawingStrings = next
        ? drawingPaintStringsFromTranslate(next)
        : DEFAULT_DRAWING_PAINT_STRINGS;
      return drawingStrings;
    },
    tocLabels: () => locale.labels,
    setLocale(next) {
      const resolved = localeState(next);
      if (locale.code === resolved.code) return null;
      locale = resolved;
      return locale.labels;
    },
  };
}
