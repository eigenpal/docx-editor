/**
 * @docx-editor.dev/nuxt
 *
 * Nuxt module that wraps the `@docx-editor.dev/vue` adapter so Nuxt apps
 * get a zero-config, SSR-safe `<DocxEditor>` component.
 */
import { defineNuxtModule, createResolver, addComponent, addImports } from '@nuxt/kit';
import type { NuxtModule } from '@nuxt/schema';
import { VUE_COMPOSABLES } from './vue-composables.generated';

const PACKAGE_ROOT = '@docx-editor.dev/vue';
const CORE_STYLES = '@docx-editor.dev/core/styles/editor.css';

/** @public */
export interface ModuleOptions {
  prefix?: string;
  injectStyles?: boolean;
}

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@docx-editor.dev/nuxt',
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

    if (options.injectStyles) {
      nuxt.options.css.push(CORE_STYLES);
    }

    const optimizeDeps = (nuxt.options.vite.optimizeDeps ??= {});
    optimizeDeps.include = [...(optimizeDeps.include ?? []), '@docx-editor.dev/core', PACKAGE_ROOT];

    addComponent({
      name: `${options.prefix}DocxEditor`,
      filePath: resolver.resolve('./runtime/components/DocxEditor'),
      mode: 'client',
    });

    addImports(VUE_COMPOSABLES.map((name) => ({ name, from: PACKAGE_ROOT })));
  },
});

export default module;
