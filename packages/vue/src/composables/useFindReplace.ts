/**
 * Vue port of packages/react/src/components/dialogs/useFindReplace.ts.
 * Same state shape, same operations, same callbacks. Reactive refs
 * replace useState; the rest is direct translation.
 */
import { reactive, computed } from 'vue';
import type { FindMatch, FindOptions } from '@eigenpal/docx-editor-core/utils/findReplace';
import { createDefaultFindOptions } from '@eigenpal/docx-editor-core/utils/findReplace';

export type { FindMatch, FindOptions };

export interface FindReplaceOptions {
  initialReplaceMode?: boolean;
  onMatchesChange?: (matches: FindMatch[]) => void;
  onCurrentMatchChange?: (match: FindMatch | null, index: number) => void;
}

export interface FindReplaceState {
  isOpen: boolean;
  searchText: string;
  replaceText: string;
  options: FindOptions;
  matches: FindMatch[];
  currentIndex: number;
  replaceMode: boolean;
}

export function useFindReplace(hookOptions: FindReplaceOptions = {}) {
  const state = reactive<FindReplaceState>({
    isOpen: false,
    searchText: '',
    replaceText: '',
    options: createDefaultFindOptions(),
    matches: [],
    currentIndex: 0,
    replaceMode: hookOptions.initialReplaceMode ?? false,
  });

  function openFind(selectedText?: string) {
    state.isOpen = true;
    state.replaceMode = false;
    if (selectedText) state.searchText = selectedText;
    state.matches = [];
    state.currentIndex = 0;
  }
  function openReplace(selectedText?: string) {
    state.isOpen = true;
    state.replaceMode = true;
    if (selectedText) state.searchText = selectedText;
    state.matches = [];
    state.currentIndex = 0;
  }
  function close() {
    state.isOpen = false;
  }
  function toggle() {
    state.isOpen = !state.isOpen;
  }
  function setSearchText(text: string) {
    state.searchText = text;
  }
  function setReplaceText(text: string) {
    state.replaceText = text;
  }
  function setOptions(opts: Partial<FindOptions>) {
    state.options = { ...state.options, ...opts };
  }
  function setMatches(matches: FindMatch[], currentIndex = 0) {
    const newIndex = Math.max(0, Math.min(currentIndex, matches.length - 1));
    state.matches = matches;
    state.currentIndex = matches.length > 0 ? newIndex : 0;
    hookOptions.onMatchesChange?.(matches);
    if (matches.length > 0) {
      hookOptions.onCurrentMatchChange?.(matches[newIndex], newIndex);
    } else {
      hookOptions.onCurrentMatchChange?.(null, -1);
    }
  }
  function goToNextMatch(): number {
    if (state.matches.length === 0) return 0;
    state.currentIndex = (state.currentIndex + 1) % state.matches.length;
    return state.currentIndex;
  }
  function goToPreviousMatch(): number {
    if (state.matches.length === 0) return 0;
    state.currentIndex =
      state.currentIndex === 0 ? state.matches.length - 1 : state.currentIndex - 1;
    return state.currentIndex;
  }
  function goToMatch(index: number) {
    if (state.matches.length === 0 || index < 0 || index >= state.matches.length) return;
    state.currentIndex = index;
  }

  const currentMatch = computed<FindMatch | null>(() => {
    if (state.matches.length === 0) return null;
    return state.matches[state.currentIndex] ?? null;
  });
  const hasMatches = computed(() => state.matches.length > 0);

  return {
    state,
    currentMatch,
    hasMatches,
    openFind,
    openReplace,
    close,
    toggle,
    setSearchText,
    setReplaceText,
    setOptions,
    setMatches,
    goToNextMatch,
    goToPreviousMatch,
    goToMatch,
  };
}
