// Registers happy-dom once, before any test module is evaluated.
//
// Why a preload rather than a line in each test: several modules capture `document` at
// module scope — Vue's runtime-dom is the one that bit here — and a module graph is
// evaluated once per process. Whichever test file loaded that module first decided whether
// every later file saw a DOM, so moving files between packages silently changed the answer.
// A preload removes the ordering question entirely.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
