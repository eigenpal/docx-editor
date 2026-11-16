// Registers happy-dom once, before any test module is evaluated.
//
// Why a preload rather than a line in each test: several modules capture `document` at
// module scope — Vue's runtime-dom is the one that bit here — and a module graph is
// evaluated once per process. Whichever test file loaded that module first decided whether
// every later file saw a DOM, so moving files between packages silently changed the answer.
// A preload removes the ordering question entirely.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Pop-out window tests use an `about:blank` iframe as the second window, and happy-dom
// loads iframe pages only when asked. CSS file loading stays off.
if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ settings: { enableIframePageLoading: true } });
}

// happy-dom makes each animation's `finished` promise at play and rejects it on `cancel()`.
// Browsers mark that rejection as handled; happy-dom does not, so a cancelled animation that
// nobody awaited failed its test with an unhandled AbortError. Mark it handled here.
{
  let owner: object | null =
    (globalThis as { Animation?: { prototype: object } }).Animation?.prototype ?? null;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, 'cancel')) {
    owner = Object.getPrototypeOf(owner);
  }
  const target = owner as { cancel(this: { finished?: Promise<unknown> }): void } | null;
  const cancel = target?.cancel;
  if (target && cancel) {
    target.cancel = function (this: { finished?: Promise<unknown> }) {
      this.finished?.catch(() => undefined);
      return cancel.call(this);
    };
  }
}

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
