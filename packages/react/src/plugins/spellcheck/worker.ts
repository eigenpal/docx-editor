import { dictionaries } from './dictionaries';
import { createHunspellEngine } from './engine';
import { createWorkerHandler } from './worker-handler';

const engine = createHunspellEngine([dictionaries.en_US, dictionaries.en_GB]);

self.onmessage = createWorkerHandler(engine, (msg) => {
  self.postMessage(msg);
});
