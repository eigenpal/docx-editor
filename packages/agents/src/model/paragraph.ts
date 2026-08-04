// One paragraph: what it says, what it is, and the ways this slice changes it.
//
// IDENTITY IS THE DOCUMENT'S OWN. `uniqueLocalId` is the `w14:paraId` the part carries — the value
// Word writes, and the one `commentsExtended.xml` and coauthoring merges already anchor to — never a
// position in a collection. Deleting the paragraph above this one does not change it, which is the
// whole point: an agent that read a document, thought about it, and now wants to write to "the
// paragraph I was looking at" cannot express that with an index. A paragraph the file gave none gets
// one deterministically when the document is opened, so the same bytes always answer the same
// identities and saving writes them into the file.
//
// It is NOT a member of the frozen compatibility subset; the recorded reason is in
// `compat/manifest.json`'s omissions.
//
// A STRUCTURAL EDIT OWNS ITS PARAGRAPH FOR THE BATCH. `delete()`, `split()` and `insertParagraph()`
// change what offsets in this paragraph mean, so a second call in the same `sync()` that also
// touches it is refused with `ConflictingChanges` rather than planned against coordinates that have
// stopped describing it. Two syncs get both edits, each exactly as asked.

import {
  ObjectPath,
  fail,
  hydratedSpan,
  type AutomationHandle,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { RangeCollection, type PromisedItem } from './collections.ts';
import { besideLocation, insertableText, paragraphTextLocation } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';

/** Most delimiters one `split` may name. The host applies its own cap as well. */
const MAX_DELIMITERS = 16;

export class Paragraph extends ModelObject implements PromisedItem {
  /** @internal A paragraph a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Paragraph {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Paragraph(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A paragraph a queued operation will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Paragraph {
    return new Paragraph(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** This paragraph's text. Readable after `load('text')` and a `sync()`. */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /**
   * The document's own identity for this paragraph.
   *
   * Stable across edits elsewhere in the document and across a save and reopen, because it is
   * written into the file rather than worked out from where the paragraph sits.
   */
  get uniqueLocalId(): string {
    return this.loadedProperty<string>('uniqueLocalId');
  }

  /** Empty this paragraph's text, leaving the paragraph itself where it is. */
  clear(): void {
    const handle = this.#handle();
    this.commandDiscarding('clear', () => ({
      op: 'replaceSpan',
      span: { paragraph: handle },
      text: '',
    }));
  }

  /** Remove this paragraph and everything in it. */
  delete(): void {
    const handle = this.#handle();
    this.command('delete', () => ({ op: 'deleteParagraph', paragraph: handle }));
  }

  /** Write text over this paragraph or at either edge of it. Answers the written text's range. */
  insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range {
    const target = `${this.path.label}.insertText`;
    const written = insertableText(text, target);
    const where = paragraphTextLocation(insertLocation, target);
    const handle = this.#handle();
    const created = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () =>
        where === 'Replace'
          ? { op: 'replaceSpan', span: { paragraph: handle }, text: written }
          : {
              op: 'insertText',
              at: { paragraph: handle, at: where === 'Start' ? 'start' : 'end' },
              text: written,
            },
      (value) => {
        created.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return created;
  }

  /** Add a paragraph beside this one. Answers the new paragraph. */
  insertParagraph(paragraphText: string, insertLocation: 'Before' | 'After'): Paragraph {
    const target = `${this.path.label}.insertParagraph`;
    const written = insertableText(paragraphText, target);
    const where = besideLocation(insertLocation, target);
    const handle = this.#handle();
    const created = Paragraph.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertParagraph',
        anchor: { paragraph: handle },
        where: where === 'Before' ? 'before' : 'after',
        text: written,
      }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress({ kind: 'handle', handle: value.handle });
      }
    );
    return created;
  }

  /**
   * Break this paragraph at every occurrence of any delimiter.
   *
   * Answers one range per resulting paragraph, in reading order, INCLUDING the piece that keeps
   * this paragraph's identity — so a caller can read back what each piece became without having to
   * work out which of them is the original. The collection is filled by the split itself: there is
   * no second read, because a second read would describe the document the split had already made.
   */
  split(delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean): RangeCollection {
    const target = `${this.path.label}.split`;
    const chosen = requireDelimiters(delimiters, target);
    const dropDelimiters = requireFlag(trimDelimiters, `${target}.trimDelimiters`);
    const dropSpacing = requireFlag(trimSpacing, `${target}.trimSpacing`);
    const handle = this.#handle();
    const pieces = RangeCollection.answered(this.context, target, this.path);
    this.commandAnswering(
      target,
      () => ({
        op: 'splitParagraph',
        paragraph: handle,
        delimiters: chosen,
        ...(dropDelimiters ? { trimDelimiters: true } : {}),
        ...(dropSpacing ? { trimSpacing: true } : {}),
      }),
      (value) => {
        pieces.fill(value, target);
      }
    );
    return pieces;
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['text', 'uniqueLocalId']);
    const handle = this.#handle();
    if (selected.includes('text')) {
      this.loadTextInto('text', () => ({ op: 'getText', target: handle }));
    }
    if (selected.includes('uniqueLocalId')) {
      this.loadTextInto('uniqueLocalId', () => ({ op: 'getParagraphId', paragraph: handle }));
    }
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

function requireDelimiters(value: unknown, target: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DELIMITERS) {
    fail({ code: 'InvalidArgument', target });
  }
  for (const delimiter of value as unknown[]) {
    if (typeof delimiter !== 'string' || delimiter.length === 0) {
      fail({ code: 'InvalidArgument', target });
    }
  }
  return [...(value as string[])];
}

function requireFlag(value: unknown, target: string): boolean {
  if (value !== undefined && typeof value !== 'boolean') fail({ code: 'InvalidArgument', target });
  return value === true;
}
