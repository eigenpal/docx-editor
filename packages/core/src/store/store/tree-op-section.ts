// Section and list property ops (tree-ops seam).
//
// `w:sectPr` and `w:numPr` are the two `w:pPr` children that carry their meaning in
// CHILDREN rather than attributes, so neither can be expressed through the flat
// `setParagraphProperties` path. They get their own appliers, and those are bulky enough
// — section inheritance, the `CT_SectPr` child order, list levels — to own a module.
// Pure, like the rest of op application.

import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  bodyNodeOf,
  metricsOfSection,
  plannedSectionDimensions,
  sectionAttribute,
  sectionChild,
  targetSectionNodes,
} from './tree-op-section-address.ts';
import type {
  OoxmlProperty,
  RevisionAttributionInput,
  TabStopWrite,
  TreeDocOp,
  TreeOpEffect,
  TreeOpResult,
} from './tree-op-types.ts';
import { withPropertyChangeRecord } from './tree-op-tracked-properties.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import {
  TEXT_DEPS,
  attributeValueOf,
  cloneWithNewIds,
  fromEdit,
  namedChild,
  ok,
  paragraphPropertiesNodeOf,
} from './tree-op-nodes.ts';
import {
  CT_PPR_SEQUENCE,
  RUN_VOCABULARY,
  mergedPropertyChildren,
  schemaInsertIndex,
} from './tree-op-properties.ts';

/**
 * A `w:pPr` without its `w:sectPr`, keeping identity when there is none. `undefined`
 * when the section mark was its only content — an empty `w:pPr` serializes markup a
 * paragraph that never had one does not.
 */
export function withoutSectionMark(pPr: OoxmlNode): OoxmlNode | undefined {
  if (pPr.kind === 'textValue') return undefined;
  const children = pPr.children.filter(
    (child) => !('localName' in child) || child.localName !== 'sectPr'
  );
  if (children.length === pPr.children.length) return pPr;
  if (children.length === 0) return undefined;
  return { ...pPr, children } as OoxmlNode;
}

type SetSectionPropertiesOp = Extract<TreeDocOp, { op: 'setSectionProperties' }>;

