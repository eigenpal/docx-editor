/**
 * @eigenpal/nuxt-docx-editor
 *
 * Nuxt module that wraps the `@eigenpal/docx-editor-vue` adapter so Nuxt apps
 * get a zero-config, SSR-safe `<DocxEditor>` component.
 *
 * The editor is browser-only (it drives a hidden ProseMirror instance and
 * touches `window`/DOM APIs), so the component is registered with
 * `mode: 'client'` — Nuxt renders a placeholder during SSR and hydrates the
 * real editor in the browser.
 *
 * @packageDocumentation
 * @public
 */
import { defineNuxtModule, createResolver, addComponent, addImports } from '@nuxt/kit';
import type { NuxtModule } from '@nuxt/schema';

const COMPOSABLES_SUBPATH = '@eigenpal/docx-editor-vue/composables';
const STYLES_SUBPATH = '@eigenpal/docx-editor-vue/styles.css';

// Public composables re-exported by `@eigenpal/docx-editor-vue/composables`.
// Kept as a static list because the runtime bundle can't be imported in the
// module's Node context (it transitively imports a `.css` file). When the
// adapter adds a composable to that barrel, add its name here too.
const VUE_COMPOSABLES = [
  'useAutoSave',
  'useClipboard',
  'useCommentSidebarItems',
  'useDocxEditor',
  'useDragAutoScroll',
  'useFindReplace',
  'useFixedDropdown',
  'useHistory',
  'useSelectionHighlight',
  'useTableResize',
  'useTableSelection',
  'useTrackedChanges',
  'useVisualLineNavigation',
  'useWheelZoom',
  'useZoom',
] as const;

/**
 * Configuration for the DOCX editor Nuxt module, read from the
 * `docxEditor` key of `nuxt.config`.
 *
 * @public
 */
export interface ModuleOptions {
  /**
   * Component name prefix. With `prefix: 'Ep'` the component is auto-imported
   * as `<EpDocxEditor>` instead of `<DocxEditor>`. Defaults to `''`.
   */
  prefix?: string;
  /**
   * Whether the module pushes the editor stylesheet into `nuxt.options.css`.
   * Set to `false` to import `@eigenpal/docx-editor-vue/styles.css` yourself.
   * Defaults to `true`.
   */
  injectStyles?: boolean;
}

// The explicit `NuxtModule<ModuleOptions>` annotation keeps `tsc` from
// inferring a non-portable type that references a hoisted `@nuxt/schema` path.
const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@eigenpal/nuxt-docx-editor',
    configKey: 'docxEditor',
    compatibility: {
      nuxt: '>=3.0.0',
    },
  },
  defaults: {
    prefix: '',
    injectStyles: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    // Ship the editor stylesheet through Nuxt's CSS pipeline.
    if (options.injectStyles) {
      nuxt.options.css.push(STYLES_SUBPATH);
    }

    // Force the editor packages through Vite's dependency optimizer. They are
    // pre-built npm packages, but as workspace/linked installs Vite would
    // otherwise treat them as app source — Nuxt's auto-import transform then
    // injects `import { h } from 'vue'` into chunks that already declare their
    // own `h`, crashing the client with a duplicate-identifier SyntaxError.
    const optimizeDeps = (nuxt.options.vite.optimizeDeps ??= {});
    optimizeDeps.include = [
      ...(optimizeDeps.include ?? []),
      '@eigenpal/docx-editor-core',
      '@eigenpal/docx-editor-vue',
    ];

    // Client-only registration — never executes during SSR.
    addComponent({
      name: `${options.prefix}DocxEditor`,
      filePath: resolver.resolve('./runtime/components/DocxEditor'),
      mode: 'client',
    });

    // Auto-import the Vue composables (useDocxEditor, useZoom, ...) so they
    // need no manual import in Nuxt.
    addImports(VUE_COMPOSABLES.map((name) => ({ name, from: COMPOSABLES_SUBPATH })));
  },
});

export default module;
