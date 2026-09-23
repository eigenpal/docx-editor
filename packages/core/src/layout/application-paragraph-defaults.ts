import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

const APPLICATION_SPACING: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({
    localName: 'spacing',
    attributes: Object.freeze({ after: '160', line: '278', lineRule: 'auto' }),
  }),
]);

/**
 * An omitted pPrDefault is application-defined (17.7.5.4), unlike an explicitly
 * empty pPrDefault. Use the current application profile for documents that
 * declare docDefaults but omit their paragraph defaults. Authored properties in
 * any later cascade layer override these independently, including explicit zero.
 * This is layout material only; the source styles part remains untouched.
 */
export function applicationParagraphDefaults(styles: OoxmlElement): readonly OoxmlProperty[] {
  if (styles.namespaceUri !== WML_NAMESPACE_URI) return [];
  const defaults = styles.children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'docDefaults'
  );
  if (
    !defaults ||
    defaults.kind === 'textValue' ||
    defaults.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'pPrDefault'
    )
  )
    return [];
  return APPLICATION_SPACING;
}
