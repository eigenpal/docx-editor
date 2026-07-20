import { reactive } from 'vue';

/**
 * Last-used Insert-Table dimensions. Module-level so the dialog reopens with
 * whatever the user picked last time (mirrors React lifting this to component
 * state that survives reopen).
 */
export const rememberedTableSize = reactive({ rows: 3, cols: 3 });
