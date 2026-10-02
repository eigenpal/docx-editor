// Legacy default-paragraph size/alignment exceptions inside tables. The
// `strictTableStyleHierarchy` compatibility rule (`overrideTableStyleFontSizeAndJustification`)
// turns them off.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';

/**
 * Only the default paragraph style is filtered, never derived styles or direct formatting.
 *
 * `tableRun` is the table style's own run material for the cell, including its `basedOn`
 * chain and conditional formats. A default-style 11/12pt size yields only to a size stated
 * there; the document defaults are not a table style size, so a table style that states
 * none keeps the default paragraph style's size.
 */
export function legacyTableDefaultProperties(
  properties: readonly OoxmlProperty[],
  tableRun: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  const values = new Map<string, string | undefined>();
  for (const property of properties) values.set(property.localName, property.attributes?.val);
  const ignored = new Set<string>();
  for (const name of ['sz', 'szCs']) {
    const value = Number(values.get(name));
    if (
      (value === 22 || value === 24) &&
      tableRun.some(
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
