// Registers happy-dom for binding tests that mount ProseMirror views.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
