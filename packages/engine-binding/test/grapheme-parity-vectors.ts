/** Shared grapheme parity vectors — binding sync must match engine-layout segmentation. */
export const GRAPHEME_PARITY_VECTORS = [
  { label: 'ascii', text: 'hello', offsets: [0, 1, 3, 5] },
  { label: 'combining acute', text: 'e\u0301', offsets: [0, 1, 2] },
  { label: 'surrogate pair', text: '😀X', offsets: [0, 1, 2] },
  { label: 'mixed', text: 'a😀b', offsets: [0, 1, 2, 3] },
] as const;
