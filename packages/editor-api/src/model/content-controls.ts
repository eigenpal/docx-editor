/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Content controls: the parts of a document a template said were fields.
//
// A CONTROL IS NOT ITS `w:id`. The attribute is optional in OOXML and unique nowhere, so a
// document may hold one control with no id and two with the same one. This object is therefore
// addressed by an opaque handle the host mints, and `id` is answered as METADATA — a label the
// file wrote, empty where it wrote none. `getById` still exists because a template author knows
// their own numbering, and it answers the first match in document order rather than refusing:
// choosing predictably is more useful to that author than being right about a file that is
// ambiguous by construction.
//
// A CONTROL'S CONTENTS ARE NOT ITS VALUE. `text` reads the characters; `setValue` writes in the
// vocabulary the control's own type accepts — a declared item for a dropdown, an ISO date for a
// date picker, a state for a checkbox — because writing "true" into a checkbox's runs would
// produce a document whose glyph and whose `w14:checked` disagree. The typed accessors Word
// exposes as `checkboxContentControl`, `dropDownListContentControl` and the rest are recorded as
// omissions in `compat/manifest.json`: one `setValue` covers the same ground without shipping
// five sibling objects that each answer one field.
//
// `appearance` AND `color` ARE NOT HERE. Both are `w15` extension properties — how Word DRAWS
// the control's boundary, not what the control is — and this engine paints its own furniture from
// the control's properties rather than from a stored chrome colour. Answering them would mean
// declaring a w15 binding whose only consumer is a value nothing renders. Recorded as omissions.

import {
  ObjectPath,
  fail,
  hydratedFlag,
  hydratedHandle,
  hydratedSpan,
  hydratedText,
  type AutomationContentControlRangeLocation,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection } from './collections.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { insertableText } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';

/**
 * What a control's own type accepts as a value.
 *
 * A discriminated union rather than `unknown`: a dropdown and a checkbox do not take the same
 * kind of thing, and a single `setValue(value: string)` would have to guess what `'true'` means
 * to a date picker.
 */
export type ContentControlValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'listItem'; readonly value: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  /** `YYYY-MM-DD`, or a full ISO-8601 instant. */
  | { readonly kind: 'date'; readonly iso: string };

/** The lock a control carries. `ST_Lock`, spelled as the schema spells it. */
export type ContentControlLockState =
  | 'unlocked'
  | 'sdtLocked'
  | 'contentLocked'
  | 'sdtContentLocked';

/** The control types this API can create. Picture and repeating section are deferred. */
export type ContentControlSubtype = 'richText' | 'plainText' | 'dropDownList' | 'comboBox' | 'date';

const SUBTYPES: ReadonlySet<string> = new Set([
  'richText',
  'plainText',
  'dropDownList',
  'comboBox',
  'date',
]);

const LOCKS: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);

/** Longest tag or title this API writes, so a caller cannot ask for an unbounded attribute. */
const MAX_METADATA = 4_096;

export class ContentControl extends ModelObject implements PromisedItem {
  readonly #range = new Map<AutomationContentControlRangeLocation, Range>();
  #paragraphs: ParagraphCollection | undefined;
  #contentControls: ContentControlCollection | undefined;

  /** @internal A control a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): ContentControl {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new ContentControl(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A control a queued read will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): ContentControl {
    return new ContentControl(context, ObjectPath.pending(label), nullable);
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

  /**
   * The `w:id` the file wrote, as a string, and `''` where it wrote none.
   *
   * A STRING and not a number, deliberately. The identity of this object is its handle; a numeric
   * `id` invites a caller to key a map on a value the schema lets a document repeat.
   */
  get id(): string {
    return this.loadedProperty<string>('id');
  }

  /** `w:tag` — the machine-readable label a template puts on a field. `''` where absent. */
  get tag(): string {
    return this.loadedProperty<string>('tag');
  }

  set tag(value: string) {
    this.#writeMetadata('tag', { tag: metadata(value, `${this.path.label}.tag`) });
  }

  /** `w:alias` — what Word's UI calls the control's title. `''` where absent. */
  get title(): string {
    return this.loadedProperty<string>('title');
  }

  set title(value: string) {
    this.#writeMetadata('title', { title: metadata(value, `${this.path.label}.title`) });
  }

  /** What kind of control it is: `plainText`, `dropDownList`, `checkbox`, `date`, … */
  get subtype(): string {
    return this.loadedProperty<string>('subtype');
  }

