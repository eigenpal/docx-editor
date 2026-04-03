<template>
  <div v-if="isOpen" class="find-replace-dialog" @mousedown.stop @keydown.stop>
    <div class="find-replace-dialog__header">
      <span class="find-replace-dialog__title">{{ replaceMode ? 'Find & Replace' : 'Find' }}</span>
      <button class="find-replace-dialog__close" @click="close" title="Close (Escape)">✕</button>
    </div>

    <div class="find-replace-dialog__body">
      <!-- Search row -->
      <div class="find-replace-dialog__row">
        <input
          ref="searchInputRef"
          v-model="searchText"
          class="find-replace-dialog__input"
          placeholder="Find..."
          @keydown="handleSearchKeyDown"
          @input="performSearch"
        />
        <span class="find-replace-dialog__count">{{ matchCountText }}</span>
        <button title="Previous (Shift+Enter)" @mousedown.prevent="findPrevious">▲</button>
        <button title="Next (Enter)" @mousedown.prevent="findNext">▼</button>
      </div>

      <!-- Options row -->
      <div class="find-replace-dialog__options">
        <label>
          <input type="checkbox" v-model="matchCase" @change="performSearch" />
          Match case
        </label>
        <label>
          <input type="checkbox" v-model="matchWholeWord" @change="performSearch" />
          Whole word
        </label>
        <button
          class="find-replace-dialog__toggle"
          :class="{ active: replaceMode }"
          @mousedown.prevent="replaceMode = !replaceMode"
          title="Toggle replace"
        >↔ Replace</button>
      </div>

      <!-- Replace row -->
      <div v-if="replaceMode" class="find-replace-dialog__row">
        <input
          v-model="replaceText"
          class="find-replace-dialog__input"
          placeholder="Replace with..."
          @keydown.enter.prevent="handleReplace"
        />
        <button title="Replace" @mousedown.prevent="handleReplace">Replace</button>
        <button title="Replace All" @mousedown.prevent="handleReplaceAll">All</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

const props = defineProps<{
  isOpen: boolean;
  view: EditorView | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);
const searchText = ref('');
const replaceText = ref('');
const matchCase = ref(false);
const matchWholeWord = ref(false);
const replaceMode = ref(false);

// Match state
const matches = ref<Array<{ from: number; to: number }>>([]);
const currentIndex = ref(-1);

const matchCountText = computed(() => {
  if (!searchText.value.trim()) return '';
  if (matches.value.length === 0) return 'No results';
  if (currentIndex.value < 0) return `${matches.value.length} matches`;
  return `${currentIndex.value + 1} of ${matches.value.length}`;
});

// Focus search input when dialog opens
watch(() => props.isOpen, async (open) => {
  if (open) {
    await nextTick();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
    performSearch();
  } else {
    clearHighlights();
  }
});

function close() {
  clearHighlights();
  emit('close');
}

/**
 * Search through PM doc using textBetween to get accurate positions.
 * We walk each text block and find matches within it.
 */
function performSearch() {
  matches.value = [];
  currentIndex.value = -1;

  const view = props.view;
  if (!view || !searchText.value.trim()) {
    clearHighlights();
    return;
  }

  const doc = view.state.doc;
  const search = searchText.value;
  const caseInsensitive = !matchCase.value;

  // Collect all text blocks with their PM positions
  const found: Array<{ from: number; to: number }> = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    // Get the full text of this text block
    const blockText = doc.textBetween(pos + 1, pos + node.nodeSize - 1, '', '');
    if (!blockText) return false;

    const searchStr = caseInsensitive ? search.toLowerCase() : search;
    const haystack = caseInsensitive ? blockText.toLowerCase() : blockText;

    let searchFrom = 0;
    while (searchFrom < haystack.length) {
      let idx: number;

      if (matchWholeWord.value) {
        // Whole word matching with regex
        const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = caseInsensitive ? 'gi' : 'g';
        const regex = new RegExp(`\\b${escaped}\\b`, flags);
        regex.lastIndex = searchFrom;
        const m = regex.exec(haystack);
        if (!m) break;
        idx = m.index;
      } else {
        idx = haystack.indexOf(searchStr, searchFrom);
        if (idx === -1) break;
      }

      // pos+1 is the start of text content inside the text block node
      const from = pos + 1 + idx;
      const to = from + search.length;
      found.push({ from, to });
      searchFrom = idx + Math.max(1, search.length);
    }

    return false; // Don't descend into inline nodes
  });

  matches.value = found;
  if (found.length > 0) {
    currentIndex.value = 0;
    goToMatch(0);
  }
}

