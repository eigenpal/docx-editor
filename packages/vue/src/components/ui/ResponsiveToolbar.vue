<template>
  <div class="responsive-toolbar" ref="containerRef">
    <div class="responsive-toolbar__items" ref="itemsRef">
      <slot />
    </div>
    <div v-if="overflowCount > 0" class="responsive-toolbar__overflow" ref="overflowRef">
      <button
        class="responsive-toolbar__overflow-btn"
        @mousedown.prevent="showOverflow = !showOverflow"
        :title="`${overflowCount} more items`"
      >
        &#x22EF;
      </button>
      <div v-if="showOverflow" class="responsive-toolbar__overflow-menu">
        <slot name="overflow" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';

const containerRef = ref<HTMLElement | null>(null);
const itemsRef = ref<HTMLElement | null>(null);
const overflowRef = ref<HTMLElement | null>(null);
const overflowCount = ref(0);
const showOverflow = ref(false);

let observer: ResizeObserver | null = null;

function updateOverflow() {
  const container = containerRef.value;
  const items = itemsRef.value;
  if (!container || !items) return;

  const containerWidth = container.clientWidth - 40; // reserve space for overflow button
  const children = Array.from(items.children) as HTMLElement[];
  let visibleCount = 0;

  for (const child of children) {
    child.style.display = '';
  }

  let usedWidth = 0;
  for (const child of children) {
    usedWidth += child.offsetWidth + 2; // 2px gap
    if (usedWidth > containerWidth) {
      child.style.display = 'none';
    } else {
      visibleCount++;
    }
  }

  overflowCount.value = children.length - visibleCount;
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (!overflowRef.value?.contains(target)) {
    showOverflow.value = false;
  }
}

onMounted(() => {
  observer = new ResizeObserver(() => {
    nextTick(updateOverflow);
  });
  if (containerRef.value) {
    observer.observe(containerRef.value);
  }
  nextTick(updateOverflow);
  document.addEventListener('mousedown', handleClickOutside);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('mousedown', handleClickOutside);
});
</script>

<style scoped>
.responsive-toolbar {
  display: flex;
  align-items: center;
  overflow: hidden;
  min-height: 40px;
}
.responsive-toolbar__items {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow: hidden;
}
.responsive-toolbar__overflow {
  position: relative;
  flex-shrink: 0;
}
.responsive-toolbar__overflow-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #6b7280;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.responsive-toolbar__overflow-btn:hover { background: #f1f5f9; }
.responsive-toolbar__overflow-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 200;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  padding: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 200px;
  max-width: 400px;
}
</style>
