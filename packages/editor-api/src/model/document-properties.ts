/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedText,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ModelObject } from './model-object.ts';
const FIELDS = [
  'author',
  'title',
  'subject',
  'keywords',
  'comments',
  'category',
  'lastAuthor',
] as const;
type Field = Exclude<(typeof FIELDS)[number], 'lastAuthor'>;

/**
 * Core document properties. Load explicit names before reads; assignments commit at sync.
 * Values are XML-safe strings of at most 4096 characters. Tracked writes are unsupported.
 * Individual dates and custom properties are unsupported. Document.removeDocumentInformation can remove property parts.
 * Collaborative writes require an existing core-properties part.
 * Create properties before joining collaboration when the input omits that part.
 * @public
 */
export class DocumentProperties extends ModelObject {
  #pending: Partial<Record<Field, string>> | undefined;
  /** @internal */
  static of(context: RequestContext, owner: ObjectPath): DocumentProperties {
    return new DocumentProperties(context, ObjectPath.derived('document.properties', owner));
  }
  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }
  /** Last saved author, from cp:lastModifiedBy. Load before reading. */
  get lastAuthor(): string {
    return this.loadedProperty<string>('lastAuthor');
  }
  /** Document author metadata, separate from the revision author. Load before reading; assign before sync. */
  get author(): string {
    return this.loadedProperty<string>('author');
  }
  set author(value: string) {
    this.#write('author', value);
  }
  /** Document title metadata. Load before reading; assign before sync. */
  get title(): string {
    return this.loadedProperty<string>('title');
  }
  set title(value: string) {
    this.#write('title', value);
  }
  /** Document subject metadata. Load before reading; assign before sync. */
  get subject(): string {
    return this.loadedProperty<string>('subject');
  }
  set subject(value: string) {
    this.#write('subject', value);
  }
  /** Document search keywords. Load before reading; assign before sync. */
  get keywords(): string {
    return this.loadedProperty<string>('keywords');
  }
  set keywords(value: string) {
    this.#write('keywords', value);
  }
  /** Document description metadata, separate from review comments. Load before reading; assign before sync. */
  get comments(): string {
    return this.loadedProperty<string>('comments');
  }
  set comments(value: string) {
    this.#write('comments', value);
  }
  /** Document category metadata. Load before reading; assign before sync. */
  get category(): string {
    return this.loadedProperty<string>('category');
  }
  set category(value: string) {
    this.#write('category', value);
  }
  protected override onLoad(request: ResolvedLoadOptions): void {
    for (const field of this.selection(request, FIELDS) as (typeof FIELDS)[number][]) {
      this.read(
        `${this.path.label}.${field}`,
        () => ({ op: 'getDocumentProperty', name: field }),
        (value) => this.setLoadedProperty(field, hydratedText(value, this.path.label))
      );
    }
  }
  #write(field: Field, value: string): void {
    this.requireUsablePath();
    if (typeof value !== 'string' || value.length > 4096)
      fail({ code: 'InvalidArgument', target: `${this.path.label}.${field}` });
    if (this.#pending) {
      this.#pending[field] = value;
      return;
    }
    const pending = { [field]: value };
    this.#pending = pending;
    this.commandAnswering(
      this.path.label,
      () => ({ op: 'setDocumentProperties', values: pending }),
      (answer) => {
        hydratedApplied(answer, this.path.label);
      },
      () => {
        if (this.#pending === pending) this.#pending = undefined;
      }
    );
  }
}
