/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A paragraph's borders: `Paragraph.borders`, a collection of five edges.
//
// THE ORDER IS FIXED: top, left, bottom, right, then the border between paragraphs, whose `inside`
// is true. Office.js gives these items no location of their own, so the order is the only way to
// name an edge, and it follows the `w:pBdr` sequence the file stores them in. The vertical bar
// beside a paragraph (`w:bar`) has no item; every write keeps it as it is.
//
// A BORDER HAS NO IDENTITY OF ITS OWN. Like a font, it is a view onto its paragraph and shares the
// paragraph's path, so a border reached from a deleted paragraph refuses when the paragraph does.
//
// READS ANSWER WHAT THE PAGE SHOWS, through the style cascade: a heading whose rule comes from its
// style reads that rule. Writing back a visibility or color read here changes nothing; a line
// style write resets the width, so write the width back after it.
//
// WRITES JOIN THE PARAGRAPH'S OWN WRITE. Every border and paragraph-format assignment in one sync
// is one operation on the paragraph, because each rewrites the same `w:pPr` and the host refuses a
// second write planned from the tree the first already changed. Border assignments keep their
// order: the host applies them in sequence, where a line style resets the width.
//
// VALUES ARE CHECKED WHEN ASSIGNED, so a bad value throws at the line that set it, naming the
// exact property, instead of failing the whole sync later.

