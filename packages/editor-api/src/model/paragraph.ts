/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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
  hydratedApplied,
  hydratedHandle,
  hydratedParagraphFormat,
  hydratedSpan,
  type AutomationHandle,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { RangeCollection, type PromisedItem } from './collections.ts';
import { List, ListItem } from './lists.ts';
import { requireStyleName } from './addressing.ts';
import { Font } from './font.ts';
import { besideLocation, insertableText, paragraphTextLocation } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';

/** Most delimiters one `split` may name. The host applies its own cap as well. */
const MAX_DELIMITERS = 16;

/** Paragraph alignment values readable and writable through this object model. */
export type ParagraphAlignment = 'Mixed' | 'Unknown' | 'Left' | 'Centered' | 'Right' | 'Justified';

/**
 * One paragraph: what it says, what it is, and the ways it can be changed.
 *
 * Identity is the document's own. {@link Paragraph.uniqueLocalId} is the `w14:paraId` the file
 * carries — the value Word writes, and the one `commentsExtended.xml` and coauthoring merges
 * already anchor to — never a position in a collection. Deleting the paragraph above this one
 * does not change it, which is the point: an agent that read a document, thought about it, and
 * now wants to write to "the paragraph I was looking at" cannot express that with an index. A
 * paragraph the file gave no id gets one deterministically at open, so the same bytes always
 * answer the same identities and saving writes them back.
 *
 * A structural edit owns its paragraph for the batch: `delete()`, `split()` and
 * `insertParagraph()` change what offsets mean, so a second call in the same `sync()` that also
 * touches this paragraph is refused with `ConflictingChanges` rather than planned against
 * coordinates that have stopped describing it. Two syncs get both edits, each exactly as asked.
 *
 * @public
 */
export class Paragraph extends ModelObject implements PromisedItem {
  #font: Font | undefined;
  #list: List | undefined;
  #listItem: ListItem | undefined;
  #format: Record<string, unknown> | undefined;

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

  /** @internal Bind this object to the address the owning read answered. */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal Settle as the null object: the read found nothing to name. */
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

  /**
   * The paragraph style, by the name a reader sees in the styles gallery.
   *
   * `null` where the document names none. A name it does not already define is refused rather than
   * created, and the write rides the same `w:pPr` rewrite the alignment and indent members do — so
   * applying a style and adjusting a spacing in one sync is one write rather than a refusal.
   */
  get style(): string {
    return this.loadedProperty<string>('style');
  }

  set style(value: string) {
    this.#authorFormat('style', requireStyleName(value, `${this.path.label}.style`));
  }

  /** The character formatting of this paragraph's characters, and of its paragraph mark. */
  get font(): Font {
    this.#font ??= Font.of(this.context, `${this.path.label}.font`, this.path, 'paragraph');
    return this.#font;
  }

  /**
   * How the paragraph's lines are aligned, or `Unknown` where it authors no alignment.
   *
   * `Unknown` rather than `Left`: a paragraph that states nothing may still be centred by its
   * style, and naming a side would be a claim about the cascade this lane does not resolve.
   */
  get alignment(): ParagraphAlignment {
    return this.loadedProperty<ParagraphAlignment>('alignment');
  }

  set alignment(value: ParagraphAlignment) {
    this.#authorFormat('alignment', requireAlignment(value, `${this.path.label}.alignment`));
  }

  /** Points. Negative for a hanging indent — the first line starting left of the rest. */
  get firstLineIndent(): number {
    return this.loadedProperty<number>('firstLineIndent');
  }

