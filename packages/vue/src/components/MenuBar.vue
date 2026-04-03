<template>
  <div class="menu-bar">
    <!-- File menu -->
    <div class="menu-bar__dropdown" ref="fileRef">
      <button class="menu-bar__trigger" @mousedown.prevent="toggle('file')">File</button>
      <div v-if="openMenu === 'file'" class="menu-bar__menu">
        <button class="menu-bar__item" @mousedown.prevent="act('print')">Print</button>
        <button class="menu-bar__item" @mousedown.prevent="act('pageSetup')">Page setup</button>
      </div>
    </div>

    <!-- Format menu -->
    <div class="menu-bar__dropdown" ref="formatRef">
      <button class="menu-bar__trigger" @mousedown.prevent="toggle('format')">Format</button>
      <div v-if="openMenu === 'format'" class="menu-bar__menu">
        <button class="menu-bar__item" @mousedown.prevent="act('clearFormatting')">Clear formatting</button>
        <div class="menu-bar__divider" />
        <button class="menu-bar__item" @mousedown.prevent="act('dirLTR')">Left to Right</button>
        <button class="menu-bar__item" @mousedown.prevent="act('dirRTL')">Right to Left</button>
      </div>
    </div>

    <!-- Insert menu -->
    <div class="menu-bar__dropdown" ref="insertRef">
      <button class="menu-bar__trigger" @mousedown.prevent="toggle('insert')">Insert</button>
      <div v-if="openMenu === 'insert'" class="menu-bar__menu">
        <button class="menu-bar__item" @mousedown.prevent="act('insertImage')">Image</button>
        <button class="menu-bar__item" @mousedown.prevent="act('insertTable')">Table</button>
        <button class="menu-bar__item" @mousedown.prevent="act('insertLink')">Link</button>
        <button class="menu-bar__item" @mousedown.prevent="act('insertSymbol')">Symbol</button>
        <div class="menu-bar__divider" />
        <button class="menu-bar__item" @mousedown.prevent="act('insertPageBreak')">Page break</button>
        <button class="menu-bar__item" @mousedown.prevent="act('insertTOC')">Table of Contents</button>
      </div>
    </div>

    <!-- View menu -->
    <div class="menu-bar__dropdown" ref="viewRef">
      <button class="menu-bar__trigger" @mousedown.prevent="toggle('view')">View</button>
      <div v-if="openMenu === 'view'" class="menu-bar__menu">
        <button class="menu-bar__item" @mousedown.prevent="act('outline')">Document outline</button>
        <button class="menu-bar__item" @mousedown.prevent="act('sidebar')">Comments & Changes</button>
        <div class="menu-bar__divider" />
        <button class="menu-bar__item" @mousedown.prevent="act('shortcuts')">Keyboard shortcuts</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits<{
  (e: 'action', action: string): void;
}>();

const openMenu = ref<string | null>(null);
const fileRef = ref<HTMLElement | null>(null);
const formatRef = ref<HTMLElement | null>(null);
const insertRef = ref<HTMLElement | null>(null);
const viewRef = ref<HTMLElement | null>(null);

function toggle(name: string) {
  openMenu.value = openMenu.value === name ? null : name;
}

function act(action: string) {
  openMenu.value = null;
  emit('action', action);
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  const refs = [fileRef, formatRef, insertRef, viewRef];
  if (!refs.some(r => r.value?.contains(target))) {
    openMenu.value = null;
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', handleClickOutside));
</script>

<style scoped>
.menu-bar { display: flex; align-items: center; gap: 0; padding: 0 4px; }
.menu-bar__dropdown { position: relative; }
.menu-bar__trigger {
  padding: 4px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  border-radius: 4px;
}
.menu-bar__trigger:hover { background: #f1f5f9; }
.menu-bar__menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 200;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  min-width: 180px;
  padding: 4px 0;
}
.menu-bar__item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: #1f2937;
}
.menu-bar__item:hover { background: #f3f4f6; }
.menu-bar__divider { height: 1px; background: #e5e7eb; margin: 4px 8px; }
</style>
