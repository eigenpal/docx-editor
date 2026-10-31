// Which list a bullet or numbering toggle puts its paragraphs on.
//
// Switching items between bullets and numbers changes their markers, never their place. The
// toggle rejoins a list of the wanted kind when one fits, and otherwise mints a definition
// with the geometry of the list the items are leaving.

import type { ListDefinitionGeometry, ListLevelGeometry } from '@docx-editor.dev/core/store';
import type { ListMarkerRecord, ParagraphIndent } from '@docx-editor.dev/core/layout';
import type { IndentSides } from './list-level-geometry.ts';

type ListKind = 'bullet' | 'ordered';

/** The numbering reads a toggle needs, resolved the way layout paints markers. */
export interface ListSwitchReads {
  /** Each level of `numId` as layout paints it, for a definition of the other kind. */
  listGeometryOf(numId: string): ListDefinitionGeometry;
  /** Which kind of marker `numId` draws at `level`, or null when it does not resolve. */
  listLevelKindOf(numId: string, level: number): ListKind | null;
}

export interface ListSwitchDeps extends ListSwitchReads {
  /** Paragraph ids in reading order for the active scope. */
  order(): readonly string[];
  markerOf(paragraphId: string): ListMarkerRecord | null;
  ensureListDefinition(kind: ListKind, geometry?: ListDefinitionGeometry): string | null;
  /** The paragraph's effective indent, list merge included, or null when it is not laid out. */
  indentOf(paragraphId: string): ParagraphIndent | null;
  /** The sides the paragraph's own `w:ind` states. */
  directIndentSides(paragraphId: string): IndentSides;
  /** The sides its numbering style states over the level, or null when it names its list. */
  styleNumberedIndentSides(paragraphId: string): IndentSides | null;
}

/** The indent sides, in twips, a style-numbered item shows over its level's values. */
interface StyleIndent {
  left?: number;
  right?: number;
  /** Signed: negative is a hanging indent. */
  firstLine?: number;
}

const kindOf = (marker: ListMarkerRecord): ListKind =>
  marker.numFmt === 'bullet' ? 'bullet' : 'ordered';

const twips = (points: number): number => Math.round(points * 20);

/**
 * The `w:numId` an adjacent paragraph of the same kind already uses, if any.
 *
 * Turning a list back on rejoins the list around it rather than minting a second
 * definition — otherwise re-bulleting one item in the middle of a list gave it a
 * different glyph from its neighbours.
 */
function adjacentListNumId(
  deps: ListSwitchDeps,
  touched: readonly string[],
  kind: ListKind
): string | null {
  const order = deps.order();
  const first = order.indexOf(touched[0] ?? '');
  const last = order.indexOf(touched[touched.length - 1] ?? '');
  if (first === -1 || last === -1) return null;
  // The paragraph BEFORE the selection, then the one after.
  for (const index of [first - 1, last + 1]) {
    const neighbour = order[index];
    if (!neighbour) continue;
    const marker = deps.markerOf(neighbour);
    if (marker && kindOf(marker) === kind) return marker.numId;
  }
  return null;
}

/** Where an item its style numbers sits on sides `level` states otherwise, or null. */
function styleIndentOver(
  deps: ListSwitchDeps,
  paragraphId: string,
  level: ListLevelGeometry | undefined
): StyleIndent | null {
  const style = level ? deps.styleNumberedIndentSides(paragraphId) : null;
  const indent = style ? deps.indentOf(paragraphId) : null;
  if (!level || !style || !indent) return null;
  // A side the paragraph states itself outranks every level, before and after.
  const direct = deps.directIndentSides(paragraphId);
  const shown: StyleIndent = {};
  const left = twips(indent.left);
  const right = twips(indent.right);
  if (style.left && !direct.left && level.left !== undefined && level.left !== left) {
    shown.left = left;
  }
  if (style.right && !direct.right && level.right !== undefined && level.right !== right) {
    shown.right = right;
  }
  const offset = indent.hanging > 0 ? -twips(indent.hanging) : twips(indent.firstLine);
  const levelOffset = level.hanging !== undefined ? -level.hanging : level.firstLine;
  if (style.offset && !direct.offset && levelOffset !== undefined && levelOffset !== offset) {
    shown.firstLine = offset;
  }
  return Object.keys(shown).length > 0 ? shown : null;
}

const sameStyleIndent = (left: StyleIndent, right: StyleIndent): boolean =>
  left.left === right.left && left.right === right.right && left.firstLine === right.firstLine;

/** `level` with the sides `shown` states replaced. */
function withStyleIndent(level: ListLevelGeometry, shown: StyleIndent): ListLevelGeometry {
  const { hanging, firstLine, ...rest } = level;
  const offset =
    shown.firstLine === undefined
      ? {
          ...(hanging !== undefined ? { hanging } : {}),
          ...(firstLine !== undefined ? { firstLine } : {}),
        }
      : shown.firstLine < 0
        ? { hanging: -shown.firstLine }
        : { firstLine: shown.firstLine };
  return {
    ...rest,
    ...(shown.left !== undefined ? { left: shown.left } : {}),
    ...(shown.right !== undefined ? { right: shown.right } : {}),
    ...offset,
  };
}