function wmlAttribute(localName: string, value: string) {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

function sectionElement(
  id: string,
  localName: string,
  attributes: readonly unknown[],
  children: readonly OoxmlNode[]
): OoxmlNode {
  return {
    id,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as unknown as OoxmlNode;
}

const attributesOf = (node: OoxmlNode | null): readonly { localName: string; value: string }[] =>
  node && node.kind !== 'textValue' && 'attributes' in node
    ? (node.attributes as readonly { localName: string; value: string }[])
    : [];

const childrenOf = (node: OoxmlNode | null): readonly OoxmlNode[] =>
  node && node.kind !== 'textValue' ? (node.children ?? []) : [];

/**
 * Merge the op's fields into its TARGET sections — every `w:sectPr` in the part
 * (Word's "Apply to: Whole document", the default), or only the section governing
 * `anchorParagraphId` ("Apply to: This section"). A body-level section is minted when
 * the write must reach the implicit tail section.
 *
 * ONE tree rebuild whatever the section count: the replacements are collected first and
 * applied in a single structural-sharing map over the root, because a per-section
 * rebuild copied the body's entire child list once per section — quadratic in a
 * file-controlled count, which a hostile many-section document turns into a freeze.
 *
 * Per section the merge is surgical: only the attributes the op carries are rewritten.
 * Everything else — `header`/`footer`/`gutter` distances, unknown `pgSz` attributes,
 * `cols`, `titlePg`, header/footer references — keeps its authored bytes and its node
 * identity, so a margin drag cannot degrade fidelity anywhere it did not touch. The one
 * deliberate drop is the `pgSz` paper `code` when the dimensions change: a stale paper
 * code contradicts the new size, and Word rewrites it on its own next save.
 */
export function applySetSectionProperties(
  part: OoxmlPart,
  op: SetSectionPropertiesOp,
  options?: EditOptions
): TreeOpResult {
  const body = bodyNodeOf(part);
  if (!body) return { ok: false, reason: 'tree-invariant', detail: 'part has no body' };

  const touchesSize =
    op.pageWidthTwips !== undefined ||
    op.pageHeightTwips !== undefined ||
    op.orientation !== undefined;
  const touchesMargins =
    op.marginTopTwips !== undefined ||
    op.marginRightTwips !== undefined ||
    op.marginBottomTwips !== undefined ||
    op.marginLeftTwips !== undefined;

  const effect: TreeOpEffect = {
    dirty: [],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  const nextId = createNodeIdAllocator(part);
  const targets = targetSectionNodes(part, op.anchorParagraphId);
  const replacements = new Map<string, readonly OoxmlNode[]>();
  let mintedBodySection: OoxmlNode | null = null;
  for (const section of targets) {
    const children = mergedSectionChildren(section, op, touchesSize, touchesMargins, nextId);
    if (section) replacements.set(section.id, children);
    // A null target is the implicit body-level section: mint it, as the body's LAST
    // child per the schema.
    else mintedBodySection = sectionElement(nextId(), 'sectPr', [], children);
  }

  const rebuilt = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const replacement = replacements.get(node.id);
    if (replacement) return { ...node, children: replacement } as OoxmlNode;
    let changed = false;
    const children = node.children.map((child) => {
      const next = rebuilt(child);
      if (next !== child) changed = true;
      return next;
    });
    if (node.kind === 'body' && mintedBodySection) {
      return { ...node, children: [...children, mintedBodySection] } as OoxmlNode;
    }
    return changed ? ({ ...node, children } as OoxmlNode) : node;
  };

  const nextRootChildren = part.root.children.map(rebuilt);
  return fromEdit(replaceChildren(part, part.root.id, nextRootChildren, options), effect);
}

/**
 * End a section at one paragraph: mint `w:pPr/w:sectPr` cloning the governing section's
 * effective page setup, so the new section looks exactly like the one it was cut from —
 * which is what Word's next-page section break does.
 */
/**
 * Move a numbered paragraph to another level.
 *
 * Rewrites `w:numPr/w:ilvl` in place rather than rebuilding `w:pPr`: `w:numId` and every
 * other paragraph property have to survive, and the level is the ONLY thing this op
 * states. A paragraph without `w:numPr` is not a list item, so there is no level to move
 * and the edit is refused — Increase Indent on a plain paragraph is a different op.
 */
export function applySetListLevel(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  level: number,
  options: EditOptions | undefined,
  nextId: () => string
): TreeOpResult {
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const numPr = namedChild(pPr, 'numPr');
  if (!numPr) return { ok: false, reason: 'not-a-list-paragraph' };
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    // The marker re-resolves from numbering.xml at the new level, and levels carry their
    // own indents, so this reflows the paragraph rather than restyling it in place.
    impact: 'flow-structural',
  };
  const ilvl = numPr.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'ilvl'
  );
  const replacement = sectionElement(nextId(), 'ilvl', [wmlAttribute('val', String(level))], []);
  if (ilvl) {
    return fromEdit(replaceNode(part, ilvl.id, replacement, options), effect);
  }
  // Absent `w:ilvl` reads as level 0 (17.9.3); writing it makes the demotion explicit.
  return fromEdit(insertChildren(part, numPr.id, 0, [replacement], options), effect);
}

/**
 * Put a paragraph in a list, or take it out.
 *
 * Surgical on `w:numPr` rather than a `w:pPr` rewrite: a paragraph keeps its alignment,
 * spacing, style and borders across the toggle. `w:numPr` must be the first child of
 * `w:pPr` after `w:pStyle` (17.3.1.26), so a new one is inserted there rather than
 * appended.
 */
