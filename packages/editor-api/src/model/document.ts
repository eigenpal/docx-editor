/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The document: the root everything else is reached from.
//
// It is deliberately thin. A document in this API is not a bag of content — it is the thing that has
// stories, and this slice publishes one of them (`body`) plus the main story's paragraphs as a
// convenience, because `document.paragraphs` is how source-compatible code walks a document.
//
// WHAT IS NOT HERE IS NOT HERE ON PURPOSE. `contentControls`, `comments` and `sections` are declared
// in the compatibility surface and are not implemented in this slice; a getter that answered an
// empty collection would be indistinguishable from a document that has none, which is exactly the
// kind of quiet wrong answer this lane is built to avoid. They arrive with the slices that can read
// them.

import {
  ObjectPath,
  internalsOf,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { Body } from './body.ts';
import type { ParagraphCollection } from './collections.ts';
import { ContentControlCollection } from './content-controls.ts';
import { ModelObject } from './model-object.ts';
import { NoteItemCollection } from './notes.ts';
import { CommentCollection, RevisionCollection } from './review.ts';
import { SectionCollection } from './sections.ts';

/**
 * The document: the root every other object is reached from.
 *
 * Deliberately thin. A document here is not a bag of content — it is the thing that HAS stories.
 * It publishes the main story as {@link Document.body}, plus that story's paragraphs directly as
 * `document.paragraphs`, because that is how source-compatible code walks a document.
 *
 * Reached once per {@link RequestContext} and memoized: `context.document` is the same object
 * every time, so a property loaded through one reference reads back through any other.
 *
 * @example
 * ```ts
 * await runtime.run(async (context) => {
 *   const paragraphs = context.document.paragraphs;
 *   paragraphs.load('items');
 *   await context.sync();
 *
 *   for (const paragraph of paragraphs.items) paragraph.load('text');
 *   await context.sync();
 *
 *   for (const paragraph of paragraphs.items) console.log(paragraph.text);
 * });
 * ```
 *
 * The first sync retrieves the collection's items. Once those items are available, the second
 * sync retrieves each paragraph's text.
 *
 * @public
 */
export class Document extends ModelObject {
  #body: Body | undefined;
  #paragraphs: ParagraphCollection | undefined;
  #sections: SectionCollection | undefined;
  #comments: CommentCollection | undefined;
  #revisions: RevisionCollection | undefined;
  #contentControls: ContentControlCollection | undefined;
  #footnotes: NoteItemCollection | undefined;
  #endnotes: NoteItemCollection | undefined;

  /** @internal One per request context; the context memoizes it. */
  static open(context: RequestContext): Document {
    return new Document(context);
  }

  private constructor(context: RequestContext) {
    super(context, ObjectPath.of('document', internalsOf(context).roots().document));
  }

  /**
   * The main story.
   *
   * The same proxy every time, like every navigation property in this API: a consumer who loads
   * `document.body` and then reads `document.body.text` is talking about one object, and handing
   * back a fresh proxy per access would put the load on one and the read on another.
   */
  get body(): Body {
    this.#body ??= Body.main(this.context, 'document.body');
    return this.#body;
  }

  /** The main story's paragraphs, in reading order. */
  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= this.body.paragraphsUnder('document.paragraphs');
    return this.#paragraphs;
  }

  /** The document's sections, in document order. */
  get sections(): SectionCollection {
    const document = this.path.handle();
    this.#sections ??= SectionCollection.of(this.context, 'document.sections', this.path, () => ({
      op: 'getSections',
      document,
    }));
    return this.#sections;
  }

  /** The content controls of the main story, in document order — the outermost ones. */
  get contentControls(): ContentControlCollection {
    this.#contentControls ??= ContentControlCollection.of(
      this.context,
      'document.contentControls',
      this.path,
      { body: this.internals.roots().body }
    );
    return this.#contentControls;
  }

  /** The comments anchored in the main story, in document order. */
  get comments(): CommentCollection {
    this.#comments ??= CommentCollection.of(this.context, 'document.comments', this.path, () => ({
      op: 'getComments',
      scope: { body: this.internals.roots().body },
    }));
    return this.#comments;
  }

  /**
   * The tracked changes of the main story that the engine can resolve.
   *
   * Structural changes — a row, a cell, a section, the table grid — are not in it: they are ones the
   * engine refuses to accept or reject, and an item whose two verbs both refuse would stall code
   * walking the collection. `acceptAll`/`rejectAll` refuse outright where the document holds one,
   * rather than reporting a document as reviewed while pending changes remain.
   */
  get revisions(): RevisionCollection {
    this.#revisions ??= RevisionCollection.of(
      this.context,
      'document.revisions',
      this.path,
      this.internals.roots().body
    );
    return this.#revisions;
  }

  /**
   * The document's footnotes, in the order its notes part writes them.
   *
   * DocxEditor's own accessor: upstream reaches notes through `Body#footnotes`, whose collection type
   * the pinned reference fixture does not carry — see `compat/manifest.json`. Without an accessor a
   * note would be unreachable, so it is published here and recorded as unmeasured.
   */
  get footnotes(): NoteItemCollection {
    const document = this.path.handle();
    this.#footnotes ??= NoteItemCollection.of(
      this.context,
      'document.footnotes',
      this.path,
      () => ({ op: 'getNotes', document, noteKind: 'footnote' })
    );
    return this.#footnotes;
  }

  /** The document's endnotes, in the order its notes part writes them. */
  get endnotes(): NoteItemCollection {
    const document = this.path.handle();
    this.#endnotes ??= NoteItemCollection.of(this.context, 'document.endnotes', this.path, () => ({
      op: 'getNotes',
      document,
      noteKind: 'endnote',
    }));
    return this.#endnotes;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    // The document offers no readable property of its own in this slice, so the only selection it
    // accepts is the empty one — and naming a property it does not have is refused, not ignored.
    this.selection(request, []);
  }
}
