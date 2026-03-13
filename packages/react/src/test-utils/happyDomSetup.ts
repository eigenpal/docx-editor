import { GlobalRegistrator } from '@happy-dom/global-registrator';

const globalAny = globalThis as typeof globalThis & { __happyDomRegistered?: boolean };

if (!globalAny.__happyDomRegistered) {
  GlobalRegistrator.register();
  globalAny.__happyDomRegistered = true;
}
