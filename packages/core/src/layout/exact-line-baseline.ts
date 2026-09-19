import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { compatibilityModeFromSettings } from './document-compatibility-mode.ts';

/** The legacy noExtraLineSpacing switch is ignored by modern compatibility modes. */
export function preserveExactLineBaseline(root: OoxmlElement | null): boolean {
  if (!root || root.namespaceUri !== WML_NAMESPACE_URI || root.localName !== 'settings')
    return false;
  const mode = compatibilityModeFromSettings(root);
  if (mode === 15) return false;
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
        // A missing mode keeps legacy behavior; an unknown/conflicting declaration does not.
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