  /**
   * Whether the control refuses to be deleted.
   *
   * Reads the lock IN FORCE, so a control an enclosing one protects reports true even when its
   * own `w:lock` says otherwise — that is what the document does, and reporting the control's own
   * half would tell a caller an edit will work when the store is about to refuse it.
   */
  get cannotDelete(): boolean {
    const lock = this.loadedProperty<string>('lock');
    return lock === 'sdtLocked' || lock === 'sdtContentLocked';
  }

  set cannotDelete(value: boolean) {
    this.#writeLock(value, this.cannotEdit, `${this.path.label}.cannotDelete`);
  }

  /** Whether the control's contents refuse to be edited. Resolved like `cannotDelete`. */
  get cannotEdit(): boolean {
    const lock = this.loadedProperty<string>('lock');
    return lock === 'contentLocked' || lock === 'sdtContentLocked';
  }

  set cannotEdit(value: boolean) {
    this.#writeLock(this.cannotDelete, value, `${this.path.label}.cannotEdit`);
  }

  /**
   * Whether the control is showing its prompt rather than a value (`w:showingPlcHdr`).
   *
   * STATE, not text. A control showing its placeholder holds the prompt in its runs, and the
   * first thing written into it replaces the whole prompt — so a caller that treats `text` as a
   * value must ask this before believing it.
   */
  get placeholderShown(): boolean {
    return this.loadedProperty<boolean>('placeholderShown');
  }

  /** Whether the control removes its own wrapper on the first content edit (`w:temporary`). */
  get temporary(): boolean {
    return this.loadedProperty<boolean>('temporary');
  }

