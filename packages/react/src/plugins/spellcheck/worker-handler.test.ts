import { describe, it, expect } from 'bun:test';
import { createWorkerHandler } from './worker-handler';

const messages: any[] = [];
const engine = {
  check: (word: string) => word === 'hello',
  suggest: (word: string) => (word === 'wrld' ? ['world'] : []),
  addWord: (_word: string) => {},
};

const handler = createWorkerHandler(engine, (msg) => messages.push(msg));

describe('spellcheck worker handler', () => {
  it('returns check results', async () => {
    await handler({ data: { type: 'check', id: '1', word: 'hello' } } as MessageEvent);
    expect(messages[0]).toEqual({ type: 'checkResult', id: '1', correct: true });
  });

  it('returns suggestions', async () => {
    await handler({ data: { type: 'suggest', id: '2', word: 'wrld' } } as MessageEvent);
    expect(messages[1]).toEqual({ type: 'suggestResult', id: '2', suggestions: ['world'] });
  });
});
