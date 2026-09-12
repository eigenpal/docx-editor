import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphIsRtl } from './rtl-paragraph.ts';

/** Horizontal alignment of a paragraph (`w:jc`, ECMA-376 §17.3.1.13). */
export type Alignment = 'left' | 'center' | 'right' | 'both';

export function paragraphAlignment(props: readonly OoxmlProperty[]): Alignment {
  const rtl = paragraphIsRtl(props);
  let alignment: Alignment = rtl ? 'right' : 'left';
  for (const property of props) {
    if (property.localName !== 'jc') continue;
    switch (property.attributes?.val) {
      // Logical start/end follow the resolved paragraph direction.
      case 'center':
        alignment = 'center';
        break;
      case 'right':
        alignment = 'right';
        break;
      case 'start':
        alignment = rtl ? 'right' : 'left';
        break;
      case 'end':
        alignment = rtl ? 'left' : 'right';
        break;
      case 'both':
      case 'distribute':
        alignment = 'both';
        break;
      default:
        alignment = 'left';
    }
  }
  return alignment;
}