  /** The characters the control encloses, as the document reads them. */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /** The paragraphs the control holds. Empty for an inline control, which holds none. */
  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= ParagraphCollection.overListing(
      this.context,
      `${this.path.label}.paragraphs`,
      this.path,
      () => ({ op: 'getContentControlParagraphs', contentControl: this.#handle() })
    );
    return this.#paragraphs;
  }

  /** The controls INSIDE this one, in document order. */
  get contentControls(): ContentControlCollection {
    this.#contentControls ??= ContentControlCollection.of(
      this.context,
      `${this.path.label}.contentControls`,
      this.path,
      { contentControl: this.#handle() }
    );
    return this.#contentControls;
  }

  /**
   * The stretch of the story the control's content covers.
   *
   * Read when it is asked for rather than carried by the control, because the content moves as
   * the document is edited: the range a caller gets is where the control is now.
   */
  getRange(rangeLocation?: 'Whole' | 'Start' | 'End' | 'Before' | 'After' | 'Content'): Range {
    const target = `${this.path.label}.getRange`;
    const location = contentControlRangeLocation(rangeLocation ?? 'Whole', target);
    const held = this.#range.get(location);
    if (held) return held;
    const made = this.#rangeAt(target, location);
    this.#range.set(location, made);
    return made;
  }

  /**
   * Write the control's value.
   *
   * The refusals belong to the document, not to this method: a locked control, a control the file
   * bound to custom XML, and a value the control's type does not accept are all refused by the
   * engine's single write path, which is the same path a keystroke takes.
   */
  setValue(value: ContentControlValue): void {
    const target = `${this.path.label}.setValue`;
    const checked = contentControlValue(value, target);
    const contentControl = this.#handle();
    this.command('setValue', () => ({
      op: 'setContentControlValue',
      contentControl,
      value: checked,
    }));
  }

  /**
   * Put text into the control: over what it holds, or at one end of it.
   *
   * `Replace` goes through the control's own value path, so the prompt it was showing and a
   * `w:temporary` wrapper are dealt with there rather than a second time here. The range comes
   * back from the WRITE and not from a read beside it: reads answer the document as it is when
   * the batch is planned, so a read here would name the text the write was about to replace.
   */
  insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range {
    const target = `${this.path.label}.insertText`;
    const written = insertableText(text, target);
    const at =
      insertLocation === 'Replace'
        ? 'replace'
        : insertLocation === 'Start'
          ? 'start'
          : insertLocation === 'End'
            ? 'end'
            : fail({ code: 'InvalidArgument', target });
    const contentControl = this.#handle();
    const made = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({ op: 'insertContentControlText', contentControl, text: written, at }),
      (value) => {
        made.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return made;
  }

  /**
   * Remove the control.
   *
   * `keepContent` true is Word's own "Remove content control": the wrapper goes and the text it
   * held stays exactly where it was. False takes the content with it.
   */
  delete(keepContent: boolean): void {
    const target = `${this.path.label}.delete`;
    if (typeof keepContent !== 'boolean') fail({ code: 'InvalidArgument', target });
    const contentControl = this.#handle();
    this.command('delete', () => ({ op: 'deleteContentControl', contentControl, keepContent }));
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, [
      'id',
      'tag',
      'title',
      'subtype',
      'text',
      'cannotDelete',
      'cannotEdit',
      'placeholderShown',
      'temporary',
    ]);
    const contentControl = this.#handle();
    if (selected.includes('id')) {
      this.loadTextInto('id', () => ({ op: 'getContentControlFileId', contentControl }));
    }
    if (selected.includes('tag')) {
      this.loadTextInto('tag', () => ({ op: 'getContentControlTag', contentControl }));
    }
    if (selected.includes('title')) {
      this.loadTextInto('title', () => ({ op: 'getContentControlTitle', contentControl }));
    }
    if (selected.includes('subtype')) {
      this.loadTextInto('subtype', () => ({ op: 'getContentControlSubtype', contentControl }));
    }
    if (selected.includes('text')) {
      this.loadTextInto('text', () => ({ op: 'getContentControlText', contentControl }));
    }
    // ONE read behind both flags: `cannotEdit` and `cannotDelete` are the two halves of one
    // `ST_Lock`, so asking for either loads the lock and both are answered from it. Two reads
    // would let a caller load one flag and get a lock the other half disagrees with.
    if (selected.includes('cannotDelete') || selected.includes('cannotEdit')) {
      const label = `${this.path.label}.lock`;
      this.read(
        label,
        () => ({ op: 'getContentControlLock', contentControl }),
        (value) => {
          this.setLoadedProperty('lock', hydratedText(value, label));
        }
      );
    }
    if (selected.includes('placeholderShown')) {
      const label = `${this.path.label}.placeholderShown`;
      this.read(
        label,
        () => ({ op: 'getContentControlPlaceholderShown', contentControl }),
        (value) => {
          this.setLoadedProperty('placeholderShown', hydratedFlag(value, label));
        }
      );
    }
    if (!selected.includes('temporary')) return;
    const label = `${this.path.label}.temporary`;
    this.read(
      label,
      () => ({ op: 'getContentControlTemporary', contentControl }),
      (value) => {
        this.setLoadedProperty('temporary', hydratedFlag(value, label));
      }
    );
  }

  #rangeAt(label: string, location: AutomationContentControlRangeLocation): Range {
    const contentControl = this.#handle();
    const found = Range.promised(this.context, label, false);
    this.read(
      label,
      () => ({ op: 'getContentControlRange', contentControl, location }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, label) });
      }
    );
    return found;
  }

  #writeMetadata(name: string, fields: { readonly tag?: string; readonly title?: string }): void {
    const contentControl = this.#handle();
    this.command(name, () => ({
      op: 'setContentControlProperties',
      contentControl,
      ...fields,
    }));
  }

  /**
   * Write the two flags back as the single `ST_Lock` they are.
   *
   * A caller setting `cannotEdit` alone must not clear `cannotDelete`, so the other half is read
   * from the loaded lock and written with it — which is why both setters go through here.
   */
  #writeLock(cannotDelete: boolean, cannotEdit: boolean, target: string): void {
    if (typeof cannotDelete !== 'boolean' || typeof cannotEdit !== 'boolean') {
      fail({ code: 'InvalidArgument', target });
    }
    const lock: ContentControlLockState =
      cannotDelete && cannotEdit
        ? 'sdtContentLocked'
        : cannotDelete
          ? 'sdtLocked'
          : cannotEdit
            ? 'contentLocked'
            : 'unlocked';
    const contentControl = this.#handle();
    this.command(target, () => ({ op: 'setContentControlProperties', contentControl, lock }));
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

/** Where a collection of controls looks: a story, or inside one control. */
type ContentControlScope =
  | { readonly body: AutomationHandle }
  | { readonly contentControl: AutomationHandle };

export class ContentControlCollection extends HandleCollection<ContentControl> {
  readonly #scope: ContentControlScope;
  readonly #plan: () => AutomationOperation;

  /** @internal The controls of a scope, in document order. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    scope: ContentControlScope
  ): ContentControlCollection {
    return new ContentControlCollection(context, ObjectPath.derived(label, owner), scope, () => ({
      op: 'getContentControls',
      scope,
    }));
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    scope: ContentControlScope,
    plan: () => AutomationOperation
  ) {
    super(context, path);
    this.#scope = scope;
    this.#plan = plan;
  }

  /** The first control. `ItemNotFound` at the sync if the scope holds none. */
  getFirst(): ContentControl {
    return this.edge('first', 'getFirst', false);
  }

  /** The first control, or an object that says `isNullObject` where there is none. */
  getFirstOrNullObject(): ContentControl {
    return this.edge('first', 'getFirstOrNullObject', true);
  }

