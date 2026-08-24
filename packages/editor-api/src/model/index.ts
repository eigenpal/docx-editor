/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The object model, as a consumer sees it.
//
// Every type here is reached FROM a request context rather than constructed: `context.document` is
// the only entry, and each object hands out the next. The classes are exported so that a consumer
// can name them in their own signatures — `function summarize(body: Body)` — not so that anyone can
// build one, which is why every constructor is private.

export { Body } from './body.ts';
export { Bookmark, BookmarkCollection } from './bookmarks.ts';
export { ParagraphCollection, RangeCollection } from './collections.ts';
export {
  ContentControl,
  ContentControlCollection,
  type ContentControlLockState,
  type ContentControlSubtype,
  type ContentControlValue,
} from './content-controls.ts';
export { Document } from './document.ts';
export { Font } from './font.ts';
export { List, ListCollection, ListItem } from './lists.ts';
export { NoteItem, NoteItemCollection, type NoteItemType } from './notes.ts';
export {
  Comment,
  CommentCollection,
  CommentReply,
  CommentReplyCollection,
  Revision,
  RevisionCollection,
  type RevisionType,
} from './review.ts';
export {
  PageSetup,
  Section,
  SectionCollection,
  type HeaderFooterType,
  type PageOrientation,
} from './sections.ts';
export type {
  BesideLocation,
  BodyInsertParagraphLocation,
  BodyInsertTextLocation,
  InsertLocation,
  ParagraphInsertTextLocation,
  RangeInsertTextLocation,
  SelectionMode,
} from './locations.ts';
export { Paragraph, type ParagraphAlignment } from './paragraph.ts';
export { Range } from './range.ts';
export type { SearchOptions } from './search-options.ts';
export type { TextProjection, TextReadOptions } from './text-options.ts';
