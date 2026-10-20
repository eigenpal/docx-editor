import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { TableAlignment } from './semantic-table.ts';

/** `w:tblPr/w:jc`, defaulting to left when absent or unrecognised. */
export function readTableAlignment(
  container: OoxmlElement | undefined
): TableAlignment | undefined {
  const jc = container?.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'jc'
  );
  if (!jc || jc.kind === 'textValue') return undefined;
  const value = jc.attributes.find((attribute) => attribute.localName === 'val')?.value;
  // `start`/`end` are the strict-conformant spellings of `left`/`right`.
  if (value === 'center') return 'center';
  if (value === 'right' || value === 'end') return 'right';
  if (value === 'left' || value === 'start') return 'left';
  return undefined;
}
