/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */
import type { AuthoredProperty } from './authored-property';

export interface ImmutableLookup<K, V> extends Iterable<readonly [K, V]> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  entries(): IterableIterator<readonly [K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
}

export type AuthoredMarkKind = 'bold' | 'italic';

export interface AuthoredMark {
  readonly markId: string;
  readonly kind: AuthoredMarkKind;
  readonly start: number;
  readonly end: number;
}

export interface AuthoredParagraph {
  readonly blockId: string;
  readonly paragraphId: string;
  readonly text: string;
  readonly styleId: string;
  readonly marks: readonly AuthoredMark[];
  readonly authoredProperties: Readonly<Record<string, AuthoredProperty>>;
}

export interface AuthoredBodyStory {
  readonly storyId: string;
  readonly paragraphOrder: readonly string[];
  readonly paragraphs: ImmutableLookup<string, AuthoredParagraph>;
}

export interface AuthoredBodyStoryInput {
  readonly storyId: string;
  readonly paragraphOrder: readonly string[];
  readonly paragraphs: ImmutableLookup<string, AuthoredParagraph> | Map<string, AuthoredParagraph>;
}

export interface UnsupportedCapsule {
  readonly capsuleId: string;
  readonly ownerStoryId: string;
  readonly ownerBlockId: string;
  readonly childIndex: number;
  readonly byteBoundaryStart: number;
  readonly byteBoundaryEnd: number;
  readonly bytes: Uint8Array;
  readonly namespaceBindings: Readonly<Record<string, string>>;
  readonly previousSiblingBytes: Uint8Array;
  readonly nextSiblingBytes: Uint8Array;
}

export interface AuthoredPackageModel {
  readonly body: AuthoredBodyStory;
  readonly capsules: readonly UnsupportedCapsule[];
}

export interface AuthoredPackageModelInput {
  readonly body: AuthoredBodyStoryInput;
  readonly capsules: readonly UnsupportedCapsule[];
}

export type ModelRevision = number;

export interface DocumentModel {
  readonly authored: AuthoredPackageModel;
  readonly revision: ModelRevision;
}
