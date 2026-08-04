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
import { ModelObject } from './model-object.ts';

export class Document extends ModelObject {
  #body: Body | undefined;
  #paragraphs: ParagraphCollection | undefined;

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

  protected override onLoad(request: ResolvedLoadOptions): void {
    // The document offers no readable property of its own in this slice, so the only selection it
    // accepts is the empty one — and naming a property it does not have is refused, not ignored.
    this.selection(request, []);
  }
}
