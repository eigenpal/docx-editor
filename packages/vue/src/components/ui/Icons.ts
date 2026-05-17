// Alias for cross-adapter parity — React's `Icons.tsx` exports
// `MaterialSymbol` plus inline icon helpers; Vue's MaterialSymbol
// is a .vue SFC. Re-export the SFC under the Icons namespace so
// `import { MaterialSymbol } from '@eigenpal/docx-editor-vue/.../Icons'`
// works the same way it does on the React side.
export { default as MaterialSymbol } from './MaterialSymbol.vue';
