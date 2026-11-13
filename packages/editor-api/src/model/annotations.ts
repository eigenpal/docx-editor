/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Proofing annotations, as the Office.js object model shapes them: `Annotation`,
// `CritiqueAnnotation`, and `AnnotationCollection`, plus the paragraph and document members
// that create and find them.
//
// THE RUNTIME HOLDS THEM, NOT THE DOCUMENT. Every annotation lives in the runtime's
// `AnnotationStore`, keyed by the paragraph handle. A read here first reads the paragraph's
// current text from the host, so the store can follow an edit made since, then answers from the
// store. That read never refuses for a paragraph an edit removed: the paragraph's annotations
// are simply gone.
//
// A DEPENDENT READ IS A GATE. `accept()` must see the paragraph's current text before it can
// say which model offsets to edit, and the edit must still be refused before anything commits
// if the annotation is gone. So the text read resolves a private path, and the edit depends on
// it: the sync sends the read first, at the revision the edit is then pinned to.

import {
  ObjectPath,
  fail,
  hydratedSpan,
  internalsOf,
  type AutomationHandle,
  type AutomationOperation,
  type AutomationSpan,
  type AutomationValue,
  type QueuedAction,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import type { AnnotationRecord, AnnotationStore } from '../runtime/annotation-store.ts';
import { MAX_LIVE_ANNOTATIONS } from '../runtime/annotation-store.ts';
import { clientResult, type ClientResult } from '../runtime/client-result.ts';
import {
  acceptEdit,
  critiqueOf,
  critiqueRecords,
  type AnnotationState,
  type AnnotationSet,
  type Critique,
} from './annotation-input.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';

const ANNOTATION_PROPERTIES = ['id', 'state', 'critiqueAnnotation'] as const;
const PARAGRAPH_MARK = /[\r\n\v\f\u2028\u2029]/;

/** The store behind a context, or the refusal a preview gives. */
function storeOf(context: RequestContext, target: string): AnnotationStore {
  const store = internalsOf(context).annotations;
  if (!store) fail({ code: 'NotSupported', target, diagnostic: 'edit.preview-unsupported' });
  return store;
}

/** The paragraph text a `getParagraphTextIfPresent` read answered, or `null` for none. */
function presentText(value: AutomationValue, target: string): string | null {
  if (value.kind !== 'texts') fail({ code: 'GeneralException', target });
  return value.texts[0] ?? null;
}

/** The refusal for an annotation the document no longer holds. */
function gone(target: string): never {
  fail({ code: 'InvalidObjectPath', target, diagnostic: 'edit.stale-target' });
}

/**
 * Queue a read of `paragraph`'s current text that brings the store up to it, and answer the
 * gate it resolves. `onText` sees the text, or `null` when the paragraph is gone.
 */
function readParagraph(
  enqueue: (action: QueuedAction) => void,
  store: AnnotationStore,
  label: string,
  paragraph: () => AutomationHandle,
  onText?: (text: string | null) => void
): ObjectPath {
  const gate = ObjectPath.pending(`${label}#text`);
  let read: AutomationHandle | undefined;
  enqueue({
    sort: 'read',
    label,
    plan: () => {
      read = paragraph();
      return { op: 'getParagraphTextIfPresent', paragraph: read, projection: store.view };
    },
    settle: (value) => {
      const handle = read!;
      const text = presentText(value, label);
      store.reconcile(handle, text);
      onText?.(text);
      gate.resolveTo(handle);
    },
  });
  return gate;
}

// The store's records stay out of the published declarations: the classes keep their record
// members private and hand this module these accessors from their static blocks.
let recordOf: (annotation: Annotation, target: string) => AnnotationRecord;
let refreshOf: (
  annotation: Annotation,
  label: string,
  onRecord?: (record: AnnotationRecord) => void
) => ObjectPath;
let fillAnnotation: (
  annotation: Annotation,
  record: AnnotationRecord,
  names: readonly string[]
) => void;
let fillCritique: (critique: CritiqueAnnotation, record: AnnotationRecord) => void;

/**
 * One proofing annotation on a paragraph. Load `id`, `state`, and `critiqueAnnotation`
 * before you read them.
 *
 * Annotations are view state: they are not saved in the document, not shared with
 * collaborators, and gone when the runtime is disposed.
 *
 * @public
 */
export class Annotation extends ModelObject {
  #id: string | undefined;
  #critique: CritiqueAnnotation | undefined;

  static {
    recordOf = (annotation, target) => annotation.#record(target);
    refreshOf = (annotation, label, onRecord) => annotation.#refresh(label, onRecord);
    fillAnnotation = (annotation, record, names) => annotation.#fill(record, names);
  }

  /** @internal An annotation a read has already named. */
  static at(
    context: RequestContext,
    label: string,
    paragraph: AutomationHandle,
    id: string
  ): Annotation {
    return new Annotation(context, ObjectPath.of(label, paragraph), id);
  }

  /** @internal An annotation a queued read will name. */
  static promised(
    context: RequestContext,
    label: string,
    nullable: boolean,
    id?: string
  ): Annotation {
    return new Annotation(context, ObjectPath.pending(label), id, nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, id?: string, nullable = false) {
    super(context, path, { nullable });
    this.#id = id;
  }

  /** @internal Bind this proxy to the annotation a read found. */
  hydrate(paragraph: AutomationHandle, id: string): void {
    this.#id = id;
    this.path.resolveTo(paragraph);
  }

  /** @internal There was no such annotation. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** The record, or the refusal for one the document no longer holds. */
  #record(target: string): AnnotationRecord {
    const record =
      this.#id === undefined ? undefined : storeOf(this.context, target).record(this.#id);
    if (!record) gone(target);
    return record;
  }

  /** Queue the text read that brings this annotation up to date; answers its gate. */
  #refresh(label: string, onRecord?: (record: AnnotationRecord) => void): ObjectPath {
    const store = storeOf(this.context, label);
    return readParagraph(
      (action) => this.enqueue(action),
      store,
      label,
      () => this.#record(label).paragraph,
      () => onRecord?.(this.#record(label))
    );
  }

  /** The annotation's id, unique in this runtime. Pass it to `document.getAnnotationById`. */
  get id(): string {
    return this.loadedProperty<string>('id');
  }

  /** `Created` while the annotation is on its paragraph; `Accepted` or `Rejected` once decided. */
  get state(): AnnotationState | 'Created' | 'Accepted' | 'Rejected' {
    return this.loadedProperty<AnnotationState | 'Created' | 'Accepted' | 'Rejected'>('state');
  }

  /** The critique this annotation shows, and the range it marks. */
  get critiqueAnnotation(): CritiqueAnnotation {
    this.#critique ??= CritiqueAnnotation.of(
      this.context,
      ObjectPath.derived(`${this.path.label}.critiqueAnnotation`, this.path),
      this
    );
    return this.#critique;
  }

  /**
   * Remove the annotation from its paragraph and forget it. The document does not change. A
   * later read of this annotation refuses with `InvalidObjectPath`.
   */
  delete(): void {
    const target = `${this.path.label}.delete`;
    const gate = this.#refresh(target);
    const store = storeOf(this.context, target);
    this.enqueue({
      sort: 'read',
      label: target,
      dependencies: [gate],
      plan: () => this.#check(target),
      settle: () => store.delete(this.#record(target).id),
    });
  }

  /** @internal Refuse unless the annotation is still on its paragraph; answers a harmless read. */
  #check(target: string): AutomationOperation {
    const record = this.#record(target);
    if (!record.live) gone(target);
    return {
      op: 'getParagraphTextIfPresent',
      paragraph: record.paragraph,
      projection: storeOf(this.context, target).view,
    };
  }

  /** Fill the loaded properties a load asked for, from the store. */
  #fill(record: AnnotationRecord, names: readonly string[]): void {
    if (names.includes('id')) this.setLoadedProperty('id', record.id);
    if (names.includes('state')) this.setLoadedProperty('state', record.state);
    if (names.includes('critiqueAnnotation')) fillCritique(this.critiqueAnnotation, record);
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const names = this.selection(request, ANNOTATION_PROPERTIES);
    const label = `${this.path.label}.load`;
    this.#refresh(label, (record) => this.#fill(record, names));
  }
}

