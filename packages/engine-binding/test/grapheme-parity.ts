import { graphemeOffsetToUtf16 } from '../src/grapheme.ts';
import { graphemeOffsetToUtf16 as layoutGraphemeOffsetToUtf16 } from '@docx-editor.dev/engine-layout';
import { GRAPHEME_PARITY_VECTORS } from './grapheme-parity-vectors.ts';

/** Prove binding grapheme offsets match engine-layout segmentation contract. */
export function expectGraphemeParity(): void {
  for (const vector of GRAPHEME_PARITY_VECTORS) {
    for (const offset of vector.offsets) {
      const binding = graphemeOffsetToUtf16(vector.text, offset);
      const layout = layoutGraphemeOffsetToUtf16(vector.text, offset);
      if (binding !== layout) {
        throw new Error(`grapheme parity mismatch for ${vector.label} offset ${offset}: binding=${binding} layout=${layout}`);
      }
    }
  }
}
