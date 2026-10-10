// Registers happy-dom once, before any test module is evaluated.
//
// Why a preload rather than a line in each test: several modules capture `document` at
// module scope — Vue's runtime-dom is the one that bit here — and a module graph is
// evaluated once per process. Whichever test file loaded that module first decided whether
// every later file saw a DOM, so moving files between packages silently changed the answer.
// A preload removes the ordering question entirely.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

// Pin one CJS Vue runtime for every `vue` import. TSX under packages/vue is re-transpiled
// to classic `h`/`Fragment` by packages/vue/test/bun-plugin-jsx.ts (see bunfig.toml).
import { mock } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Vue = require('vue');

mock.module('vue', () => Vue);

(globalThis as typeof globalThis & { h: typeof Vue.h; Fragment: typeof Vue.Fragment }).h = Vue.h;
(globalThis as typeof globalThis & { h: typeof Vue.h; Fragment: typeof Vue.Fragment }).Fragment =
  Vue.Fragment;