export function applySetListNumbering(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  numId: string | null,
  level: number,
  options: EditOptions | undefined,
  nextId: () => string
): TreeOpResult {
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    // Numbering changes the marker, the indent and therefore the flow.
    impact: 'flow-structural',
  };
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const existing = namedChild(pPr, 'numPr');

  if (numId === null) {
    if (!existing) return ok(part, effect);
    return fromEdit(removeNode(part, existing.id, options), effect);
  }

  const numPr = sectionElement(
    nextId(),
    'numPr',
    [],
    [
      sectionElement(nextId(), 'ilvl', [wmlAttribute('val', String(level))], []),
      sectionElement(nextId(), 'numId', [wmlAttribute('val', numId)], []),
    ]
  );
  if (existing) return fromEdit(replaceNode(part, existing.id, numPr, options), effect);
  if (pPr) {
    // After `w:pStyle` when there is one — the schema fixes this order.
    const afterStyle =
      pPr.children.findIndex(
        (child) => child.kind !== 'textValue' && child.localName === 'pStyle'
      ) + 1;
    return fromEdit(insertChildren(part, pPr.id, afterStyle, [numPr], options), effect);
  }
  // The TYPED kind, not a generic element: every reader that looks for paragraph
  // properties — numbering, the style cascade, borders — finds them by
  // `kind === 'paragraphProperties'`, so a generic `w:pPr` is invisible to all of them.
  const created = {
    id: nextId(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [numPr],
  } as unknown as OoxmlNode;
  // `w:pPr` must be the paragraph's FIRST child per the schema.
  return fromEdit(insertChildren(part, paragraph.id, 0, [created], options), effect);
}

/**
 * Replace a paragraph's custom tab stops (`w:tabs`), or remove them entirely.
 *
 * A DEDICATED op, for the same reason `setListNumbering` is one: `w:tabs` carries its meaning
 * in CHILDREN (`w:tab`), and `OoxmlProperty` is flat — a name and attributes. `propertyElement`
 * keeps the children of the node it replaces, so a property write can PRESERVE tab stops but
 * can never author one. The whole list is replaced rather than merged, because that is what a
 * tab-stop editor hands back: the rows as they now stand.
 *
 * Stops are written in ascending position, which is the order `w:tabs` is read in and the one
 * a reader placing them expects.
 */
/** `w:tab` values the tab-stop reader does not model, and a write must therefore preserve. */
const OPAQUE_TAB_VALUES: ReadonlySet<string> = new Set(['bar', 'num']);

/**
 * The most `w:tab` children one `w:tabs` may carry.
 *
 * Half what `applyTabsElement` is willing to walk, so a document this write produces is
 * always fully readable by the reader that feeds it.
 */
const MAX_TAB_STOP_CHILDREN = 64;

