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
  drawingPaintStringsCacheToken,
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
  translate(key: string): string;
  mode(): HostEditingMode | undefined;
  modeForGate(): HostEditingMode;
  openingModeDecision(guards: OpeningModeGuards): OpeningModeDecision;
  setMode(mode: HostEditingMode | undefined): boolean;
  drawingStrings(): DrawingPaintStrings;
  setTranslate(translate: EditorTranslate | undefined): DrawingPaintStrings | null;
  dateInputOrder(): 'mdy' | 'dmy';
  setDateInputOrder(order: 'mdy' | 'dmy' | undefined): void;
  tocLabels(): TocLabels;
  setLocale(locale: string | undefined): TocLabels | null;
}

/** Create mutable host state while module registration stays construction-only. */
export function createDocxEditorHostConfigState(initial: {
  readonly mode?: HostEditingMode;
  readonly translate?: EditorTranslate;
  readonly locale?: string;
  readonly dateInputOrder?: 'mdy' | 'dmy';
}): DocxEditorHostConfigState {
  let mode = initial.mode;
  let translate = initial.translate;
  let drawingStrings = translate
    ? drawingPaintStringsFromTranslate(translate)
    : DEFAULT_DRAWING_PAINT_STRINGS;
  let locale = localeState(initial.locale);
  let dateInputOrder: 'mdy' | 'dmy' = initial.dateInputOrder === 'dmy' ? 'dmy' : 'mdy';

  return {
    translate: (key) =>
      translate?.(key) ??
      createT(
        deepMerge(en, locales[locale.code]) as LocaleStrings,
        locale.code
      )(key as Parameters<ReturnType<typeof createT>>[0]),
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
      const nextDrawingStrings = next
        ? drawingPaintStringsFromTranslate(next)
        : DEFAULT_DRAWING_PAINT_STRINGS;
      if (
        drawingPaintStringsCacheToken(drawingStrings) ===
        drawingPaintStringsCacheToken(nextDrawingStrings)
      ) {
        drawingStrings = nextDrawingStrings;
        return null;
      }
      drawingStrings = nextDrawingStrings;
      return drawingStrings;
    },
    dateInputOrder: () => dateInputOrder,
    setDateInputOrder: (order) => {
      dateInputOrder = order === 'dmy' ? 'dmy' : 'mdy';
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

/** Live host preferences update the mounted surface and survive subsequent loads. */
export function liveHostConfigSetters(
  state: DocxEditorHostConfigState,
  host: {
    surface(): {
      setDrawingStrings(strings: DrawingPaintStrings): void;
      setTocLabels(labels: TocLabels): void;
      setDateInputOrder(order: 'mdy' | 'dmy'): void;
    } | null;
    bump(): void;
    emitSelectionChange(): void;
  }
) {
  return {
    setTranslate(next: EditorTranslate | undefined) {
      const strings = state.setTranslate(next);
      if (strings === null) return;
      host.surface()?.setDrawingStrings(strings);
      host.bump();
      host.emitSelectionChange();
    },
    setLocale(next: string | undefined) {
      const labels = state.setLocale(next);
      if (labels === null) return;
      host.surface()?.setTocLabels(labels);
      host.bump();
      host.emitSelectionChange();
    },
    setDateInputOrder(order: 'mdy' | 'dmy' | undefined) {
      state.setDateInputOrder(order);
      host.surface()?.setDateInputOrder(state.dateInputOrder());
    },
  };
}
