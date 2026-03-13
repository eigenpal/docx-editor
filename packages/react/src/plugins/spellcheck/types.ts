import type { SpellcheckLocale } from './dictionaries';

export type SpellcheckWorkerRequest =
  | { type: 'init'; id: string; locales: SpellcheckLocale[] }
  | { type: 'check'; id: string; word: string }
  | { type: 'suggest'; id: string; word: string }
  | { type: 'addWord'; id: string; word: string };

export type SpellcheckWorkerResponse =
  | { type: 'ready'; id: string }
  | { type: 'checkResult'; id: string; correct: boolean }
  | { type: 'suggestResult'; id: string; suggestions: string[] }
  | { type: 'error'; id: string; message: string };