export function applySetParagraphTabStops(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  stops: readonly TabStopWrite[],
  inForcePositionsTwips: readonly number[] | undefined,
  options: EditOptions | undefined,
  nextId: () => string
): TreeOpResult {
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    // A tab stop moves where text lands on the line, so the paragraph re-breaks.
    impact: 'flow-structural',
  };
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const existing = namedChild(pPr, 'tabs');

  const kept = new Set(stops.map((stop) => Math.round(stop.positionTwips)));
  const existingTabs = (existing?.children ?? []).filter(
    (child) => child.kind !== 'textValue' && child.localName === 'tab'
  );
  const positionOf = (child: (typeof existingTabs)[number]): number =>
    Math.round(Number(attributeValueOf(child, 'pos')));
  /**
   * A `w:tab` this write cannot re-author, because the reader that feeds it never saw it.
   *
   * A `clear` is never opaque even at a fractional position: it is regenerated below from
   * `standingClears`, and counting it here too emitted the same suppression twice — once
   * carried through at `1440.5` and once regenerated at `1441`, inventing a clear the
   * document never had at a position an inherited stop might occupy.
   */
  const isOpaque = (child: (typeof existingTabs)[number]): boolean =>
    attributeValueOf(child, 'val') !== 'clear' &&
    (OPAQUE_TAB_VALUES.has(attributeValueOf(child, 'val') ?? '') ||
      !Number.isInteger(Number(attributeValueOf(child, 'pos'))));
  // `w:bar` and `w:num` are not caret stops — a bar tab draws a vertical rule and `num` is
  // a legacy list artefact — and a fractional `w:pos` is legal but rounded away on read. The
  // reader reports none of them and an editor cannot name them, so a wholesale replace would
  // delete, on the next unrelated tab edit, markup the user never saw. Carry them through.
  const opaque = existingTabs.filter((child) => isOpaque(child) && !kept.has(positionOf(child)));
  // Clears the paragraph ALREADY carries. These are state, not something to re-derive: a
  // cleared stop is by definition absent from what is in force, so nothing downstream can
  // tell the write to keep clearing it. Dropping one silently undoes the user's deletion,
  // and re-deriving it on the pass after that made the document alternate between two
  // formattings on repeated identical OKs.
  const standingClears = existingTabs
    .filter((child) => attributeValueOf(child, 'val') === 'clear')
    .map(positionOf)
    .filter((position) => Number.isFinite(position) && !kept.has(position));
  // A stop that is in force and is no longer wanted needs an explicit `clear`, or whatever
  // supplies it puts it straight back and the edit silently does nothing.
  //
  // Every unwanted in-force position gets one, including positions this paragraph authors
  // itself. Excluding those looked right — the replace removes them anyway — but it is only
  // safe when the position is EXCLUSIVELY direct: where the paragraph and its style both
  // set a stop at 2160, dropping the direct one let the style's take its place, so "Clear
  // All" reported success and the stop stayed (with a different alignment). A `clear` at a
  // position nothing inherits is inert markup, which is the cheaper mistake.
  const allClears = [
    ...new Set([
      ...standingClears,
      ...(inForcePositionsTwips ?? [])
        .map((position) => Math.round(position))
        .filter((position) => !kept.has(position)),
    ]),
  ].sort((a, b) => a - b);
  // Bounded, because a clear can never be retired: nothing downstream can say whether a
  // suppressed position would come back without it, so `standingClears` re-emits every one
  // forever. Left unbounded the element grew by one inert child per position the user had
  // ever deleted, and the READER walks at most `MAX_TAB_STOPS * 2` children — so past that
  // the real stops sorted off the end and the engine could no longer see the stops it had
  // itself just written. A paragraph in that state is dead: the stop is in the file, and
  // layout, paint and the dialog all report none.
  //
  // Real stops and carried-through markup are never sacrificed; only clears are dropped,
  // lowest positions first, and only in a document with more cleared positions than Word
  // allows tab stops. Losing a suppression there resurrects an inherited stop, which is
  // visible and fixable. The alternative is a paragraph nothing can edit.
  // Budgeted in priority order, because ALL THREE lists can outgrow the element.
  //
  // `opaque` comes straight out of the file, and a `w:tabs` carrying 200 bar tabs is a
  // legal document: budgeting only the clears left the total unbounded, and 200 carried
  // children sorted ahead of the stop the user just set pushed it past the reader's walk —
  // the paragraph reporting no stops at all, which is exactly what the bound exists to
  // prevent.
  //
  // Stops are what the user just asked for and are never dropped. Clears come next: losing
  // one resurrects a stop they deleted, which moves text. Carried-through markup goes last
  // — a lost bar tab is a missing vertical rule, the least harmful of the three.
  const clearBudget = Math.max(0, MAX_TAB_STOP_CHILDREN - stops.length);
  const cleared = allClears.slice(0, clearBudget);
  const carried = opaque.slice(0, Math.max(0, clearBudget - cleared.length));

  if (stops.length === 0 && cleared.length === 0 && carried.length === 0) {
    if (!existing) return ok(part, effect);
    return fromEdit(removeNode(part, existing.id, options), effect);
  }

  const authoredChildren = [
    ...stops.map((stop) => ({ ...stop, positionTwips: Math.round(stop.positionTwips) })),
    ...cleared.map((positionTwips) => ({ positionTwips, alignment: 'clear' as const })),
  ]
    .sort((a, b) => a.positionTwips - b.positionTwips)
    .map((stop) =>
      sectionElement(
        nextId(),
        'tab',
        [
          wmlAttribute('val', stop.alignment),
          wmlAttribute('pos', String(stop.positionTwips)),
          // `w:leader` defaults to `none`, so the common stop stays as Word writes it rather
          // than carrying a redundant attribute. A `clear` never carries one: it removes a
          // stop, and the leader travelled with the stop it is removing.
          ...('leader' in stop && stop.leader && stop.leader !== 'none'
            ? [wmlAttribute('leader', stop.leader)]
            : []),
        ],
        []
      )
    );
  // `w:tabs` is a bare sequence of `w:tab`, unordered by the schema, but the reader merges
  // by position and a document is easier to read in order. The carried-through stops sort
  // in with the rest on `w:pos`.
  const tabs = sectionElement(
    nextId(),
    'tabs',
    [],
    [...authoredChildren, ...carried.map((child) => cloneWithNewIds(child, nextId))].sort(
      (a, b) => Number(attributeValueOf(a, 'pos') ?? 0) - Number(attributeValueOf(b, 'pos') ?? 0)
    )
  );
  if (existing) return fromEdit(replaceNode(part, existing.id, tabs, options), effect);
  if (pPr) {
    // `CT_PPrBase` is a strict `xsd:sequence`, and `w:tabs` sits at slot 11 — after
    // `keepNext`, `keepLines`, `pageBreakBefore`, `framePr`, `widowControl`, `numPr`,
    // `suppressLineNumbers`, `pBdr` and `shd`, not just after `pStyle` and `numPr`. Ranking
    // against the whole sequence is the only way to land in a slot Word will read: a
    // `w:pPr` that already carried `w:keepNext` otherwise came out with `w:tabs` in front
    // of it, which `xmllint --schema wml.xsd` rejects and Word reports as unreadable.
    const index = schemaInsertIndex(pPr.children, CT_PPR_SEQUENCE, 'tabs');
    return fromEdit(insertChildren(part, pPr.id, index, [tabs], options), effect);
  }
  const created = {
    id: nextId(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [tabs],
  } as unknown as OoxmlNode;
  return fromEdit(insertChildren(part, paragraph.id, 0, [created], options), effect);
}

