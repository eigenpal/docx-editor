<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog symbol-dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">Insert Symbol</span>
        <button class="dialog__close" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <!-- Search -->
        <input
          ref="searchRef"
          v-model="search"
          class="symbol-search"
          placeholder="Search symbols..."
          @keydown.escape="close"
        />

        <!-- Category tabs -->
        <div v-if="!search" class="symbol-tabs">
          <button
            v-for="cat in categories"
            :key="cat.name"
            class="symbol-tab"
            :class="{ active: activeCategory === cat.name }"
            @mousedown.prevent="activeCategory = cat.name"
          >{{ cat.name }}</button>
        </div>

        <!-- Symbol grid -->
        <div class="symbol-grid">
          <button
            v-for="sym in displayedSymbols"
            :key="sym.char"
            class="symbol-cell"
            :class="{ selected: selectedSymbol === sym.char }"
            :title="sym.name"
            @click="selectedSymbol = sym.char"
            @dblclick="insertSymbol(sym.char)"
          >{{ sym.char }}</button>
          <div v-if="displayedSymbols.length === 0" class="symbol-empty">No symbols found</div>
        </div>

        <!-- Preview & info -->
        <div v-if="selectedSymbol" class="symbol-preview">
          <span class="symbol-preview__char">{{ selectedSymbol }}</span>
          <span class="symbol-preview__info">U+{{ selectedSymbol.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') }}</span>
        </div>

        <!-- Recent -->
        <div v-if="recentSymbols.length > 0 && !search" class="symbol-recent">
          <div class="symbol-recent__label">Recent:</div>
          <button
            v-for="s in recentSymbols"
            :key="s"
            class="symbol-cell symbol-cell--small"
            @dblclick="insertSymbol(s)"
            @click="selectedSymbol = s"
          >{{ s }}</button>
        </div>

        <div class="dialog__actions">
          <button class="dialog__btn" @click="close">Cancel</button>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="insertSymbol(selectedSymbol)" :disabled="!selectedSymbol">Insert</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'insert', symbol: string): void;
}>();

const searchRef = ref<HTMLInputElement | null>(null);
const search = ref('');
const activeCategory = ref('Common');
const selectedSymbol = ref('');
const recentSymbols = ref<string[]>([]);

interface SymbolEntry { char: string; name: string; category: string; }

const categories = [
  { name: 'Common', symbols: [
    { char: '©', name: 'Copyright' }, { char: '®', name: 'Registered' }, { char: '™', name: 'Trademark' },
    { char: '•', name: 'Bullet' }, { char: '…', name: 'Ellipsis' }, { char: '—', name: 'Em dash' },
    { char: '–', name: 'En dash' }, { char: '±', name: 'Plus-minus' }, { char: '×', name: 'Multiply' },
    { char: '÷', name: 'Divide' }, { char: '≠', name: 'Not equal' }, { char: '≈', name: 'Approximately' },
    { char: '≤', name: 'Less or equal' }, { char: '≥', name: 'Greater or equal' }, { char: '°', name: 'Degree' },
    { char: 'µ', name: 'Micro' }, { char: '¶', name: 'Pilcrow' }, { char: '§', name: 'Section' },
    { char: '†', name: 'Dagger' }, { char: '‡', name: 'Double dagger' }, { char: '¿', name: 'Inverted question' },
    { char: '¡', name: 'Inverted exclamation' }, { char: '‰', name: 'Per mille' }, { char: '∞', name: 'Infinity' },
  ]},
  { name: 'Arrows', symbols: [
    { char: '←', name: 'Left' }, { char: '→', name: 'Right' }, { char: '↑', name: 'Up' }, { char: '↓', name: 'Down' },
    { char: '↔', name: 'Left-right' }, { char: '↕', name: 'Up-down' }, { char: '⇐', name: 'Double left' },
    { char: '⇒', name: 'Double right' }, { char: '⇑', name: 'Double up' }, { char: '⇓', name: 'Double down' },
    { char: '⇔', name: 'Double left-right' }, { char: '➡', name: 'Heavy right' }, { char: '↩', name: 'Return' },
    { char: '↪', name: 'Curved right' }, { char: '↻', name: 'Clockwise' }, { char: '↺', name: 'Counter-clockwise' },
  ]},
  { name: 'Math', symbols: [
    { char: '∑', name: 'Summation' }, { char: '∏', name: 'Product' }, { char: '∫', name: 'Integral' },
    { char: '√', name: 'Square root' }, { char: '∂', name: 'Partial diff' }, { char: '∇', name: 'Nabla' },
    { char: '∈', name: 'Element of' }, { char: '∉', name: 'Not element' }, { char: '⊂', name: 'Subset' },
    { char: '⊃', name: 'Superset' }, { char: '∪', name: 'Union' }, { char: '∩', name: 'Intersection' },
    { char: '∧', name: 'And' }, { char: '∨', name: 'Or' }, { char: '¬', name: 'Not' },
    { char: '∀', name: 'For all' }, { char: '∃', name: 'Exists' }, { char: '∅', name: 'Empty set' },
    { char: '∝', name: 'Proportional' }, { char: '∠', name: 'Angle' },
  ]},
  { name: 'Greek', symbols: [
    { char: 'α', name: 'alpha' }, { char: 'β', name: 'beta' }, { char: 'γ', name: 'gamma' },
    { char: 'δ', name: 'delta' }, { char: 'ε', name: 'epsilon' }, { char: 'ζ', name: 'zeta' },
    { char: 'η', name: 'eta' }, { char: 'θ', name: 'theta' }, { char: 'λ', name: 'lambda' },
    { char: 'μ', name: 'mu' }, { char: 'π', name: 'pi' }, { char: 'ρ', name: 'rho' },
    { char: 'σ', name: 'sigma' }, { char: 'τ', name: 'tau' }, { char: 'φ', name: 'phi' },
    { char: 'ψ', name: 'psi' }, { char: 'ω', name: 'omega' }, { char: 'Δ', name: 'Delta' },
    { char: 'Σ', name: 'Sigma' }, { char: 'Ω', name: 'Omega' }, { char: 'Π', name: 'Pi' },
    { char: 'Φ', name: 'Phi' }, { char: 'Ψ', name: 'Psi' }, { char: 'Θ', name: 'Theta' },
  ]},
  { name: 'Currency', symbols: [
    { char: '$', name: 'Dollar' }, { char: '€', name: 'Euro' }, { char: '£', name: 'Pound' },
    { char: '¥', name: 'Yen' }, { char: '₹', name: 'Rupee' }, { char: '₽', name: 'Ruble' },
    { char: '₩', name: 'Won' }, { char: '₿', name: 'Bitcoin' }, { char: '¢', name: 'Cent' },
    { char: '₫', name: 'Dong' }, { char: '₺', name: 'Lira' }, { char: '₴', name: 'Hryvnia' },
  ]},
  { name: 'Shapes', symbols: [
    { char: '■', name: 'Black square' }, { char: '□', name: 'White square' }, { char: '▲', name: 'Up triangle' },
    { char: '▼', name: 'Down triangle' }, { char: '●', name: 'Black circle' }, { char: '○', name: 'White circle' },
    { char: '◆', name: 'Black diamond' }, { char: '◇', name: 'White diamond' }, { char: '★', name: 'Black star' },
    { char: '☆', name: 'White star' }, { char: '♠', name: 'Spade' }, { char: '♥', name: 'Heart' },
    { char: '♦', name: 'Diamond' }, { char: '♣', name: 'Club' }, { char: '✓', name: 'Check mark' },
    { char: '✗', name: 'Ballot X' }, { char: '✦', name: 'Four pointed star' }, { char: '◌', name: 'Dotted circle' },
  ]},
];

