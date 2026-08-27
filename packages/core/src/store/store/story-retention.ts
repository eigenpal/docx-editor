// Reachability for parked story stores and scoped hyperlink shell resources.
//
// `TreePackageStore` keeps one store per editable part and parks stores whose part is
// temporarily absent (deleted header awaiting undo). These helpers decide which parked
// identities history can still restore, so eviction never severs an undoable pointer
// while unreachable entries stop holding `maxEditableStoryParts` forever.

import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { TreeStoryRef } from './tree-store.ts';

export interface StoryHistoryPointer {
  readonly kind: 'story';
  readonly partName: string;
  readonly story: TreeStoryRef;
}

export interface PackageHistoryPointer {
  readonly kind: 'package';
  readonly before: OoxmlPackage;
  readonly after: OoxmlPackage;
}

export type HistoryPointer = StoryHistoryPointer | PackageHistoryPointer;

/**
 * Story part names that must keep their parked store: parts live in the current package
 * plus every name an undo/redo pointer can restore.
 */
export function retainedStoryPartNames(
  live: OoxmlPackage,
  openStoryNames: Iterable<string>,
  undoOrder: readonly HistoryPointer[],
  redoOrder: readonly HistoryPointer[]
): Set<string> {
  const names = [...openStoryNames];
  const retained = new Set<string>();
  for (const name of names) {
    if (live.parts.has(name)) retained.add(name);
  }
  for (const pointer of undoOrder) retainPointerStoryParts(pointer, names, retained);
  for (const pointer of redoOrder) retainPointerStoryParts(pointer, names, retained);
  return retained;
}

/**
 * Owners whose scoped hyperlink shell must survive while furniture/notes parts are
 * temporarily absent: opened/parked story retention plus every part name that package
 * history can still restore (even when the story store was never opened).
 */
export function retainedHyperlinkOwnerParts(
  storyRetained: ReadonlySet<string>,
  mainDocumentPart: string,
  bodyPartName: string,
  undoOrder: readonly HistoryPointer[],
  redoOrder: readonly HistoryPointer[]
): Set<string> {
  const retained = new Set<string>(storyRetained);
  retained.add(mainDocumentPart);
  retained.add(bodyPartName);
  for (const pointer of undoOrder) retainPointerHyperlinkOwners(pointer, retained);
  for (const pointer of redoOrder) retainPointerHyperlinkOwners(pointer, retained);
  return retained;
}

function retainPointerStoryParts(
  pointer: HistoryPointer,
  openStoryNames: readonly string[],
  retained: Set<string>
): void {
  if (pointer.kind === 'story') {
    retained.add(pointer.partName);
    return;
  }
  for (const name of openStoryNames) {
    if (pointer.before.parts.has(name) || pointer.after.parts.has(name)) {
      retained.add(name);
    }
  }
}

function retainPointerHyperlinkOwners(pointer: HistoryPointer, retained: Set<string>): void {
  if (pointer.kind === 'story') {
    retained.add(pointer.partName);
    return;
  }
  for (const name of pointer.before.parts.keys()) retained.add(name);
  for (const name of pointer.after.parts.keys()) retained.add(name);
}