/**
 * The critique an annotation shows: its data, the range it marks, and the decisions on it.
 *
 * @public
 */
export class CritiqueAnnotation extends ModelObject {
  readonly #annotation: Annotation;

  static {
    fillCritique = (critique, record) => critique.#fill(record);
  }
  #range: Range | undefined;

  /** @internal The critique of `annotation`, addressed through its path. */
  static of(context: RequestContext, path: ObjectPath, annotation: Annotation): CritiqueAnnotation {
    return new CritiqueAnnotation(context, path, annotation);
  }

  private constructor(context: RequestContext, path: ObjectPath, annotation: Annotation) {
    super(context, path);
    this.#annotation = annotation;
  }

  /**
   * The critique: its color, its current `start` in the paragraph's text, its `length`, and
   * its suggestions. `start` moves when an edit before the critique changes the paragraph.
   */
  get critique(): Critique {
    return this.loadedProperty<Critique>('critique');
  }

  /**
   * The text the critique marks. Load its properties and sync before you read them. The range
   * refuses with `InvalidObjectPath` if the annotation is gone.
   */
  get range(): Range {
    if (this.#range) return this.#range;
    const target = `${this.path.label}.range`;
    const range = Range.promised(this.context, target, false);
    this.#range = range;
    const gate = refreshOf(this.#annotation, target);
    const store = storeOf(this.context, target);
    this.enqueue({
      sort: 'read',
      label: target,
      dependencies: [gate],
      plan: () => {
        const record = recordOf(this.#annotation, target);
        if (!record.live) gone(target);
        return {
          op: 'getParagraphTextSpan',
          paragraph: record.paragraph,
          start: record.start,
          length: record.text.length,
          projection: store.view,
        };
      },
      settle: (value) => range.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) }),
    });
    return range;
  }

