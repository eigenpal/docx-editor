/**
 * `@docx-editor.dev/core/geometry` — measurement, hit-testing, and paint.
 *
 * @experimental
 *
 * SEMVER-EXEMPT. This entry may change or disappear in a minor release.
 *
 * It exists because 86 symbols across 73 call sites are in live adapter use
 * today, reaching into `flow-model`, `pagination-model`, and `painter-model`,
 * which are not exported at all. A handful of methods on `Editor` covers about
 * eight of them. Deleting the rest with no replacement would break both
 * adapters, so they are named here honestly rather than left leaking through a
 * tsconfig wildcard.
 *
 * This is the retirement target: as engine orchestration moves into core,
 * entries here get absorbed by `Editor` and removed. Do not build new
 * integrations against it.
 *
 * Deliberately NOT exposed: `clearAllCaches`, `resetCanvasContext`,
 * `invalidateHfDomCache`, `syncImeCaretAnchor`, `resetImeCaretAnchor`. They
 * mutate module-scope state, which defeats the facade and breaks multiple
 * editor instances on one page. Core owns the `document.fonts` `loadingdone`
 * listener that currently drives them from the React adapter; callers use
 * `editor.relayout({ sync: true })` instead.
 *
 * CONTRACT ONLY.
 */

import type { EditorScope } from './editor';
import type { PageLayout, Point, Rect } from './types';

export type * from './types';

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

/**
 * A geometry position. Distinct from `DocAnchor` on purpose: `{ paraId, search }`
 * is incoherent as the result of a hit test, which resolves to a document
 * offset inside a specific view.
 */
export interface DocPoint {
  readonly pmPos: number;
  readonly scope: EditorScope;
}

export interface SelectionBox extends Rect {
  readonly pageNumber: number;
}

// ─── Measurement ─────────────────────────────────────────────────────────────

export function measureBlocksWithFloats(..._args: unknown[]): unknown[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function measureTable(..._args: unknown[]): unknown {
  throw new Error(NOT_IMPLEMENTED);
}
export function paragraphLayout(..._args: unknown[]): unknown {
  throw new Error(NOT_IMPLEMENTED);
}

// ─── Hit-testing and pointer ─────────────────────────────────────────────────

export function pointerToDocPos(..._args: unknown[]): DocPoint | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function resolveDomPosition(..._args: unknown[]): DocPoint | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function resolveHfDomPosition(..._args: unknown[]): DocPoint | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function resolveFragmentTarget(..._args: unknown[]): unknown | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function resolveTableCellTarget(..._args: unknown[]): unknown | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function findWordBoundariesForPointer(..._args: unknown[]): unknown | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function findBodyPmAnchor(_root: ParentNode): HTMLElement | null {
  throw new Error(NOT_IMPLEMENTED);
}
export function findBodyPmAnchors(_root: ParentNode): HTMLElement[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function createCellDragTracker(..._args: unknown[]): unknown {
  throw new Error(NOT_IMPLEMENTED);
}
export function detectTableInsertHover(_point: Point, ..._args: unknown[]): unknown | null {
  throw new Error(NOT_IMPLEMENTED);
}

// ─── Selection geometry ──────────────────────────────────────────────────────

export function readSelectionGeometry(..._args: unknown[]): SelectionBox[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function readHfSelectionGeometry(..._args: unknown[]): SelectionBox[] {
  throw new Error(NOT_IMPLEMENTED);
}
export function computeHfCaretRectFromView(..._args: unknown[]): Rect | null {
  throw new Error(NOT_IMPLEMENTED);
}

// ─── Paint ───────────────────────────────────────────────────────────────────

export function paintPages(
  _pages: readonly PageLayout[],
  _container: HTMLElement,
  _options?: unknown
): 'full' | 'incremental' {
  throw new Error(NOT_IMPLEMENTED);
}

export declare class LayoutPainter {
  paint(pages: readonly PageLayout[]): void;
  destroy(): void;
}

/** Stays in core: reads DOM that core itself painted. */
export function applySdtFocus(..._args: unknown[]): void {
  throw new Error(NOT_IMPLEMENTED);
}
export function applyCellSelectionHighlight(..._args: unknown[]): void {
  throw new Error(NOT_IMPLEMENTED);
}

export declare const PAGE_CLASS_NAMES: Readonly<Record<string, string>>;
export declare const TABLE_CLASS_NAMES: Readonly<Record<string, string>>;
