import type { SpellcheckWorkerRequest, SpellcheckWorkerResponse } from './types';

export interface SpellcheckEngine {
  check(word: string): boolean;
  suggest(word: string): string[];
  addWord(word: string): void;
}

export function createWorkerHandler(
  engine: SpellcheckEngine,
  post: (message: SpellcheckWorkerResponse) => void
) {
  return async (event: MessageEvent<SpellcheckWorkerRequest>) => {
    const msg = event.data;

    try {
      if (msg.type === 'check') {
        post({ type: 'checkResult', id: msg.id, correct: engine.check(msg.word) });
        return;
      }

      if (msg.type === 'suggest') {
        post({ type: 'suggestResult', id: msg.id, suggestions: engine.suggest(msg.word) });
        return;
      }

      if (msg.type === 'addWord') {
        engine.addWord(msg.word);
        post({ type: 'ready', id: msg.id });
        return;
      }

      if (msg.type === 'init') {
        post({ type: 'ready', id: msg.id });
      }
    } catch (error) {
      post({ type: 'error', id: msg.id, message: (error as Error).message });
    }
  };
}
