// The object model, as a consumer sees it.
//
// Every type here is reached FROM a request context rather than constructed: `context.document` is
// the only entry, and each object hands out the next. The classes are exported so that a consumer
// can name them in their own signatures — `function summarize(body: Body)` — not so that anyone can
// build one, which is why every constructor is private.

export { Body } from './body.ts';
export { ParagraphCollection, RangeCollection } from './collections.ts';
export { Document } from './document.ts';
export type {
  BesideLocation,
  BodyInsertParagraphLocation,
  BodyInsertTextLocation,
  InsertLocation,
  ParagraphInsertTextLocation,
  RangeInsertTextLocation,
  SelectionMode,
} from './locations.ts';
export { Paragraph } from './paragraph.ts';
export { Range } from './range.ts';
export type { SearchOptions } from './search-options.ts';
