/**
 * Pure list-state helpers used by both adapter toolbars to track
 * whether the selection is in a bullet/numbered list and at what
 * indent level. Lifted from packages/react/src/components/ui/
 * ListButtons.tsx so the React + Vue toolbars share identical
 * state-mutation logic.
 * @packageDocumentation
 * @public
 */

export type ListType = 'bullet' | 'numbered' | 'none';

export interface ListState {
  type: ListType;
  level: number;
  isInList: boolean;
  numId?: number;
}

export function createDefaultListState(): ListState {
  return { type: 'none', level: 0, isInList: false };
}

export function createBulletListState(level = 0, numId?: number): ListState {
  return { type: 'bullet', level, isInList: true, numId };
}

export function createNumberedListState(level = 0, numId?: number): ListState {
  return { type: 'numbered', level, isInList: true, numId };
}

export function isBulletListState(state: ListState | undefined): boolean {
  return state?.type === 'bullet';
}

export function isNumberedListState(state: ListState | undefined): boolean {
  return state?.type === 'numbered';
}

export function isAnyListState(state: ListState | undefined): boolean {
  return state?.isInList === true;
}

export function getNextIndentLevel(currentLevel: number): number {
  return Math.min(currentLevel + 1, 8);
}

export function getPreviousIndentLevel(currentLevel: number): number {
  return Math.max(currentLevel - 1, 0);
}

export function toggleListType(state: ListState | undefined, targetType: ListType): ListState {
  if (state?.type === targetType) return createDefaultListState();
  const level = state?.isInList ? state.level : 0;
  if (targetType === 'bullet') return createBulletListState(level);
  if (targetType === 'numbered') return createNumberedListState(level);
  return createDefaultListState();
}
