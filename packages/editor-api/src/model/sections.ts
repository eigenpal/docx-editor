/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Sections, and the page a section is laid out on.
//
// A SECTION IS THE DOCUMENT'S LAYOUT, NOT ITS CONTENT. Everything a caller usually wants from one —
// paper size, margins, orientation — is `w:sectPr`, so `pageSetup` is where the properties live and
// the section itself is mostly navigation: the story it governs, the header and footer stories it
// declares, and the section after it.
//
// `getHeader`/`getFooter` ANSWER A BODY THAT MAY NOT EXIST YET, AND SAY SO. A section with no
// first-page header inherits the previous section's; a section at the start of a document with none
// at all has nothing to answer, and the read is refused (`ItemNotFound`) rather than minting the
// part. Word creates the header when a script asks for it; doing that here would make a READ write
// to the document, and a header that exists only because it was asked about is a header the author
// never added. The divergence is recorded in `compat/manifest.json`.

import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedHandle,
  hydratedHandles,
  hydratedPageSetup,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { Body } from './body.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { ModelObject } from './model-object.ts';

/**
 * Which way round a page is, in Word's own spelling.
 *
 * Capitalised here and lower-case in the engine on purpose: the engine speaks OOXML's vocabulary,
 * and this is the public API's. The mapping lives in this file and nowhere else.
 */
export type PageOrientation = 'Portrait' | 'Landscape';

/** Which header or footer of a section: Word's own three variants. */
export type HeaderFooterType = 'Primary' | 'FirstPage' | 'EvenPages';

const VARIANTS: Readonly<Record<HeaderFooterType, 'default' | 'first' | 'even'>> = Object.freeze({
  Primary: 'default',
  FirstPage: 'first',
  EvenPages: 'even',
});

/** Every page property this model reads and writes. Order is the order a load answers them in. */
const PAGE_FIELDS = [
  'pageWidth',
  'pageHeight',
  'orientation',
  'topMargin',
  'rightMargin',
  'bottomMargin',
  'leftMargin',
] as const;

type PageField = (typeof PAGE_FIELDS)[number];

export class PageSetup extends ModelObject {
  #pending: Record<string, unknown> | undefined;

  /** @internal The page geometry of the section `owner` addresses. */
  static of(context: RequestContext, label: string, owner: ObjectPath): PageSetup {
    return new PageSetup(context, ObjectPath.derived(label, owner));
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }

  /** Points. */
  get pageWidth(): number {
    return this.loadedProperty<number>('pageWidth');
  }

  set pageWidth(value: number) {
    this.#author('pageWidth', requirePoints(value, `${this.path.label}.pageWidth`));
  }

  /** Points. */
  get pageHeight(): number {
    return this.loadedProperty<number>('pageHeight');
  }

  set pageHeight(value: number) {
    this.#author('pageHeight', requirePoints(value, `${this.path.label}.pageHeight`));
  }

  /**
   * Which way round the page is.
   *
   * Writing it alone SWAPS this section's own dimensions rather than assuming a paper size, so a
   * document of mixed sizes survives a flip with its sizes intact.
   */
  get orientation(): PageOrientation {
    return this.loadedProperty<PageOrientation>('orientation');
  }

  set orientation(value: PageOrientation) {
    const target = `${this.path.label}.orientation`;
    if (value !== 'Portrait' && value !== 'Landscape') fail({ code: 'InvalidArgument', target });
    this.#author('orientation', value === 'Portrait' ? 'portrait' : 'landscape');
  }

  /** Points. */
  get topMargin(): number {
    return this.loadedProperty<number>('topMargin');
  }

  set topMargin(value: number) {
    this.#author('topMargin', requirePoints(value, `${this.path.label}.topMargin`));
  }

  /** Points. */
  get bottomMargin(): number {
    return this.loadedProperty<number>('bottomMargin');
  }

  set bottomMargin(value: number) {
    this.#author('bottomMargin', requirePoints(value, `${this.path.label}.bottomMargin`));
  }

  /** Points. */
  get leftMargin(): number {
    return this.loadedProperty<number>('leftMargin');
  }

  set leftMargin(value: number) {
    this.#author('leftMargin', requirePoints(value, `${this.path.label}.leftMargin`));
  }

  /** Points. */
  get rightMargin(): number {
    return this.loadedProperty<number>('rightMargin');
  }

