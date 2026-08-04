// A story: the main body of a document, and everything in it in reading order.
//
// ITS PARAGRAPHS ARE THE DOCUMENT'S, NOT THE TOP LEVEL'S. A paragraph inside a table cell — or
// inside a table inside a cell, or inside a block-level content control — is an ordinary editable
// paragraph, and Word's own paragraph collection contains it. So does this one. A collection that
// listed only the body's direct children would answer a smaller document than the one on screen.
//
// `clear()` LEAVES ONE EMPTY PARAGRAPH, because a `w:body` with no paragraph at all is not what
// Word produces when a reader selects everything and presses delete. A body that ALREADY holds no
// paragraph has nothing to clear and says so (`InvalidArgument`) rather than inventing a block:
// creating a paragraph in a story that has none is a different operation from editing one, and this
// slice does not implement it.

import {
  ObjectPath,
  fail,
  hydratedSpan,
  internalsOf,
  type AutomationHandle,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection, RangeCollection } from './collections.ts';
import { bodyParagraphLocation, bodyTextLocation, insertableText } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';
import { Range } from './range.ts';
import { searchOptions, type SearchOptions } from './search-options.ts';

export class Body extends ModelObject {
  #paragraphs: ParagraphCollection | undefined;

  /** @internal The main story of the document this context is running against. */
  static main(context: RequestContext, label: string): Body {
    return new Body(context, ObjectPath.of(label, internalsOf(context).roots().body));
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }

  /**
   * The whole story's text.
   *
   * Its paragraphs joined by a carriage return — one paragraph mark each — which is the separator
   * Word's own text property uses, so a caller counting characters counts what Word counts.
   */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= this.paragraphsUnder(`${this.path.label}.paragraphs`);
    return this.#paragraphs;
  }

  /**
   * @internal A collection over this story under another name.
   *
   * `document.paragraphs` is the main story's paragraphs, and it is its OWN object: loading it must
   * not quietly load `document.body.paragraphs` too, and an error about it should say which of the
   * two the consumer wrote.
   */
  paragraphsUnder(label: string): ParagraphCollection {
    return ParagraphCollection.of(this.context, label, this.path);
  }

  /** Every occurrence of `searchText` in this story, as ranges, in reading order. */
  search(searchText: string, options?: SearchOptions): RangeCollection {
    const target = `${this.path.label}.search`;
    if (typeof searchText !== 'string') fail({ code: 'InvalidArgument', target });
    const selected = searchOptions(options, target);
    const handle = this.#handle();
    return RangeCollection.of(this.context, target, this.path, () => ({
      op: 'search',
      scope: { body: handle },
      text: searchText,
      ...(selected === undefined ? {} : { options: selected }),
    }));
  }

  /** Empty the story, leaving one empty paragraph behind. */
  clear(): void {
    const handle = this.#handle();
    this.commandDiscarding('clear', () => ({
      op: 'replaceSpan',
      span: { body: handle },
      text: '',
    }));
  }

  /** Write text over the whole story, or at either edge of it. Answers the text's own range. */
  insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range {
    const target = `${this.path.label}.insertText`;
    const written = insertableText(text, target);
    const where = bodyTextLocation(insertLocation, target);
    const handle = this.#handle();
    const created = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () =>
        where === 'Replace'
          ? { op: 'replaceSpan', span: { body: handle }, text: written }
          : {
              op: 'insertText',
              at: { body: handle, at: where === 'Start' ? 'start' : 'end' },
              text: written,
            },
      (value) => {
        created.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return created;
  }

  /** Add a paragraph at the start or the end of the story. Answers the new paragraph. */
  insertParagraph(paragraphText: string, insertLocation: 'Start' | 'End'): Paragraph {
    const target = `${this.path.label}.insertParagraph`;
    const written = insertableText(paragraphText, target);
    const where = bodyParagraphLocation(insertLocation, target);
    const handle = this.#handle();
    const created = Paragraph.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertParagraph',
        anchor: { body: handle, at: where === 'Start' ? 'first' : 'last' },
        where: where === 'Start' ? 'before' : 'after',
        text: written,
      }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress({ kind: 'handle', handle: value.handle });
      }
    );
    return created;
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    if (!this.selection(request, ['text']).includes('text')) return;
    const handle = this.#handle();
    this.loadTextInto('text', () => ({ op: 'getText', target: handle }));
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}
