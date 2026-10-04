import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  APPLICATION_RUN_PROPERTIES,
  omittedDocDefaults,
} from '../store/package/application-doc-defaults.ts';

const APPLICATION_MODERN_RUN: readonly OoxmlProperty[] = Object.freeze([
  ...APPLICATION_RUN_PROPERTIES,
  Object.freeze({
    localName: 'ligatures',
    attributes: Object.freeze({ val: 'standardContextual' }),
  }),
]);

/**
 * An omitted rPrDefault uses the application profile; an authored empty one suppresses that
 * fallback (`application-doc-defaults.ts`). Keep this layout-only so source styles round-trip
 * unchanged, and later style/direct properties can disable or raise the threshold.
 */
export function applicationRunDefaults(
  styles: OoxmlElement | null,
  optionalLigatures = false
): readonly OoxmlProperty[] {
  if (!omittedDocDefaults(styles).run) return [];
  return optionalLigatures ? APPLICATION_MODERN_RUN : APPLICATION_RUN_PROPERTIES;
}