  set rightMargin(value: number) {
    this.#author('rightMargin', requirePoints(value, `${this.path.label}.rightMargin`));
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, PAGE_FIELDS);
    if (selected.length === 0) return;
    const label = `${this.path.label}.pageSetup`;
    const section = this.#section();
    this.read(
      label,
      () => ({ op: 'getPageSetup', section }),
      (value) => {
        const setup = hydratedPageSetup(value, label);
        for (const field of selected as readonly PageField[]) {
          this.setLoadedProperty(
            field,
            field === 'orientation'
              ? setup.orientation === 'landscape'
                ? 'Landscape'
                : 'Portrait'
              : setup[field]
          );
        }
      }
    );
  }

  /**
   * Accumulate page-property assignments into ONE write per sync.
   *
   * Same reason as `Font` and the paragraph properties: a `w:sectPr` write carries the fields it
   * is asked for and the host refuses a second one against the same section in one batch, because
   * the second would have been planned from the section the first already changed.
   */
  #author(field: PageField, value: unknown): void {
    this.requireAddressable();
    if (this.#pending) {
      this.#pending[field] = value;
      return;
    }
    const pending: Record<string, unknown> = { [field]: value };
    this.#pending = pending;
    const section = this.#section();
    const label = `${this.path.label}.${field}`;
    this.commandAnswering(
      `${this.path.label}.pageSetup`,
      () => {
        this.#pending = undefined;
        return { op: 'setPageSetup', section, setup: pending };
      },
      (answer) => {
        hydratedApplied(answer, label);
      }
    );
  }

  #section(): AutomationHandle {
    this.requireAddressable();
    const address = this.path.address();
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: this.path.label });
    return address.handle;
  }
}

export class Section extends ModelObject implements PromisedItem {
  #pageSetup: PageSetup | undefined;
  #body: Body | undefined;

  /** @internal A section a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Section {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Section(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A section a queued read will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Section {
    return new Section(context, ObjectPath.pending(label), nullable);
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
   * The story this section governs.
   *
   * The MAIN story, which every section of a document shares: sections divide a body's layout, not
   * its text, so this is the same story `document.body` names rather than a slice of it.
   */
  get body(): Body {
    this.#body ??= Body.main(this.context, `${this.path.label}.body`);
    return this.#body;
  }

  /** The page this section is laid out on. */
  get pageSetup(): PageSetup {
    this.#pageSetup ??= PageSetup.of(this.context, `${this.path.label}.pageSetup`, this.path);
    return this.#pageSetup;
  }

  /** The header story of one variant, as a body. `ItemNotFound` where the document has none. */
  getHeader(type: HeaderFooterType): Body {
    return this.#furniture('header', type, 'getHeader');
  }

  /** The footer story of one variant, as a body. `ItemNotFound` where the document has none. */
  getFooter(type: HeaderFooterType): Body {
    return this.#furniture('footer', type, 'getFooter');
  }

  /** The next section. `ItemNotFound` at the sync when this is the last one. */
  getNext(): Section {
    const target = `${this.path.label}.getNext`;
    const own = this.#handle();
    const next = Section.promised(this.context, target, false);
    const document = this.internals.roots().document;
    this.read(
      target,
      () => ({ op: 'getSections', document }),
      (value) => {
        const sections = hydratedHandles(value, target);
        const at = sections.findIndex((handle) => handle.ref === own.ref);
        const after = at < 0 ? undefined : sections[at + 1];
        if (!after) fail({ code: 'ItemNotFound', target });
        next.hydrateAddress({ kind: 'handle', handle: after });
      }
    );
    return next;
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    // A section has no readable property of its own here: everything about it is its page setup,
    // and naming a property it does not have is refused rather than ignored.
    this.selection(request, []);
  }

  #furniture(kind: 'header' | 'footer', type: HeaderFooterType, accessor: string): Body {
    const target = `${this.path.label}.${accessor}`;
    const variant = VARIANTS[type];
    if (variant === undefined) fail({ code: 'InvalidArgument', target });
    const section = this.#handle();
    const story = Body.promisedStory(this.context, target);
    // THIS object queues the read, because a pending one cannot address the document yet — and it is
    // the section that knows which furniture is being asked for.
    this.read(
      target,
      () => ({ op: 'getFurniture', section, kind, variant }),
      (value) => {
        story.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) });
      }
    );
    return story;
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

export class SectionCollection extends HandleCollection<Section> {
  readonly #plan: () => AutomationOperation;

  /** @internal The document's sections, in document order. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): SectionCollection {
    return new SectionCollection(context, ObjectPath.derived(label, owner), plan);
  }

  private constructor(context: RequestContext, path: ObjectPath, plan: () => AutomationOperation) {
    super(context, path);
    this.#plan = plan;
  }

  /** The first section. `ItemNotFound` at the sync if the document has none. */
  getFirst(): Section {
    return this.edge('first', 'getFirst', false);
  }

  protected listing(): AutomationOperation {
    return this.#plan();
  }

  protected itemAt(label: string, address: ObjectAddress): Section {
    return Section.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): Section & PromisedItem {
    return Section.promised(this.context, label, nullable);
  }
}

function requirePoints(value: unknown, target: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail({ code: 'InvalidArgument', target });
  }
  return value;
}
