<template>
  <nav :style="devDemo ? containerWithTabsStyle : containerNoTabsStyle" ref="rootRef">
    <template v-if="devDemo">
      <a
        v-for="example in examples"
        :key="example.name"
        :href="example.localUrl"
        :style="example.name === current ? activePillStyle : pillStyle"
        :title="example.description"
      >
        <span class="example-icon" v-html="example.icon" />
        {{ example.name }}
      </a>
    </template>
    <button
      :style="codeButtonStyle"
      @click="open = !open"
      @mouseenter="onButtonEnter"
      @mouseleave="onButtonLeave"
      title="View example source code"
      type="button"
    >
      <span class="example-icon" v-html="caretDownIcon" />
    </button>
    <div v-if="open" :style="dropdownStyle">
      <a
        v-for="example in examples"
        :key="example.name"
        :href="example.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        :style="dropdownItemStyle"
        @mouseenter="onItemEnter"
        @mouseleave="onItemLeave"
      >
        <span class="example-icon" v-html="example.icon" />
        {{ example.name }}
        <span class="source-tag">source</span>
      </a>
      <div class="dropdown-divider" />
      <a
        href="https://www.npmjs.com/package/@eigenpal/docx-editor-vue"
        target="_blank"
        rel="noopener noreferrer"
        :style="dropdownItemStyle"
        @mouseenter="onItemEnter"
        @mouseleave="onItemLeave"
      >
        View on npm
        <svg viewBox="0 0 780 250" width="28" height="11" aria-label="npm" class="npm-logo">
          <path
            fill="#C12127"
            d="M240,250h100v-50h100V0H240V250z M340,50h50v100h-50V50z M480,0v200h100V50h50v150h50V50h50v150h50V0H480z M0,200h100V50h50v150h50V0H0V200z"
          />
        </svg>
      </a>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, type CSSProperties } from 'vue';
import { examples } from './config';

withDefaults(
  defineProps<{
    current: 'Vite' | 'Next.js' | 'Remix' | 'Astro' | 'Vue';
  }>(),
  {}
);

// Mirror of the React `ExampleSwitcher` `__ENABLE_FRAMEWORK_SWITCHER__`
// build flag. The parity build (`ENABLE_FRAMEWORK_SWITCHER=true`) flips
// it on so the framework pills render alongside the chevron source
// menu; regular previews keep the title bar minimal (chevron only).
declare const __ENABLE_FRAMEWORK_SWITCHER__: boolean;
const devDemo = (() => {
  try {
    return __ENABLE_FRAMEWORK_SWITCHER__;
  } catch {
    return false;
  }
})();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

function handleOutsideClick(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
});

const caretDownIcon =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

const containerBaseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  borderRadius: '8px',
  position: 'relative',
  // Establish a stacking context above the editor pages so the open
  // dropdown can't be visually covered by the floating outline (TOC)
  // button anchored inside the document area.
  zIndex: '1000',
};
const containerWithTabsStyle: CSSProperties = {
  ...containerBaseStyle,
  padding: '4px',
  background: '#f1f5f9',
};
const containerNoTabsStyle: CSSProperties = {
  ...containerBaseStyle,
  padding: 0,
  background: 'transparent',
};
const pillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 10px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#64748b',
  textDecoration: 'none',
  borderRadius: '6px',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};
const activePillStyle: CSSProperties = {
  ...pillStyle,
  color: '#0f172a',
  background: '#fff',
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
};
const codeButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '5px 10px',
  fontSize: '13px',
  fontWeight: 500,
  color: '#57606a',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'box-shadow 0.2s, border-color 0.2s',
  whiteSpace: 'nowrap',
};
const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  // Anchor to the left of the chevron button so the dropdown extends
  // rightward into the title bar / document space instead of leftward
  // toward the screen edge. Avoids hanging over the floating outline
  // (TOC) button anchored at the document's left margin.
  left: '0',
  marginTop: '6px',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  padding: '4px',
  zIndex: '1',
  minWidth: '180px',
};
const dropdownItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '7px 10px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#334155',
  textDecoration: 'none',
  borderRadius: '6px',
  transition: 'background 0.1s',
  whiteSpace: 'nowrap',
};

function onButtonEnter(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
  el.style.borderColor = '#cbd5e1';
}
function onButtonLeave(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  el.style.boxShadow = '';
  el.style.borderColor = '#e2e8f0';
}
function onItemEnter(e: MouseEvent) {
  (e.currentTarget as HTMLElement).style.background = '#f1f5f9';
}
function onItemLeave(e: MouseEvent) {
  (e.currentTarget as HTMLElement).style.background = 'transparent';
}
</script>

<style scoped>
.example-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.source-tag {
  color: #94a3b8;
  margin-left: auto;
  font-size: 11px;
}
.npm-logo {
  margin-left: auto;
  flex-shrink: 0;
}
.dropdown-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 4px 0;
}
</style>
