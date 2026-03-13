import nspell from 'nspell';
import type { SpellcheckEngine } from './worker-handler';

export interface HunspellDictionary {
  aff: string;
  dic: string;
}

const MAX_CACHE_SIZE = 2000;

function cacheSet<K, V>(map: Map<K, V>, key: K, value: V) {
  map.set(key, value);
  if (map.size > MAX_CACHE_SIZE) {
    const first = map.keys().next().value as K | undefined;
    if (first !== undefined) map.delete(first);
  }
}

export function createHunspellEngine(dictionaries: HunspellDictionary[]): SpellcheckEngine {
  const engines = dictionaries.map((dict) => nspell(dict));
  const checkCache = new Map<string, boolean>();
  const suggestCache = new Map<string, string[]>();

  return {
    check(word: string): boolean {
      const cached = checkCache.get(word);
      if (cached !== undefined) return cached;

      const correct = engines.some((engine) => engine.correct(word));
      cacheSet(checkCache, word, correct);
      return correct;
    },

    suggest(word: string): string[] {
      const cached = suggestCache.get(word);
      if (cached) return cached;

      const suggestions = Array.from(
        new Set(engines.flatMap((engine) => engine.suggest(word)))
      ).slice(0, 8);

      cacheSet(suggestCache, word, suggestions);
      return suggestions;
    },

    addWord(word: string): void {
      engines.forEach((engine) => engine.add(word));
      checkCache.delete(word);
      suggestCache.delete(word);
    },
  };
}
