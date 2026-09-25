import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';

function wordChild(parent: OoxmlElement, name: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === name) return child;
  }
  return undefined;
}

/** Read the direct wrapped-table compatibility flag from the settings part. */
export function wrappedTableSettings(settings: OoxmlElement | null): {
  readonly doNotBreakWrappedTables?: true;
} {
  if (settings?.namespaceUri !== WML_NAMESPACE_URI || settings.localName !== 'settings') return {};
  const compat = wordChild(settings, 'compat');
  const flag = compat && wordChild(compat, 'doNotBreakWrappedTables');
  if (!flag) return {};
  const value = flag.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  return value === undefined || value === '1' || value === 'true' || value === 'on'
    ? { doNotBreakWrappedTables: true }
    : {};
}
