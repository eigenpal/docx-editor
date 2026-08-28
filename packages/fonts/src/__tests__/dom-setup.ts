// Registers happy-dom BEFORE anything else in a test module is evaluated.
//
// Its own module because ESM hoists every `import` and evaluates them in order before any
// top-level statement runs, so a `GlobalRegistrator.register()` written as a statement in
// the test file would execute only after the engine's modules had already captured a null
// `document`.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