/**
 * The `w:numId` each of `touched` names to become a `kind` list, or null when one cannot be
 * made.
 *
 * A list fits only when it draws `kind` at every level the items will be at (a paragraph
 * that is no list item yet lands at level 0): one definition can number level 0 and bullet
 * level 1, and naming it again for every item would change nothing. The list around the
 * selection comes first, then one the selection already holds. Otherwise definitions are
 * minted from the level geometry of the lists the items are leaving, so items keep their
 * place rather than taking the stock indents.
 *
 * Bullets count nothing, so every item keeps its own place: items mint one definition per
 * list they leave, and an item its numbering STYLE numbers at another indent than its level
 * gets one whose level states that indent. (The switch names the list on the paragraph,
 * which ranks the level above every style; a shared level would move the other items, and
 * a direct indent would outrank the levels Tab moves the item through.)
 *
 * Numbers count per definition, and the items must stay one list. They share one copy of the
 * list most of them leave, with a style's indent on a level only when every item at that
 * level shows it. Those items keep their place; an item whose level sat elsewhere takes the
 * shared indent, because one counted list has one indent per level.
 */
export function switchedListNumIds(
  deps: ListSwitchDeps,
  touched: readonly string[],
  kind: ListKind
): Map<string, string> | null {
  const markers = touched.map((paragraphId) => deps.markerOf(paragraphId));
  const everyItem = (numId: string | null) =>
    numId === null ? null : new Map(touched.map((paragraphId) => [paragraphId, numId]));
  const fits = (numId: string | null | undefined): numId is string =>
    typeof numId === 'string' &&
    markers.every((marker) => deps.listLevelKindOf(numId, marker?.level ?? 0) === kind);
  const adjacent = adjacentListNumId(deps, touched, kind);
  if (fits(adjacent)) return everyItem(adjacent);
  const held = markers.find((marker) => fits(marker?.numId))?.numId;
  if (held) return everyItem(held);
  const leaving = mostUsedNumId(markers);
  if (leaving === null) return everyItem(deps.ensureListDefinition(kind));
  if (kind === 'ordered') {
    // A level takes a style's indent only when every item at it shows that same indent.
    const base = deps.listGeometryOf(leaving);
    const agreed = new Map<number, StyleIndent | null>();
    touched.forEach((paragraphId, index) => {
      const marker = markers[index];
      const level = marker?.level ?? 0;
      const shown =
        marker?.numId === leaving ? styleIndentOver(deps, paragraphId, base[level]) : null;
      const taken = agreed.get(level);
      if (taken === undefined) agreed.set(level, shown);
      else if (taken && !(shown && sameStyleIndent(taken, shown))) agreed.set(level, null);
    });
    const geometry = base.map((level, ilvl) => {
      const shown = agreed.get(ilvl);
      return level && shown ? withStyleIndent(level, shown) : level;
    });
    return everyItem(deps.ensureListDefinition(kind, geometry));
  }

  const geometries = new Map<string, ListDefinitionGeometry>();
  const geometryOf = (numId: string): ListDefinitionGeometry => {
    let geometry = geometries.get(numId);
    if (!geometry) {
      geometry = deps.listGeometryOf(numId);
      geometries.set(numId, geometry);
    }
    return geometry;
  };
  const groups: {
    readonly numId: string;
    readonly shown: Map<number, StyleIndent | null>;
    readonly items: string[];
  }[] = [];
  touched.forEach((paragraphId, index) => {
    const marker = markers[index];
    // A paragraph that is no list item yet takes level 0 of the list most items leave.
    const numId = marker?.numId ?? leaving;
    const level = marker?.level ?? 0;
    const shown = marker ? styleIndentOver(deps, paragraphId, geometryOf(numId)[level]) : null;
    let group = groups.find((candidate) => {
      if (candidate.numId !== numId) return false;
      const taken = candidate.shown.get(level);
      if (taken === undefined) return true;
      return shown ? taken !== null && sameStyleIndent(taken, shown) : taken === null;
    });
    if (!group) {
      group = { numId, shown: new Map(), items: [] };
      groups.push(group);
    }
    // Null reserves this level for items that keep the original level indent.
    group.shown.set(level, shown);
    group.items.push(paragraphId);
  });

  const numIds = new Map<string, string>();
  for (const group of groups) {
    const geometry = geometryOf(group.numId).map((level, ilvl) => {
      const shown = group.shown.get(ilvl);
      return level && shown ? withStyleIndent(level, shown) : level;
    });
    const numId = deps.ensureListDefinition(kind, geometry);
    if (numId === null) return null;
    for (const paragraphId of group.items) numIds.set(paragraphId, numId);
  }
  return numIds;
}

/** The `w:numId` most of `markers` name, the first of them on a tie, or null for none. */
function mostUsedNumId(markers: readonly (ListMarkerRecord | null)[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const marker of markers) {
    if (!marker) continue;
    const count = (counts.get(marker.numId) ?? 0) + 1;
    counts.set(marker.numId, count);
    if (best === null || count > counts.get(best)!) best = marker.numId;
  }
  return best;
}