function goToMatch(index: number) {
  const view = props.view;
  if (!view || matches.value.length === 0) return;

  const match = matches.value[index];
  if (!match) return;

  currentIndex.value = index;

  // Set PM selection to the match
  const { from, to } = match;
  try {
    const $from = view.state.doc.resolve(from);
    const $to = view.state.doc.resolve(to);
    const sel = TextSelection.between($from, $to);
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  } catch {
    // Position might be invalid after edits
  }
}

function findNext() {
  if (matches.value.length === 0) {
    performSearch();
    return;
  }
  const next = (currentIndex.value + 1) % matches.value.length;
  goToMatch(next);
}

function findPrevious() {
  if (matches.value.length === 0) return;
  const prev = (currentIndex.value - 1 + matches.value.length) % matches.value.length;
  goToMatch(prev);
}

function handleReplace() {
  const view = props.view;
  if (!view || currentIndex.value < 0 || matches.value.length === 0) return;

  const match = matches.value[currentIndex.value];
  if (!match) return;

  try {
    let tr;
    if (replaceText.value) {
      tr = view.state.tr.replaceWith(match.from, match.to, view.state.schema.text(replaceText.value));
    } else {
      tr = view.state.tr.delete(match.from, match.to);
    }
    view.dispatch(tr);
  } catch {
    // Position might be invalid
  }

  // Re-search and advance
  performSearch();
}

function handleReplaceAll() {
  const view = props.view;
  if (!view || matches.value.length === 0) return;

  // Replace in reverse order to preserve positions
  const sorted = [...matches.value].sort((a, b) => b.from - a.from);
  let tr = view.state.tr;

  for (const match of sorted) {
    try {
      if (replaceText.value) {
        tr = tr.replaceWith(match.from, match.to, view.state.schema.text(replaceText.value));
      } else {
        tr = tr.delete(match.from, match.to);
      }
    } catch {
      // Skip invalid positions
    }
  }

  view.dispatch(tr);
  performSearch();
}

function clearHighlights() {
  matches.value = [];
  currentIndex.value = -1;
}

function handleSearchKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) {
      findPrevious();
    } else {
      findNext();
    }
  } else if (e.key === 'Escape') {
    close();
  }
}
</script>

<style scoped>
.find-replace-dialog {
  position: absolute;
  top: 8px;
  right: 16px;
  z-index: 100;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  min-width: 360px;
  font-size: 13px;
}
.find-replace-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
}
.find-replace-dialog__title {
  font-weight: 600;
  color: #1f2937;
}
.find-replace-dialog__close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.find-replace-dialog__close:hover { background: #f3f4f6; }
.find-replace-dialog__body {
  padding: 8px 12px 12px;
}
.find-replace-dialog__row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.find-replace-dialog__input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}
.find-replace-dialog__input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.15);
}
.find-replace-dialog__count {
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
  min-width: 60px;
  text-align: center;
}
.find-replace-dialog__options {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #4b5563;
}
.find-replace-dialog__options label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.find-replace-dialog__options input[type="checkbox"] {
  margin: 0;
}
.find-replace-dialog__toggle {
  margin-left: auto;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: #4b5563;
}
.find-replace-dialog__toggle.active {
  background: #e0e7ff;
  border-color: #818cf8;
  color: #3730a3;
}
.find-replace-dialog__row button {
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
}
.find-replace-dialog__row button:hover { background: #f3f4f6; }
</style>