  set firstLineIndent(value: number) {
    this.#authorFormat(
      'firstLineIndent',
      requirePoints(value, `${this.path.label}.firstLineIndent`)
    );
  }

  /** Points. */
  get leftIndent(): number {
    return this.loadedProperty<number>('leftIndent');
  }

  set leftIndent(value: number) {
    this.#authorFormat('leftIndent', requirePoints(value, `${this.path.label}.leftIndent`));
  }

  /** Points. */
  get rightIndent(): number {
    return this.loadedProperty<number>('rightIndent');
  }

  set rightIndent(value: number) {
    this.#authorFormat('rightIndent', requirePoints(value, `${this.path.label}.rightIndent`));
  }

  /** Points between the paragraph's lines. */
  get lineSpacing(): number {
    return this.loadedProperty<number>('lineSpacing');
  }

  set lineSpacing(value: number) {
    this.#authorFormat('lineSpacing', requirePoints(value, `${this.path.label}.lineSpacing`));
  }

  /** Points above the paragraph. */
  get spaceBefore(): number {
    return this.loadedProperty<number>('spaceBefore');
  }

  set spaceBefore(value: number) {
    this.#authorFormat('spaceBefore', requirePoints(value, `${this.path.label}.spaceBefore`));
  }

  /** Points below the paragraph. */
  get spaceAfter(): number {
    return this.loadedProperty<number>('spaceAfter');
  }

  set spaceAfter(value: number) {
    this.#authorFormat('spaceAfter', requirePoints(value, `${this.path.label}.spaceAfter`));
  }

  /**
   * The list this paragraph is in.
   *
   * A paragraph in NO list refuses the batch (`InvalidArgument`), the way upstream's own accessor
   * throws: a list a paragraph is not in has no members to answer, and a null object here would
   * make "not numbered" indistinguishable from "numbered by a list this document has lost".
   */
  get list(): List {
    this.#list ??= this.#listAt(`${this.path.label}.list`);
    return this.#list;
  }

  /** Where this paragraph sits in its list. Reading `level` on a paragraph in none refuses. */
  get listItem(): ListItem {
    this.#listItem ??= ListItem.of(this.context, `${this.path.label}.listItem`, this.path);
    return this.#listItem;
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

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['text', 'uniqueLocalId', ...FORMAT_FIELDS]);
    const handle = this.#handle();
    if (selected.includes('text')) {
      this.loadTextInto('text', () => ({ op: 'getText', target: handle }));
    }
    if (selected.includes('uniqueLocalId')) {
      this.loadTextInto('uniqueLocalId', () => ({ op: 'getParagraphId', paragraph: handle }));
    }
    const format = FORMAT_FIELDS.filter((field) => selected.includes(field));
    if (format.length === 0) return;
    // ONE read for however many of them were asked for: they all come out of the same `w:pPr`, so
    // a read each would send several operations about one element and make the cost of a load
    // depend on how many fields the caller happened to name.
    const label = `${this.path.label}.paragraphFormat`;
    this.read(
      label,
      () => ({ op: 'getParagraphFormat', paragraph: { paragraph: handle } }),
      (value) => {
        const read = hydratedParagraphFormat(value, label);
        for (const field of format) this.setLoadedProperty(field, read[field]);
      }
    );
  }

  /**
   * Accumulate paragraph-property assignments into ONE write per sync.
   *
   * Same reason as `Font`: a paragraph-property op carries the paragraph's whole authored bag so it
   * can replace the container, and the host refuses a second one in the same batch because it would
   * have been built from the tree the first already changed. The bag is snapshotted and cleared at
   * dispatch, so what is assigned after a sync belongs to the next one.
   */
  #authorFormat(field: FormatField, value: unknown): void {
    this.requireAddressable();
    if (this.#format) {
      this.#format[field] = value;
      return;
    }
    const pending: Record<string, unknown> = { [field]: value };
    this.#format = pending;
    const handle = this.#handle();
    const label = `${this.path.label}.${field}`;
    this.commandAnswering(
      `${this.path.label}.paragraphFormat`,
      () => {
        this.#format = undefined;
        return { op: 'setParagraphFormat', paragraph: { paragraph: handle }, format: pending };
      },
      (answer) => {
        hydratedApplied(answer, label);
      }
    );
  }

  #listAt(label: string): List {
    const handle = this.#handle();
    const found = List.promised(this.context, label, false);
    this.read(
      label,
      () => ({ op: 'getParagraphList', paragraph: handle }),
      (value) => {
        found.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, label) });
      }
    );
    return found;
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

/** The paragraph's own paragraph properties, as this model spells them. */
const FORMAT_FIELDS = [
  'style',
  'alignment',
  'firstLineIndent',
  'leftIndent',
  'rightIndent',
  'lineSpacing',
  'spaceBefore',
  'spaceAfter',
] as const;

type FormatField = (typeof FORMAT_FIELDS)[number];

const ALIGNMENTS: readonly ParagraphAlignment[] = [
  'Left',
  'Centered',
  'Right',
  'Justified',
] as const;

/**
 * An alignment a write may name.
 *
 * `Mixed` and `Unknown` are READ answers — "they disagree" and "nothing is stated" — and there is
 * nothing for a write to mean by either. Refusing says so rather than picking a side.
 */
function requireAlignment(value: unknown, target: string): ParagraphAlignment {
  if (!ALIGNMENTS.includes(value as ParagraphAlignment)) {
    fail({ code: 'InvalidArgument', target });
  }
  return value as ParagraphAlignment;
}

function requirePoints(value: unknown, target: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail({ code: 'InvalidArgument', target });
  }
  return value;
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