import {
  ObjectPath,
  fail,
  hydratedParagraphBorders,
  type AutomationHandle,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { collectionItemSelection } from './item-collection.ts';
import { ModelObject } from './model-object.ts';
import { BorderLineStyle, ColorIndex, LineWidth } from './border-enums.ts';
import { PageBorderArt } from './page-border-art.ts';

/** The edges, in collection order. */
const EDGES = ['top', 'left', 'bottom', 'right', 'between'] as const;

/** @internal One edge of a paragraph border. */
export type BorderEdge = (typeof EDGES)[number];

/** The properties a border reads. `inside` is read-only. */
const FIELDS = ['color', 'colorIndex', 'inside', 'isVisible', 'lineStyle', 'lineWidth'] as const;
type BorderField = (typeof FIELDS)[number];

/** The properties a border writes, in the order `set()` applies them. */
const WRITABLE = ['isVisible', 'lineStyle', 'lineWidth', 'color', 'colorIndex'] as const;

/** @internal One property a border writes. */
export type BorderWritableField = (typeof WRITABLE)[number];

/** Values each enum-typed property accepts. */
const LINE_STYLES: ReadonlySet<unknown> = new Set(Object.values(BorderLineStyle));
const LINE_WIDTHS: ReadonlySet<unknown> = new Set(Object.values(LineWidth));
const COLOR_INDEXES: ReadonlySet<unknown> = new Set(Object.values(ColorIndex));
/** Palette entries that depend on the reading application or on revision authors. */
const UNSUPPORTED_COLOR_INDEXES: ReadonlySet<unknown> = new Set([
  ColorIndex.classicRed,
  ColorIndex.classicBlue,
  ColorIndex.byAuthor,
]);
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
/** Page-border members a load may name, which a paragraph border does not support. */
const ART_FIELDS: ReadonlySet<string> = new Set(['artStyle', 'artWidth']);

/** Throw `NotSupported` for a load that names an art-border property. */
function refuseArtLoad(names: readonly string[], target: string): void {
  const art = names.find((name) => ART_FIELDS.has(name));
  if (art !== undefined) fail({ code: 'NotSupported', target: `${target}.${art}` });
}

/** Throw unless `value` is one this property accepts. */
function requireBorderValue(field: BorderWritableField, value: unknown, target: string): void {
  let ok: boolean;
  switch (field) {
    case 'isVisible':
      ok = typeof value === 'boolean';
      break;
    case 'lineStyle':
      ok = LINE_STYLES.has(value);
      break;
    case 'lineWidth':
      ok = LINE_WIDTHS.has(value);
      break;
    case 'color':
      ok = typeof value === 'string' && HEX_COLOR.test(value);
      break;
    case 'colorIndex':
      if (UNSUPPORTED_COLOR_INDEXES.has(value)) fail({ code: 'NotSupported', target });
      ok = COLOR_INDEXES.has(value);
      break;
  }
  if (!ok) fail({ code: 'InvalidArgument', target });
}

/** @internal How a border hands an assignment to its paragraph's write. */
export type BorderAuthor = (edge: BorderEdge, field: BorderWritableField, value: unknown) => void;

/**
 * Several border properties at once, for {@link BorderUniversal.set}.
 *
 * @public
 */
export interface BorderUniversalUpdateData {
  artStyle?:
    | PageBorderArt
    | 'Apples'
    | 'ArchedScallops'
    | 'BabyPacifier'
    | 'BabyRattle'
    | 'Balloons3Colors'
    | 'BalloonsHotAir'
    | 'BasicBlackDashes'
    | 'BasicBlackDots'
    | 'BasicBlackSquares'
    | 'BasicThinLines'
    | 'BasicWhiteDashes'
    | 'BasicWhiteDots'
    | 'BasicWhiteSquares'
    | 'BasicWideInline'
    | 'BasicWideMidline'
    | 'BasicWideOutline'
    | 'Bats'
    | 'Birds'
    | 'BirdsFlight'
    | 'Cabins'
    | 'CakeSlice'
    | 'CandyCorn'
    | 'CelticKnotwork'
    | 'CertificateBanner'
    | 'ChainLink'
    | 'ChampagneBottle'
    | 'CheckedBarBlack'
    | 'CheckedBarColor'
    | 'Checkered'
    | 'ChristmasTree'
    | 'CirclesLines'
    | 'CirclesRectangles'
    | 'ClassicalWave'
    | 'Clocks'
    | 'Compass'
    | 'Confetti'
    | 'ConfettiGrays'
    | 'ConfettiOutline'
    | 'ConfettiStreamers'
    | 'ConfettiWhite'
    | 'CornerTriangles'
    | 'CouponCutoutDashes'
    | 'CouponCutoutDots'
    | 'CrazyMaze'
    | 'CreaturesButterfly'
    | 'CreaturesFish'
    | 'CreaturesInsects'
    | 'CreaturesLadyBug'
    | 'CrossStitch'
    | 'Cup'
    | 'DecoArch'
    | 'DecoArchColor'
    | 'DecoBlocks'
    | 'DiamondsGray'
    | 'DoubleD'
    | 'DoubleDiamonds'
    | 'Earth1'
    | 'Earth2'
    | 'EclipsingSquares1'
    | 'EclipsingSquares2'
    | 'EggsBlack'
    | 'Fans'
    | 'Film'
    | 'Firecrackers'
    | 'FlowersBlockPrint'
    | 'FlowersDaisies'
    | 'FlowersModern1'
    | 'FlowersModern2'
    | 'FlowersPansy'
    | 'FlowersRedRose'
    | 'FlowersRoses'
    | 'FlowersTeacup'
    | 'FlowersTiny'
    | 'Gems'
    | 'GingerbreadMan'
    | 'Gradient'
    | 'Handmade1'
    | 'Handmade2'
    | 'HeartBalloon'
    | 'HeartGray'
    | 'Hearts'
    | 'HeebieJeebies'
    | 'Holly'
    | 'HouseFunky'
    | 'Hypnotic'
    | 'IceCreamCones'
    | 'LightBulb'
    | 'Lightning1'
    | 'Lightning2'
    | 'MapPins'
    | 'MapleLeaf'
    | 'MapleMuffins'
    | 'Marquee'
    | 'MarqueeToothed'
    | 'Moons'
    | 'Mosaic'
    | 'MusicNotes'
    | 'Northwest'
    | 'Ovals'
    | 'Packages'
    | 'PalmsBlack'
    | 'PalmsColor'
    | 'PaperClips'
    | 'Papyrus'
    | 'PartyFavor'
    | 'PartyGlass'
    | 'Pencils'
    | 'People'
    | 'PeopleHats'
    | 'PeopleWaving'
    | 'Poinsettias'
    | 'PostageStamp'
    | 'Pumpkin1'
    | 'PushPinNote1'
    | 'PushPinNote2'
    | 'Pyramids'
    | 'PyramidsAbove'
    | 'Quadrants'
    | 'Rings'
    | 'Safari'
    | 'Sawtooth'
    | 'SawtoothGray'
    | 'ScaredCat'
    | 'Seattle'
    | 'ShadowedSquares'
    | 'SharksTeeth'
    | 'ShorebirdTracks'
    | 'Skyrocket'
    | 'SnowflakeFancy'
    | 'Snowflakes'
    | 'Sombrero'
    | 'Southwest'
    | 'Stars'
    | 'Stars3D'
    | 'StarsBlack'
    | 'StarsShadowed'
    | 'StarsTop'
    | 'Sun'
    | 'Swirligig'
    | 'TornPaper'
    | 'TornPaperBlack'
    | 'Trees'
    | 'TriangleParty'
    | 'Triangles'
    | 'Tribal1'
    | 'Tribal2'
    | 'Tribal3'
    | 'Tribal4'
    | 'Tribal5'
    | 'Tribal6'
    | 'TwistedLines1'
    | 'TwistedLines2'
    | 'Vine'
    | 'Waveline'
    | 'WeavingAngles'
    | 'WeavingBraid'
    | 'WeavingRibbon'
    | 'WeavingStrips'
    | 'WhiteFlowers'
    | 'Woodwork'
    | 'XIllusions'
    | 'ZanyTriangles'
    | 'ZigZag'
    | 'ZigZagStitch';
  artWidth?: number;
  color?: string;
  colorIndex?:
    | ColorIndex
    | 'Auto'
    | 'Black'
    | 'Blue'
    | 'BrightGreen'
    | 'ByAuthor'
    | 'ClassicBlue'
    | 'ClassicRed'
    | 'DarkBlue'
    | 'DarkRed'
    | 'DarkYellow'
    | 'Gray25'
    | 'Gray50'
    | 'Green'
    | 'Pink'
    | 'Red'
    | 'Teal'
    | 'Turquoise'
    | 'Violet'
    | 'White'
    | 'Yellow';
  isVisible?: boolean;
  lineStyle?:
    | BorderLineStyle
    | 'DashDot'
    | 'DashDotDot'
    | 'DashDotStroked'
    | 'DashLargeGap'
    | 'DashSmallGap'
    | 'Dot'
    | 'Double'
    | 'DoubleWavy'
    | 'Emboss3D'
    | 'Engrave3D'
    | 'Inset'
    | 'None'
    | 'Outset'
    | 'Single'
    | 'SingleWavy'
    | 'ThickThinLargeGap'
    | 'ThickThinMedGap'
    | 'ThickThinSmallGap'
    | 'ThinThickLargeGap'
    | 'ThinThickMedGap'
    | 'ThinThickSmallGap'
    | 'ThinThickThinLargeGap'
    | 'ThinThickThinMedGap'
    | 'ThinThickThinSmallGap'
    | 'Triple';
  lineWidth?:
    | LineWidth
    | 'Pt025'
    | 'Pt050'
    | 'Pt075'
    | 'Pt100'
    | 'Pt150'
    | 'Pt225'
    | 'Pt300'
    | 'Pt450'
    | 'Pt600';
}

/**
 * Options for {@link BorderUniversal.set}.
 *
 * @public
 */
export interface UpdateOptions {
  /** Whether a read-only property in the data fails the call. Defaults to true. */
  throwOnReadOnly?: boolean;
}

/**
 * The borders of one paragraph: five edges in a fixed order.
 *
 * `items` holds top, left, bottom, right, then the border between paragraphs. Load `items` with
 * the properties you need, such as `items/lineStyle`, and sync before you read them.
 *
 * @public
 */
export class BorderUniversalCollection extends ModelObject {
  readonly #items: readonly BorderUniversal[];
  readonly #paragraph: () => AutomationHandle;

  /** @internal The borders of the paragraph `owner` addresses. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    paragraph: () => AutomationHandle,
    author: BorderAuthor
  ): BorderUniversalCollection {
    return new BorderUniversalCollection(
      context,
      ObjectPath.derived(label, owner),
      paragraph,
      author
    );
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    paragraph: () => AutomationHandle,
    author: BorderAuthor
  ) {
    super(context, path);
    this.#paragraph = paragraph;
    this.#items = EDGES.map((edge, index) =>
      BorderUniversal.of(context, `${path.label}.items[${index}]`, path, edge, paragraph, author)
    );
  }

  /** The five edges: top, left, bottom, right, then the border between paragraphs. */
  get items(): BorderUniversal[] {
    return this.loadedProperty<BorderUniversal[]>('items');
  }

  /** Not supported: paragraph borders are not page borders. Throws `NotSupported`. */
  applyPageBordersToAllSections(): void {
    fail({ code: 'NotSupported', target: `${this.path.label}.applyPageBordersToAllSections` });
  }

  /** @internal Collections accept `items/` paths. */
  protected override get loadsItemPaths(): boolean {
    return true;
  }

  /** @internal One read fills every edge with every property asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const names = collectionItemSelection(request);
    refuseArtLoad(names, `${this.path.label}.items`);
    for (const name of names) {
      if (!FIELDS.includes(name as BorderField))
        fail({ code: 'InvalidArgument', target: `${this.path.label}.items/${name}` });
    }
    const label = `${this.path.label}.items`;
    this.read(
      label,
      () => ({ op: 'getParagraphBorders', paragraph: { paragraph: this.#paragraph() } }),
      (value) => {
        const read = hydratedParagraphBorders(value, label);
        this.#items.forEach((item, index) =>
          item.fill(read[index]!, names as readonly BorderField[])
        );
        this.setLoadedProperty('items', [...this.#items]);
      }
    );
  }
}

/**
 * One edge of a paragraph border.
 *
 * Reads answer the border the page shows, including one a style supplies. `lineStyle` reads
 * `None` for no line, and `null` for a line style no `BorderLineStyle` value names. `lineWidth`,
 * `color`, and `colorIndex` read `null` where no line shows or no value names the stored one;
 * `colorIndex` reads `Auto` for an automatic color.
 *
 * Writes apply in the order you make them. A `lineStyle` write draws the line at `Pt050` and
 * keeps the edge's color and gap, so set `lineWidth` after it. `isVisible = true` draws a single
 * `Pt050` automatic line on an edge with none. A `lineWidth` on an edge with no line has no
 * effect. Values are checked when you assign them: an invalid value throws `InvalidArgument`,
 * and `ClassicRed`, `ClassicBlue`, and `ByAuthor` throw `NotSupported`. Art borders belong to
 * pages: `artStyle` and `artWidth` throw `NotSupported`, also in `load()`.
 *
 * @public
 */
export class BorderUniversal extends ModelObject {
  readonly #edge: BorderEdge;
  readonly #paragraph: () => AutomationHandle;
  readonly #author: BorderAuthor;

  /** @internal One edge of the paragraph `owner` addresses. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    edge: BorderEdge,
    paragraph: () => AutomationHandle,
    author: BorderAuthor
  ): BorderUniversal {
    return new BorderUniversal(context, ObjectPath.derived(label, owner), edge, paragraph, author);
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    edge: BorderEdge,
    paragraph: () => AutomationHandle,
    author: BorderAuthor
  ) {
    super(context, path);
    this.#edge = edge;
    this.#paragraph = paragraph;
    this.#author = author;
  }

  /** Not supported: art borders belong to pages. Throws `NotSupported`. */
  get artStyle(): PageBorderArt {
    return fail({ code: 'NotSupported', target: `${this.path.label}.artStyle` });
  }

  set artStyle(
    _value:
      | PageBorderArt
      | 'Apples'
      | 'ArchedScallops'
      | 'BabyPacifier'
      | 'BabyRattle'
      | 'Balloons3Colors'
      | 'BalloonsHotAir'
      | 'BasicBlackDashes'
      | 'BasicBlackDots'
      | 'BasicBlackSquares'
      | 'BasicThinLines'
      | 'BasicWhiteDashes'
      | 'BasicWhiteDots'
      | 'BasicWhiteSquares'
      | 'BasicWideInline'
      | 'BasicWideMidline'
      | 'BasicWideOutline'
      | 'Bats'
      | 'Birds'
      | 'BirdsFlight'
      | 'Cabins'
      | 'CakeSlice'
      | 'CandyCorn'
      | 'CelticKnotwork'
      | 'CertificateBanner'
      | 'ChainLink'
      | 'ChampagneBottle'
      | 'CheckedBarBlack'
      | 'CheckedBarColor'
      | 'Checkered'
      | 'ChristmasTree'
      | 'CirclesLines'
      | 'CirclesRectangles'
      | 'ClassicalWave'
      | 'Clocks'
      | 'Compass'
      | 'Confetti'
      | 'ConfettiGrays'
      | 'ConfettiOutline'
      | 'ConfettiStreamers'
      | 'ConfettiWhite'
      | 'CornerTriangles'
      | 'CouponCutoutDashes'
      | 'CouponCutoutDots'
      | 'CrazyMaze'
      | 'CreaturesButterfly'
      | 'CreaturesFish'
      | 'CreaturesInsects'
      | 'CreaturesLadyBug'
      | 'CrossStitch'
      | 'Cup'
      | 'DecoArch'
      | 'DecoArchColor'
      | 'DecoBlocks'
      | 'DiamondsGray'
      | 'DoubleD'
      | 'DoubleDiamonds'
      | 'Earth1'
      | 'Earth2'
      | 'EclipsingSquares1'
      | 'EclipsingSquares2'
      | 'EggsBlack'
      | 'Fans'
      | 'Film'
      | 'Firecrackers'
      | 'FlowersBlockPrint'
      | 'FlowersDaisies'
      | 'FlowersModern1'
      | 'FlowersModern2'
      | 'FlowersPansy'
      | 'FlowersRedRose'
      | 'FlowersRoses'
      | 'FlowersTeacup'
      | 'FlowersTiny'
      | 'Gems'
      | 'GingerbreadMan'
      | 'Gradient'
      | 'Handmade1'
      | 'Handmade2'
      | 'HeartBalloon'
      | 'HeartGray'
      | 'Hearts'
      | 'HeebieJeebies'
      | 'Holly'
      | 'HouseFunky'
      | 'Hypnotic'
      | 'IceCreamCones'
      | 'LightBulb'
      | 'Lightning1'
      | 'Lightning2'
      | 'MapPins'
      | 'MapleLeaf'
      | 'MapleMuffins'
      | 'Marquee'
      | 'MarqueeToothed'
      | 'Moons'
      | 'Mosaic'
      | 'MusicNotes'
      | 'Northwest'
      | 'Ovals'
      | 'Packages'
      | 'PalmsBlack'
      | 'PalmsColor'
      | 'PaperClips'
      | 'Papyrus'
      | 'PartyFavor'
      | 'PartyGlass'
      | 'Pencils'
      | 'People'
      | 'PeopleHats'
      | 'PeopleWaving'
      | 'Poinsettias'
      | 'PostageStamp'
      | 'Pumpkin1'
      | 'PushPinNote1'
      | 'PushPinNote2'
      | 'Pyramids'
      | 'PyramidsAbove'
      | 'Quadrants'
      | 'Rings'
      | 'Safari'
      | 'Sawtooth'
      | 'SawtoothGray'
      | 'ScaredCat'
      | 'Seattle'
      | 'ShadowedSquares'
      | 'SharksTeeth'
      | 'ShorebirdTracks'
      | 'Skyrocket'
      | 'SnowflakeFancy'
      | 'Snowflakes'
      | 'Sombrero'
      | 'Southwest'
      | 'Stars'
      | 'Stars3D'
      | 'StarsBlack'
      | 'StarsShadowed'
      | 'StarsTop'
      | 'Sun'
      | 'Swirligig'
      | 'TornPaper'
      | 'TornPaperBlack'
      | 'Trees'
      | 'TriangleParty'
      | 'Triangles'
      | 'Tribal1'
      | 'Tribal2'
      | 'Tribal3'
      | 'Tribal4'
      | 'Tribal5'
      | 'Tribal6'
      | 'TwistedLines1'
      | 'TwistedLines2'
      | 'Vine'
      | 'Waveline'
      | 'WeavingAngles'
      | 'WeavingBraid'
      | 'WeavingRibbon'
      | 'WeavingStrips'
      | 'WhiteFlowers'
      | 'Woodwork'
      | 'XIllusions'
      | 'ZanyTriangles'
      | 'ZigZag'
      | 'ZigZagStitch'
  ) {
    fail({ code: 'NotSupported', target: `${this.path.label}.artStyle` });
  }

  /** Not supported: art borders belong to pages. Throws `NotSupported`. */
  get artWidth(): number {
    return fail({ code: 'NotSupported', target: `${this.path.label}.artWidth` });
  }

  set artWidth(_value: number) {
    fail({ code: 'NotSupported', target: `${this.path.label}.artWidth` });
  }

  /** The line color as `#RRGGBB`, or `null` for no line or an automatic color. */
  get color(): string | null {
    return this.loadedProperty<string | null>('color');
  }

  /**
   * Write `#RRGGBB`; any other value throws `InvalidArgument`. On an edge with no line, the color
   * applies to the next line drawn there in the same sync.
   */
  set color(value: string) {
    this.#assign('color', value, `${this.path.label}.color`);
  }

  /**
   * The palette color, `Auto` for an automatic color, or `null` for no line or a color outside
   * the palette. Writing `ClassicRed`, `ClassicBlue`, or `ByAuthor` throws `NotSupported`.
   */
  get colorIndex():
    | ColorIndex
    | 'Auto'
    | 'Black'
    | 'Blue'
    | 'BrightGreen'
    | 'ByAuthor'
    | 'ClassicBlue'
    | 'ClassicRed'
    | 'DarkBlue'
    | 'DarkRed'
    | 'DarkYellow'
    | 'Gray25'
    | 'Gray50'
    | 'Green'
    | 'Pink'
    | 'Red'
    | 'Teal'
    | 'Turquoise'
    | 'Violet'
    | 'White'
    | 'Yellow'
    | null {
    return this.loadedProperty<ColorIndex | null>('colorIndex');
  }

  set colorIndex(
    value:
      | ColorIndex
      | 'Auto'
      | 'Black'
      | 'Blue'
      | 'BrightGreen'
      | 'ByAuthor'
      | 'ClassicBlue'
      | 'ClassicRed'
      | 'DarkBlue'
      | 'DarkRed'
      | 'DarkYellow'
      | 'Gray25'
      | 'Gray50'
      | 'Green'
      | 'Pink'
      | 'Red'
      | 'Teal'
      | 'Turquoise'
      | 'Violet'
      | 'White'
      | 'Yellow'
  ) {
    this.#assign('colorIndex', value, `${this.path.label}.colorIndex`);
  }

  /** Whether this is the border between paragraphs. Read-only. */
  get inside(): boolean {
    return this.loadedProperty<boolean>('inside');
  }

  /** Whether a line shows on this edge. */
  get isVisible(): boolean {
    return this.loadedProperty<boolean>('isVisible');
  }

  set isVisible(value: boolean) {
    this.#assign('isVisible', value, `${this.path.label}.isVisible`);
  }

  /** The line style, `None` for no line, or `null` for a style no value names. */
  get lineStyle():
    | BorderLineStyle
    | 'DashDot'
    | 'DashDotDot'
    | 'DashDotStroked'
    | 'DashLargeGap'
    | 'DashSmallGap'
    | 'Dot'
    | 'Double'
    | 'DoubleWavy'
    | 'Emboss3D'
    | 'Engrave3D'
    | 'Inset'
    | 'None'
    | 'Outset'
    | 'Single'
    | 'SingleWavy'
    | 'ThickThinLargeGap'
    | 'ThickThinMedGap'
    | 'ThickThinSmallGap'
    | 'ThinThickLargeGap'
    | 'ThinThickMedGap'
    | 'ThinThickSmallGap'
    | 'ThinThickThinLargeGap'
    | 'ThinThickThinMedGap'
    | 'ThinThickThinSmallGap'
    | 'Triple'
    | null {
    return this.loadedProperty<BorderLineStyle | null>('lineStyle');
  }

  set lineStyle(
    value:
      | BorderLineStyle
      | 'DashDot'
      | 'DashDotDot'
      | 'DashDotStroked'
      | 'DashLargeGap'
      | 'DashSmallGap'
      | 'Dot'
      | 'Double'
      | 'DoubleWavy'
      | 'Emboss3D'
      | 'Engrave3D'
      | 'Inset'
      | 'None'
      | 'Outset'
      | 'Single'
      | 'SingleWavy'
      | 'ThickThinLargeGap'
      | 'ThickThinMedGap'
      | 'ThickThinSmallGap'
      | 'ThinThickLargeGap'
      | 'ThinThickMedGap'
      | 'ThinThickSmallGap'
      | 'ThinThickThinLargeGap'
      | 'ThinThickThinMedGap'
      | 'ThinThickThinSmallGap'
      | 'Triple'
  ) {
    this.#assign('lineStyle', value, `${this.path.label}.lineStyle`);
  }

  /** The line width, or `null` for no line or a width no value names. */
  get lineWidth():
    | LineWidth
    | 'Pt025'
    | 'Pt050'
    | 'Pt075'
    | 'Pt100'
    | 'Pt150'
    | 'Pt225'
    | 'Pt300'
    | 'Pt450'
    | 'Pt600'
    | null {
    return this.loadedProperty<LineWidth | null>('lineWidth');
  }

  set lineWidth(
    value:
      | LineWidth
      | 'Pt025'
      | 'Pt050'
      | 'Pt075'
      | 'Pt100'
      | 'Pt150'
      | 'Pt225'
      | 'Pt300'
      | 'Pt450'
      | 'Pt600'
  ) {
    this.#assign('lineWidth', value, `${this.path.label}.lineWidth`);
  }

  /**
   * Set several properties at once, in the order `isVisible`, `lineStyle`, `lineWidth`, `color`,
   * `colorIndex`. A property this object does not write fails with `InvalidArgument`. `inside` is
   * skipped when `options.throwOnReadOnly` is false. `artStyle` and `artWidth` throw
   * `NotSupported`.
   */
  set(properties: BorderUniversalUpdateData, options?: UpdateOptions): void;
  /**
   * Copy the writable properties another border has loaded, in the same order. A loaded `null`
   * is skipped, so a width with no `LineWidth` member is not copied and the line style write
   * leaves `Pt050`.
   */
  set(properties: BorderUniversal): void;
  set(properties: BorderUniversalUpdateData | BorderUniversal, options?: UpdateOptions): void {
    const target = `${this.path.label}.set`;
    if (properties instanceof BorderUniversal) {
      for (const field of WRITABLE) {
        const value = properties.#loadedOrUndefined(field);
        if (value !== undefined && value !== null) this.#assign(field, value, `${target}.${field}`);
      }
      return;
    }
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties))
      fail({ code: 'InvalidArgument', target });
    const data = properties as Record<string, unknown>;
    for (const name of Object.keys(data)) {
      if (name === 'inside' && options?.throwOnReadOnly === false) continue;
      if (name === 'artStyle' || name === 'artWidth')
        fail({ code: 'NotSupported', target: `${target}.${name}` });
      if (!WRITABLE.includes(name as BorderWritableField))
        fail({ code: 'InvalidArgument', target: `${target}.${name}` });
    }
    for (const field of WRITABLE) {
      if (data[field] !== undefined) this.#assign(field, data[field], `${target}.${field}`);
    }
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    refuseArtLoad(request.select, this.path.label);
    const selected = this.selection(request, FIELDS) as readonly BorderField[];
    if (selected.length === 0) return;
    const label = `${this.path.label}.border`;
    const index = EDGES.indexOf(this.#edge);
    this.read(
      label,
      () => ({ op: 'getParagraphBorders', paragraph: { paragraph: this.#paragraph() } }),
      (value) => {
        this.fill(hydratedParagraphBorders(value, label)[index]!, selected);
      }
    );
  }

  /** @internal Record the values one read answered for this edge. */
  fill(read: object, fields: readonly BorderField[]): void {
    const values = read as Readonly<Record<BorderField, unknown>>;
    for (const field of fields) this.setLoadedProperty(field, values[field]);
  }

  #loadedOrUndefined(field: BorderWritableField): unknown {
    return this.hasLoadedProperty(field) ? this.loadedProperty<unknown>(field) : undefined;
  }

  #assign(field: BorderWritableField, value: unknown, target: string): void {
    this.requireUsablePath();
    requireBorderValue(field, value, target);
    this.#author(this.#edge, field, value);
  }
}
