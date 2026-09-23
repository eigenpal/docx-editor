// MS-DOCX §2.3.1: legacy default-paragraph size/alignment exceptions inside tables.
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Opt into the unmodified ISO style hierarchy; absent settings use legacy behavior. */
export function strictTableStyleHierarchy(root: OoxmlElement | null): boolean {
  let strict = false;
  for (const compat of root?.children ?? []) {
    if (compat.kind === 'textValue' || compat.namespaceUri !== W || compat.localName !== 'compat')
      continue;
    for (const setting of compat.children) {
      if (
        setting.kind === 'textValue' ||
        setting.namespaceUri !== W ||
        setting.localName !== 'compatSetting'
      )
        continue;
      const attr = (name: string) =>
        setting.attributes.find((a) => a.namespaceUri === W && a.localName === name)?.value;
      if (
        attr('name') === 'overrideTableStyleFontSizeAndJustification' &&
        attr('uri') === 'http://schemas.microsoft.com/office/word'
      )
        strict = ['1', 'true', 'on'].includes(attr('val') ?? '');
    }
  }
  return strict;
}

/** Only the default paragraph style is filtered, never derived styles or direct formatting. */
export function legacyTableDefaultProperties(
  properties: readonly OoxmlProperty[],
  inherited: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  const values = new Map<string, string | undefined>();
  for (const property of properties) values.set(property.localName, property.attributes?.val);
  const ignored = new Set<string>();
  for (const name of ['sz', 'szCs']) {
    const value = Number(values.get(name));
    if (
      (value === 22 || value === 24) &&
      inherited.some(
        (property) => property.localName === name && Number(property.attributes?.val) > 0
      )
    )
      ignored.add(name);
  }
  if (values.get('jc') === 'left') ignored.add('jc');
  return ignored.size
    ? properties.filter((property) => !ignored.has(property.localName))
    : properties;
}
