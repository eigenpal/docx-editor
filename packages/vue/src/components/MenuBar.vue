<!-- File / Format / Insert / Help menus — mirrors the MenuBar in
     packages/react/src/components/TitleBar.tsx. Items emit a string `action`
     event; Insert > Table opens an inline grid picker and emits `insert-table`. -->
<template>
  <div class="menu-bar" role="menubar">
    <MenuDropdown :label="t('toolbar.file')" :items="fileItems" />
    <MenuDropdown :label="t('toolbar.format')" :items="formatItems" />
    <MenuDropdown :label="t('toolbar.insert')" :items="insertItems">
      <template #submenu="{ item, closeMenu }">
        <TableGridInline
          v-if="item.key === 'table'"
          @insert="
            (rows: number, cols: number) => {
              emit('insert-table', rows, cols);
              closeMenu();
            }
          "
        />
      </template>
    </MenuDropdown>
    <MenuDropdown :label="t('toolbar.help')" :items="helpItems" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '../i18n';
import MenuDropdown, { type MenuEntry } from './ui/MenuDropdown.vue';
import TableGridInline from './ui/TableGridInline.vue';

const emit = defineEmits<{
  (e: 'action', action: string): void;
  (e: 'insert-table', rows: number, cols: number): void;
}>();

const { t } = useTranslation();

function act(action: string) {
  return () => emit('action', action);
}

const fileItems = computed<MenuEntry[]>(() => [
  {
    icon: 'file_upload',
    label: t('toolbar.open'),
    shortcut: t('toolbar.openShortcut'),
    onClick: act('open'),
  },
  {
    icon: 'file_download',
    label: t('toolbar.save'),
    shortcut: t('toolbar.saveShortcut'),
    onClick: act('save'),
  },
  { type: 'separator' },
  { icon: 'settings', label: t('toolbar.pageSetup'), onClick: act('pageSetup') },
]);

const formatItems = computed<MenuEntry[]>(() => [
  { icon: 'format_textdirection_l_to_r', label: t('toolbar.leftToRight'), onClick: act('dirLTR') },
  { icon: 'format_textdirection_r_to_l', label: t('toolbar.rightToLeft'), onClick: act('dirRTL') },
]);

const insertItems = computed<MenuEntry[]>(() => [
  { icon: 'image', label: t('toolbar.image'), onClick: act('insertImage') },
  { icon: 'grid_on', label: t('toolbar.table'), key: 'table', submenu: true },
  { type: 'separator' },
  { icon: 'page_break', label: t('toolbar.pageBreak'), onClick: act('insertPageBreak') },
  { icon: 'format_list_numbered', label: t('toolbar.tableOfContents'), onClick: act('insertTOC') },
]);

const helpItems = computed<MenuEntry[]>(() => [
  { label: t('toolbar.reportIssue'), onClick: act('reportIssue') },
]);
</script>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
}
</style>