const allSymbols = computed<SymbolEntry[]>(() => {
  const result: SymbolEntry[] = [];
  for (const cat of categories) {
    for (const sym of cat.symbols) {
      result.push({ ...sym, category: cat.name });
    }
  }
  return result;
});

const displayedSymbols = computed(() => {
  if (search.value) {
    const q = search.value.toLowerCase();
    return allSymbols.value.filter(s =>
      s.name.toLowerCase().includes(q) || s.char === q
    );
  }
  const cat = categories.find(c => c.name === activeCategory.value);
  return cat ? cat.symbols.map(s => ({ ...s, category: cat.name })) : [];
});

watch(() => props.isOpen, async (open) => {
  if (open) {
    await nextTick();
    searchRef.value?.focus();
  }
});

function close() { emit('close'); }

function insertSymbol(sym: string) {
  if (!sym) return;
  // Track recent
  recentSymbols.value = [sym, ...recentSymbols.value.filter(s => s !== sym)].slice(0, 10);
  emit('insert', sym);
}
</script>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 300; display: flex; align-items: center; justify-content: center; }
.dialog { background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); max-width: 90vw; }
.symbol-dialog { width: 480px; }
.dialog__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.dialog__title { font-weight: 600; font-size: 14px; color: #1f2937; }
.dialog__close { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #6b7280; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.dialog__close:hover { background: #f3f4f6; }
.dialog__body { padding: 16px; }
.dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dialog__btn { padding: 6px 16px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; font-size: 13px; background: #fff; }
.dialog__btn--primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.dialog__btn--primary:hover { background: #2563eb; }
.dialog__btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }

.symbol-search { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; outline: none; box-sizing: border-box; margin-bottom: 8px; }
.symbol-search:focus { border-color: #3b82f6; }

.symbol-tabs { display: flex; gap: 2px; margin-bottom: 8px; flex-wrap: wrap; }
.symbol-tab { padding: 4px 8px; border: none; border-radius: 4px; background: transparent; cursor: pointer; font-size: 11px; color: #6b7280; }
.symbol-tab:hover { background: #f3f4f6; }
.symbol-tab.active { background: #e0e7ff; color: #3730a3; font-weight: 600; }

.symbol-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 2px; max-height: 240px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 4px; padding: 4px; }
.symbol-cell { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-size: 18px; background: transparent; }
.symbol-cell:hover { background: #f3f4f6; border-color: #d1d5db; }
.symbol-cell.selected { background: #dbeafe; border-color: #3b82f6; }
.symbol-cell--small { width: 28px; height: 28px; font-size: 14px; }
.symbol-empty { grid-column: 1/-1; text-align: center; padding: 24px; color: #9ca3af; font-size: 13px; }

.symbol-preview { display: flex; align-items: center; gap: 12px; margin-top: 8px; padding: 8px 12px; background: #f9fafb; border-radius: 4px; }
.symbol-preview__char { font-size: 28px; }
.symbol-preview__info { font-size: 12px; color: #6b7280; font-family: monospace; }

.symbol-recent { display: flex; align-items: center; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
.symbol-recent__label { font-size: 11px; color: #9ca3af; margin-right: 4px; }
</style>
