// Lets `tsc` resolve `.vue` single-file-component imports pulled in transitively
// from `@eigenpal/docx-editor-vue` source during typecheck. The Vue adapter
// package owns the real component typing; here the SFCs only need to not error.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<{}, {}, any>;
  export default component;
}