  /**
   * Replace the critiqued text with the first suggestion, then set the state to `Accepted` and
   * remove the mark.
   *
   * The edit changes only the characters that differ, and it is a tracked change when
   * `document.changeTrackingMode` tracks. Refusals, after which nothing changes:
   *
   * - `NotSupported` with `edit.operation-unsupported` when the critique has no suggestion.
   * - `NotSupported` with `edit.indivisible-content` when the critiqued text holds an object,
   *   such as a field result or a picture, or text the revision view hides.
   * - `InvalidArgument` when the suggestion holds a paragraph mark or U+FFFC.
   * - `InvalidObjectPath` with `edit.stale-target` when an edit changed the critiqued text, or
   *   the annotation was decided or deleted.
   */
  accept(): void {
    const target = `${this.path.label}.accept`;
    const store = storeOf(this.context, target);
    let modelText: string | null = null;
    let found: { span: AutomationSpan; record: AnnotationRecord } | undefined;
    const gate = refreshOf(this.#annotation, target);
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => ({
        op: 'getParagraphTextIfPresent',
        paragraph: recordOf(this.#annotation, target).paragraph,
        projection: 'model',
      }),
      settle: (value) => {
        modelText = presentText(value, target);
      },
    });
    const mapped = ObjectPath.pending(`${target}#span`);
    this.enqueue({
      sort: 'read',
      label: target,
      dependencies: [gate],
      plan: () => {
        const record = recordOf(this.#annotation, target);
        if (!record.live) gone(target);
        return {
          op: 'getParagraphTextSpan',
          paragraph: record.paragraph,
          start: record.start,
          length: record.text.length,
          projection: store.view,
        };
      },
      settle: (value) => {
        const record = recordOf(this.#annotation, target);
        found = { span: hydratedSpan(value, target), record };
        mapped.resolveTo(record.paragraph);
      },
    });
    this.enqueue({
      sort: 'write',
      label: target,
      dependencies: [mapped],
      plan: () => {
        if (!found || !found.record.live) gone(target);
        const { span, record } = found;
        const suggestion = record.critique.suggestions?.[0];
        if (suggestion === undefined)
          fail({ code: 'NotSupported', target, diagnostic: 'edit.operation-unsupported' });
        if (PARAGRAPH_MARK.test(suggestion) || suggestion.includes('\uFFFC'))
          fail({ code: 'InvalidArgument', target, diagnostic: 'edit.invalid-argument' });
        const plain =
          span.start.paragraph.ref === span.end.paragraph.ref &&
          modelText !== null &&
          modelText.slice(span.start.offset, span.end.offset) === record.text;
        if (!plain) fail({ code: 'NotSupported', target, diagnostic: 'edit.indivisible-content' });
        return (
          acceptEdit(span, record.text, suggestion) ?? {
            op: 'getParagraphTextIfPresent',
            paragraph: record.paragraph,
          }
        );
      },
      settle: () => {
        if (found) store.decide(found.record.id, 'Accepted');
      },
    });
  }

  /** Set the state to `Rejected` and remove the mark. The document does not change. */
  reject(): void {
    const target = `${this.path.label}.reject`;
    const store = storeOf(this.context, target);
    const gate = refreshOf(this.#annotation, target);
    this.enqueue({
      sort: 'read',
      label: target,
      dependencies: [gate],
      plan: () => {
        const record = recordOf(this.#annotation, target);
        if (!record.live) gone(target);
        return {
          op: 'getParagraphTextIfPresent',
          paragraph: record.paragraph,
          projection: store.view,
        };
      },
      settle: () => store.decide(recordOf(this.#annotation, target).id, 'Rejected'),
    });
  }

  /** Fill `critique` from the store. */
  #fill(record: AnnotationRecord): void {
    this.setLoadedProperty('critique', critiqueOf(record));
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    this.selection(request, ['critique']);
    refreshOf(this.#annotation, `${this.path.label}.load`, (record) => this.#fill(record));
  }
}

/**
 * The annotations on one paragraph, in text order. Load it, then read `items`.
 *
 * @public
 */
export class AnnotationCollection extends ModelObject {
  readonly #paragraph: () => AutomationHandle;

  /** @internal The annotations of the paragraph at `owner`. */
  static of(context: RequestContext, label: string, owner: ObjectPath): AnnotationCollection {
    return new AnnotationCollection(context, ObjectPath.derived(label, owner));
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
    this.#paragraph = () => this.path.handle();
  }

  /** The annotations this collection was loaded with. */
  get items(): Annotation[] {
    return this.loadedProperty<Annotation[]>('items');
  }

  /** The first annotation. `ItemNotFound` at the sync if the paragraph has none. */
  getFirst(): Annotation {
    return this.#edge('getFirst', false);
  }

  /** The first annotation, or a null object if the paragraph has none. */
  getFirstOrNullObject(): Annotation {
    return this.#edge('getFirstOrNullObject', true);
  }

  #edge(accessor: string, nullable: boolean): Annotation {
    const target = `${this.path.label}.${accessor}()`;
    const item = Annotation.promised(this.context, target, nullable);
    this.#list(target, (records) => {
      const first = records[0];
      if (first) item.hydrate(first.paragraph, first.id);
      else if (nullable) item.hydrateNull();
      else fail({ code: 'ItemNotFound', target });
    });
    return item;
  }

  #list(label: string, use: (records: readonly AnnotationRecord[]) => void): void {
    const store = storeOf(this.context, label);
    readParagraph(
      (action) => this.enqueue(action),
      store,
      label,
      this.#paragraph,
      (text) => {
        if (text === null) gone(label);
        use(store.liveIn(this.#paragraph()));
      }
    );
  }

  /** @internal Collections accept `items/<property>` paths. */
  protected override get loadsItemPaths(): boolean {
    return true;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const names = [
      ...new Set([...request.select.filter((name) => name !== 'items'), ...request.itemSelect]),
    ];
    for (const name of names) {
      if (!(ANNOTATION_PROPERTIES as readonly string[]).includes(name))
        fail({ code: 'InvalidArgument', target: `${this.path.label}.items/${name}` });
    }
    const label = `${this.path.label}.items`;
    const skip = request.skip ?? 0;
    this.#list(label, (records) => {
      const end =
        request.top === undefined ? records.length : Math.min(records.length, skip + request.top);
      const items = records.slice(skip, end).map((record, index) => {
        const item = Annotation.at(
          this.context,
          `${label}[${String(skip + index)}]`,
          record.paragraph,
          record.id
        );
        fillAnnotation(item, record, names);
        return item;
      });
      this.setLoadedProperty('items', items);
    });
  }
}

/**
 * Place critiques on a paragraph. Answers the new annotation ids in critique order.
 *
 * @internal Called by `Paragraph.insertAnnotations`.
 */
export function insertAnnotations(
  context: RequestContext,
  enqueue: (action: QueuedAction) => void,
  label: string,
  paragraph: () => AutomationHandle,
  set: AnnotationSet
): ClientResult<string[]> {
  const critiques = critiqueRecords(set, label);
  const store = storeOf(context, label);
  const { result, fill } = clientResult<string[]>(label);
  let current: string | null = null;
  const gate = readParagraph(enqueue, store, label, paragraph, (text) => {
    current = text;
  });
  enqueue({
    sort: 'read',
    label,
    dependencies: [gate],
    plan: () => {
      const text = current;
      if (text === null) gone(label);
      critiques.forEach((critique, index) => {
        if (critique.start + critique.length > text.length)
          fail({ code: 'InvalidArgument', target: `${label}.critiques[${String(index)}]` });
      });
      if (store.liveCount + critiques.length > MAX_LIVE_ANNOTATIONS)
        fail({ code: 'NotSupported', target: label, diagnostic: 'edit.resource-limit' });
      return { op: 'getParagraphTextIfPresent', paragraph: paragraph(), projection: store.view };
    },
    settle: (value) => {
      const text = presentText(value, label);
      if (text === null) gone(label);
      fill(store.add(paragraph(), text, critiques));
    },
  });
  return result;
}

/**
 * The annotation with an id, decided or not. `ItemNotFound` at the sync when this runtime has
 * no annotation with the id, including one that was deleted or that an edit removed.
 *
 * @internal Called by `Document.getAnnotationById`.
 */
export function annotationById(
  context: RequestContext,
  enqueue: (action: QueuedAction) => void,
  label: string,
  id: string
): Annotation {
  if (typeof id !== 'string') fail({ code: 'InvalidArgument', target: label });
  const store = storeOf(context, label);
  const found = Annotation.promised(context, label, false, id);
  const paragraphOf = (): AutomationHandle => {
    const record = store.record(id);
    if (!record) fail({ code: 'ItemNotFound', target: label });
    return record.paragraph;
  };
  readParagraph(enqueue, store, label, paragraphOf, () => {
    const record = store.record(id);
    if (!record) fail({ code: 'ItemNotFound', target: label });
    found.hydrate(record.paragraph, id);
  });
  return found;
}
