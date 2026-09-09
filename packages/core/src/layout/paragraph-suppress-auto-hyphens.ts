// Read-only `w:suppressAutoHyphens` (ECMA-376 §17.3.1.34).
//
// Last-wins `ST_OnOff` on a cascaded paragraph-property bag. Presence without `@w:val`
// is on. The property is not authorable — it is not in `ACCEPTED_PARAGRAPH_PROPERTIES`.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';

function isOn(raw: string): boolean {
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/** Last cascaded `w:suppressAutoHyphens`. Absent means the paragraph may hyphenate. */
export function paragraphSuppressAutoHyphens(props: readonly OoxmlProperty[]): boolean {
  let value = false;
  for (const property of props) {
    if (property.localName !== 'suppressAutoHyphens') continue;
    const raw = property.attributes?.val;
    value = raw === undefined || isOn(raw);
  }
  return value;
}
