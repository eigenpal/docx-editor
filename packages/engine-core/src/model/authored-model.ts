// Canonical authored package model (document-engine task 2.9 / design D1 /
// lossless-package-model "Authored package state is canonical"). This is the one
// source of truth: editable stories, authored properties where `undefined` means
// OMITTED (inherit) — never a materialized resolved value — stable identities,
// content types, relationships, styles, numbering, and parts. Resolved
// styles/numbering/fields/layout live only in derived caches (sections 3, 8),
// never here.

import type { ContentTypeRecords, RelationshipRecord } from '../package/index.ts';

/** Run formatting. Every field is optional: absent = authored omission (inherit). */
export interface RunProps {
  readonly styleId?: string;
  readonly bold?: boolean; // explicit true/false is authored; undefined = omitted
  readonly italic?: boolean;
  readonly underline?: boolean;
}

export interface RunRecord {
  /** Present only where anchoring requires a stable run identity. */
  readonly id?: string;
  readonly text: string;
  readonly props?: RunProps;
}

export interface ParagraphProps {
  readonly styleId?: string;
  readonly numId?: string;
  readonly ilvl?: number;
}

export interface ParagraphRecord {
  readonly kind: 'paragraph';
  readonly id: string;
  readonly runs: readonly RunRecord[];
  readonly props?: ParagraphProps;
}

// Tables, SDT, and other block kinds land in task 2.7; the union is open.
export type Block = ParagraphRecord;

export type StoryKind = 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'comment' | 'textbox';

export interface Story {
  readonly id: string;
  readonly kind: StoryKind;
  readonly blocks: readonly Block[];
}

export interface StyleRecord {
  readonly id: string;
  readonly name: string;
  readonly type: 'paragraph' | 'character' | 'table' | 'numbering';
  readonly isDefault?: boolean;
}

export interface NumberingRecord {
  readonly numId: string;
  readonly abstractId: string;
}

export type PartRecord =
  | { readonly kind: 'xml'; readonly partName: string; readonly storyId?: string }
  | { readonly kind: 'media'; readonly partName: string; readonly bytesRef?: string };

/** Serializable allocator cursors — part of the model so IDs are stable across reopen. */
export interface IdentityState {
  readonly cursors: Readonly<Record<string, number>>;
}

export interface PackageModel {
  readonly contentTypes: ContentTypeRecords;
  readonly relationships: readonly RelationshipRecord[];
  readonly stories: ReadonlyMap<string, Story>;
  readonly styles: readonly StyleRecord[];
  readonly numbering: readonly NumberingRecord[];
  readonly parts: ReadonlyMap<string, PartRecord>;
  readonly identity: IdentityState;
}

// Standard OOXML/OPC relationship type URIs used by create-from-scratch.
export const REL_TYPES = {
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
} as const;

export const CONTENT_TYPES = {
  relationships: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  documentMain: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
} as const;
