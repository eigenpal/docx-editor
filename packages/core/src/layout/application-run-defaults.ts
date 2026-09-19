import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

const APPLICATION_KERNING: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({ localName: 'kern', attributes: Object.freeze({ val: '2' }) }),
]);

/**
 * An omitted rPrDefault uses the application profile; an authored empty one
 * suppresses that fallback. Keep this layout-only so source styles round-trip
 * unchanged, and later style/direct properties can disable or raise the threshold.
 */
export function applicationRunDefaults(styles: OoxmlElement | null): readonly OoxmlProperty[] {
  if (!styles) return APPLICATION_KERNING;
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
  return APPLICATION_KERNING;
}
