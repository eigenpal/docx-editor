import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { compatibilityModeFromSettings } from './document-compatibility-mode.ts';

/** The legacy noExtraLineSpacing switch is ignored by modern compatibility modes. */
export function preserveExactLineBaseline(root: OoxmlElement | null): boolean {
  if (!root || root.namespaceUri !== WML_NAMESPACE_URI || root.localName !== 'settings')
    return false;
  const mode = compatibilityModeFromSettings(root);
  // Any mode Word calls modern ignores the switch; an ABSENT mode keeps legacy behaviour.
  // The parser reports the authored value now, so presence no longer has to be sniffed
  // separately from the element tree below.
  if (mode !== undefined && ![11, 12, 14].includes(mode)) return false;
  let enabled = false;
  for (const compat of root.children) {
    if (
      compat.kind === 'textValue' ||
      compat.namespaceUri !== WML_NAMESPACE_URI ||
      compat.localName !== 'compat'
    )
      continue;
    for (const property of compat.children) {
      if (
        property.kind !== 'textValue' &&
        property.namespaceUri === WML_NAMESPACE_URI &&
        property.localName === 'compatSetting' &&
        mode === undefined
      ) {
        const attribute = (name: string) =>
          property.attributes.find(
            (a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name
          )?.value;
        // `mode` is undefined here only for a declaration the parser refused: duplicated, so
        // ambiguous, or malformed. That is not the same as authoring none, and it does not
        // earn legacy behaviour.
        if (
          attribute('name') === 'compatibilityMode' &&
          attribute('uri') === 'http://schemas.microsoft.com/office/word'
        )
          return false;
      }
      if (
        property.kind === 'textValue' ||
        property.namespaceUri !== WML_NAMESPACE_URI ||
        property.localName !== 'noExtraLineSpacing'
      )
        continue;
      const value = property.attributes.find(
        (a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === 'val'
      )?.value;
      enabled = value === undefined || value === '1' || value === 'true' || value === 'on';
    }
  }
  return enabled;
}