  /**
   * The first control carrying one `w:id`, or `ItemNotFound` where the scope holds none.
   *
   * FIRST in document order, because `w:id` is not unique. The lookup is one read answered by the
   * host: matching it here would mean asking every control for its id and choosing locally, which
   * is a batch whose size depends on how many controls the document has.
   */
  getById(id: number): ContentControl {
    const target = `${this.path.label}.getById`;
    if (!Number.isInteger(id)) fail({ code: 'InvalidArgument', target });
    const scope = this.#scope;
    const found = ContentControl.promised(this.context, target, false);
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => ({ op: 'getContentControlById', scope, id }),
      settle: (value) => {
        found.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) });
      },
    });
    return found;
  }

  /** Every control in the scope carrying one tag, in document order. */
  getByTag(tag: string): ContentControlCollection {
    const target = `${this.path.label}.getByTag`;
    const wanted = requiredMetadata(tag, target);
    const scope = this.#scope;
    return new ContentControlCollection(
      this.context,
      ObjectPath.derived(target, this.path),
      scope,
      () => ({ op: 'getContentControlsByTag', scope, tag: wanted })
    );
  }

  /** Every control in the scope carrying one title, in document order. */
  getByTitle(title: string): ContentControlCollection {
    const target = `${this.path.label}.getByTitle`;
    const wanted = requiredMetadata(title, target);
    const scope = this.#scope;
    return new ContentControlCollection(
      this.context,
      ObjectPath.derived(target, this.path),
      scope,
      () => ({ op: 'getContentControlsByTitle', scope, title: wanted })
    );
  }

  protected listing(): AutomationOperation {
    return this.#plan();
  }

  protected itemAt(label: string, address: ObjectAddress): ContentControl {
    return ContentControl.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): ContentControl & PromisedItem {
    return ContentControl.promised(this.context, label, nullable);
  }
}

function metadata(value: unknown, target: string): string {
  if (typeof value !== 'string' || value.length > MAX_METADATA) {
    fail({ code: 'InvalidArgument', target });
  }
  return value as string;
}

function requiredMetadata(value: unknown, target: string): string {
  const checked = metadata(value, target);
  if (checked.length === 0) fail({ code: 'InvalidArgument', target });
  return checked;
}

/**
 * Word's range locations, in the protocol's own words.
 *
 * `Whole` and `Content` name the same stretch and `Before`/`After` the content's own edges,
 * because a control's boundary marks take up no offset in the text this API addresses — the same
 * reason `Range#insertText` treats `Before` and `Start` as one place.
 */
function contentControlRangeLocation(
  location: unknown,
  target: string
): AutomationContentControlRangeLocation {
  switch (location) {
    case 'Whole':
      return 'whole';
    case 'Content':
      return 'content';
    case 'Start':
      return 'start';
    case 'End':
      return 'end';
    case 'Before':
      return 'before';
    case 'After':
      return 'after';
    default:
      return fail({ code: 'InvalidArgument', target });
  }
}

/** The value a caller offered, or `InvalidArgument` where it is not one any control accepts. */
function contentControlValue(value: unknown, target: string): ContentControlValue {
  if (typeof value !== 'object' || value === null) fail({ code: 'InvalidArgument', target });
  const offered = value as Record<string, unknown>;
  if (offered.kind === 'text' || offered.kind === 'listItem') {
    const raw = offered.kind === 'text' ? offered.text : offered.value;
    if (typeof raw !== 'string' || raw.length > MAX_METADATA) {
      fail({ code: 'InvalidArgument', target });
    }
    return offered.kind === 'text'
      ? { kind: 'text', text: raw as string }
      : { kind: 'listItem', value: raw as string };
  }
  if (offered.kind === 'checkbox') {
    if (typeof offered.checked !== 'boolean') fail({ code: 'InvalidArgument', target });
    return { kind: 'checkbox', checked: offered.checked as boolean };
  }
  if (offered.kind === 'date') {
    if (typeof offered.iso !== 'string' || offered.iso.length > 64) {
      fail({ code: 'InvalidArgument', target });
    }
    return { kind: 'date', iso: offered.iso as string };
  }
  fail({ code: 'InvalidArgument', target });
}

/** @internal Validate a subtype a caller asked to create. */
export function contentControlSubtype(value: unknown, target: string): ContentControlSubtype {
  if (typeof value !== 'string' || !SUBTYPES.has(value)) fail({ code: 'InvalidArgument', target });
  return value as ContentControlSubtype;
}

/** @internal Validate a lock a caller asked to write. */
export function contentControlLockState(value: unknown, target: string): ContentControlLockState {
  if (typeof value !== 'string' || !LOCKS.has(value)) fail({ code: 'InvalidArgument', target });
  return value as ContentControlLockState;
}