export function applySetSectionMark(
  part: OoxmlPart,
  paragraphId: string,
  options?: EditOptions
): TreeOpResult {
  const paragraph = findNode(part, paragraphId) as OoxmlParagraphNode;
  const nextId = createNodeIdAllocator(part);
  const governing = targetSectionNodes(part, paragraphId)[0] ?? null;
  const metrics = metricsOfSection(governing);
  const effect: TreeOpEffect = {
    dirty: [paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  // The WHOLE governing section is cloned — header/footer references, columns,
  // `titlePg`, page numbering, everything. The new section becomes an EARLIER section,
  // and §17.10.5 header inheritance only looks backwards: cloning just the page
  // geometry would strip the headers off every page before the break. A document with
  // no section at all gets the effective defaults, written out.
  const sectPr = governing
    ? cloneWithNewIds(governing, nextId)
    : sectionElement(
        nextId(),
        'sectPr',
        [],
        [
          sectionElement(
            nextId(),
            'pgSz',
            [
              wmlAttribute('w', String(metrics.widthTwips)),
              wmlAttribute('h', String(metrics.heightTwips)),
              ...(metrics.widthTwips > metrics.heightTwips
                ? [wmlAttribute('orient', 'landscape')]
                : []),
            ],
            []
          ),
          sectionElement(
            nextId(),
            'pgMar',
            [
              wmlAttribute('top', String(metrics.topTwips)),
              wmlAttribute('right', String(metrics.rightTwips)),
              wmlAttribute('bottom', String(metrics.bottomTwips)),
              wmlAttribute('left', String(metrics.leftTwips)),
              wmlAttribute('header', String(metrics.headerTwips)),
              wmlAttribute('footer', String(metrics.footerTwips)),
              wmlAttribute('gutter', String(metrics.gutterTwips)),
            ],
            []
          ),
        ]
      );

  const pPr = paragraphPropertiesNodeOf(paragraph);
  if (!pPr) {
    const minted = {
      id: nextId(),
      kind: 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [sectPr],
    } as unknown as OoxmlNode;
    // `w:pPr` must be the paragraph's FIRST child per the schema.
    return fromEdit(insertChildren(part, paragraph.id, 0, [minted], options), effect);
  }
  // `w:sectPr` sits near the END of CT_PPr's sequence, before only `w:pPrChange`.
  const change = pPr.children.findIndex(
    (child) => 'localName' in child && child.localName === 'pPrChange'
  );
  return fromEdit(
    insertChildren(part, pPr.id, change === -1 ? pPr.children.length : change, [sectPr], options),
    effect
  );
}

/** One section's rebuilt child list with the op's pgSz/pgMar fields merged in. */
function mergedSectionChildren(
  sectPr: OoxmlNode | null,
  op: SetSectionPropertiesOp,
  touchesSize: boolean,
  touchesMargins: boolean,
  nextId: () => string
): OoxmlNode[] {
  const current = metricsOfSection(sectPr);

  const existingPgSz = sectionChild(sectPr, 'pgSz');
  let nextPgSz: OoxmlNode | null = null;
  if (touchesSize) {
    // Per-section dimensions, from the SAME planner validation approved: an orientation
    // change without explicit dimensions swaps this section's own — an A4 section stays
    // A4-sized through a whole-document landscape flip.
    const { widthTwips: width, heightTwips: height } = plannedSectionDimensions(current, op);
    const dimensionsChanged = width !== current.widthTwips || height !== current.heightTwips;
    const orient =
      op.orientation !== undefined
        ? op.orientation === 'landscape'
          ? 'landscape'
          : undefined // Word's portrait is the ABSENCE of the attribute.
        : sectionAttribute(existingPgSz, 'orient');
    const dropped = new Set(['w', 'h', 'orient', ...(dimensionsChanged ? ['code'] : [])]);
    const kept = attributesOf(existingPgSz).filter((entry) => !dropped.has(entry.localName));
    nextPgSz = sectionElement(
      existingPgSz?.id ?? nextId(),
      'pgSz',
      [
        wmlAttribute('w', String(width)),
        wmlAttribute('h', String(height)),
        ...(orient ? [wmlAttribute('orient', orient)] : []),
        ...kept,
      ],
      childrenOf(existingPgSz)
    );
  }

  const existingPgMar = sectionChild(sectPr, 'pgMar');
  let nextPgMar: OoxmlNode | null = null;
  if (touchesMargins) {
    const sides: readonly [string, number | undefined, number][] = [
      ['top', op.marginTopTwips, current.topTwips],
      ['right', op.marginRightTwips, current.rightTwips],
      ['bottom', op.marginBottomTwips, current.bottomTwips],
      ['left', op.marginLeftTwips, current.leftTwips],
    ];
    if (existingPgMar) {
      const written = new Set(
        sides.filter(([, value]) => value !== undefined).map(([name]) => name)
      );
      const kept = attributesOf(existingPgMar).filter((entry) => !written.has(entry.localName));
      nextPgMar = sectionElement(
        existingPgMar.id,
        'pgMar',
        [
          ...sides
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => wmlAttribute(name, String(value))),
          ...kept,
        ],
        childrenOf(existingPgMar)
      );
    } else {
      // Minting `w:pgMar` writes the full attribute set the schema requires, with the
      // effective values for everything the op did not say — explicit defaults are the
      // same document the implicit ones were.
      nextPgMar = sectionElement(
        nextId(),
        'pgMar',
        [
          ...sides.map(([name, value, fallback]) => wmlAttribute(name, String(value ?? fallback))),
          wmlAttribute('header', String(current.headerTwips)),
          wmlAttribute('footer', String(current.footerTwips)),
          wmlAttribute('gutter', String(current.gutterTwips)),
        ],
        []
      );
    }
  }

  let children = [...childrenOf(sectPr)];
  if (nextPgSz) {
    if (existingPgSz) {
      children = children.map((child) => (child.id === existingPgSz.id ? nextPgSz : child));
    } else {
      children.splice(sectionInsertIndex(children, 'pgSz'), 0, nextPgSz);
    }
  }
  if (nextPgMar) {
    if (existingPgMar) {
      children = children.map((child) => (child.id === existingPgMar.id ? nextPgMar : child));
    } else {
      children.splice(sectionInsertIndex(children, 'pgMar'), 0, nextPgMar);
    }
  }
  return children;
}

/**
 * `CT_SectPr`'s child sequence from `w:pgSz` on — a minted element must precede every
 * LATER-sequence sibling already present (`docGrid`, `sectPrChange`, …), or Word
 * reports the file as corrupt.
 */
const SECT_PR_SEQUENCE = [
  'pgSz',
  'pgMar',
  'paperSrc',
  'pgBorders',
  'lnNumType',
  'pgNumType',
  'cols',
  'formProt',
  'vAlign',
  'noEndnote',
  'titlePg',
  'textDirection',
  'bidi',
  'rtlGutter',
  'docGrid',
  'printerSettings',
  'sectPrChange',
] as const;

function sectionInsertIndex(children: readonly OoxmlNode[], localName: string): number {
  const laterSiblings = new Set(
    SECT_PR_SEQUENCE.slice(
      SECT_PR_SEQUENCE.indexOf(localName as (typeof SECT_PR_SEQUENCE)[number]) + 1
    )
  );
  const before = children.findIndex(
    (child) =>
      child.kind !== 'textValue' &&
      'localName' in child &&
      laterSiblings.has(child.localName as (typeof SECT_PR_SEQUENCE)[number])
  );
  return before === -1 ? children.length : before;
}

/**
 * `CT_PPr` child order (17.3.1.26). `w:rPr` sits after every base property and before
 * `w:sectPr`, so a mark written at the end of `w:pPr` would land on the wrong side of a
 * section mark and Word's reader rejects it.
 */
const AFTER_PARAGRAPH_MARK = new Set(['sectPr', 'pPrChange']);

/**
 * Write the run properties of the paragraph MARK (`w:pPr/w:rPr`, 17.3.1.29).
 *
 * Surgical on `w:rPr`, like `setListNumbering` is on `w:numPr`: the mark is one nested
 * child of `w:pPr` and everything else there — the style, the numbering, the borders —
 * has to survive. It cannot go through `setParagraphProperties` at all, because that takes
 * a FLAT property bag and the mark's own run properties are children.
 *
 * An empty `properties` removes the element rather than leaving an empty `w:rPr`, so a
 * cleared mark digests identically to one that never had any — unless a tracked format
 * change put a `w:rPrChange` there, which is the one child that keeps the container alive
 * with nothing else in it.
 */
export function applySetParagraphMarkProperties(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  properties: readonly OoxmlProperty[],
  options: EditOptions | undefined,
  nextId: () => string,
  revision?: RevisionAttributionInput
): TreeOpResult {
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    // The mark is what a list marker inherits its face from, so a change here re-resolves
    // the marker and can change its measured width.
    impact: 'paragraph-local',
  };
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const existing = namedChild(pPr, 'rPr');
  // The mark is a run property container like any other: what the op names is rewritten,
  // and what it cannot name — a `w:rStyle` character style, `w:lang`, a revision record —
  // stays where it was authored.
  const prior = existing?.children ?? [];
  let children: readonly OoxmlNode[] = mergedPropertyChildren(
    prior,
    properties,
    RUN_VOCABULARY,
    nextId
  );
  // The mark's tracked format change is `w:pPr/w:rPr/w:rPrChange` (§17.13.5.31) — the same
  // element a run writes, over `CT_ParaRPrOriginal` rather than `CT_RPrOriginal`. It is what
  // keeps a list marker's face reversible when a whole-paragraph format is proposed.
  if (revision) {
    children = withPropertyChangeRecord({
      container: 'runProperties',
      prior,
      next: children,
      revision,
      mint: nextId,
      nextRevisionId: nextRevisionId(part),
    });
  }

  if (children.length === 0) {
    if (!existing) return ok(part, effect);
    return fromEdit(removeNode(part, existing.id, options), effect);
  }

  const rPr = sectionElement(existing?.id ?? nextId(), 'rPr', [], children);
  if (existing) return fromEdit(replaceNode(part, existing.id, rPr, options), effect);
  if (pPr) {
    const before = pPr.children.findIndex(
      (child) => child.kind !== 'textValue' && AFTER_PARAGRAPH_MARK.has(child.localName)
    );
    const index = before === -1 ? pPr.children.length : before;
    return fromEdit(insertChildren(part, pPr.id, index, [rPr], options), effect);
  }
  // The TYPED kind: every reader finds paragraph properties by
  // `kind === 'paragraphProperties'`, so a generic `w:pPr` is invisible to all of them.
  const created = {
    id: nextId(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [rPr],
  } as unknown as OoxmlNode;
  // `w:pPr` must be the paragraph's FIRST child per the schema.
  return fromEdit(insertChildren(part, paragraph.id, 0, [created], options), effect);
}
