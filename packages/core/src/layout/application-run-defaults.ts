import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

// The profile's size is 12pt for both the ASCII/high-ANSI and complex-script lanes.
const APPLICATION_RUN: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({ localName: 'kern', attributes: Object.freeze({ val: '2' }) }),
  Object.freeze({ localName: 'sz', attributes: Object.freeze({ val: '24' }) }),
  Object.freeze({ localName: 'szCs', attributes: Object.freeze({ val: '24' }) }),
]);
const APPLICATION_MODERN_RUN: readonly OoxmlProperty[] = Object.freeze([
  ...APPLICATION_RUN,
  Object.freeze({
    localName: 'ligatures',
    attributes: Object.freeze({ val: 'standardContextual' }),
  }),
]);

/**
 * An omitted rPrDefault uses the application profile; an authored empty one
 * suppresses that fallback. A package with no styles part, and a styles part with no
 * `w:docDefaults`, omit it too. An authored rPrDefault without `w:sz` keeps the format's
 * 10pt. Keep this layout-only so source styles round-trip unchanged, and later
 * style/direct properties can disable or raise the threshold.
 */
export function applicationRunDefaults(
  styles: OoxmlElement | null,
  optionalLigatures = false
): readonly OoxmlProperty[] {
  const fallback = optionalLigatures ? APPLICATION_MODERN_RUN : APPLICATION_RUN;
  if (!styles) return fallback;
  if (styles.namespaceUri !== WML_NAMESPACE_URI) return [];
  const defaults = styles.children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'docDefaults'
  );
  if (
    defaults &&
    defaults.kind !== 'textValue' &&
    defaults.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'rPrDefault'
    )
  )
    return [];
  return fallback;
}
